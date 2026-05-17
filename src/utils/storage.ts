import {
  ANIME_DOMAINS_KEY,
  STORAGE_KEY,
  STORAGE_WARN_PREFIX,
  YOUTUBE_CHANNELS_KEY,
} from '../constants/storage';
import type {
  AllowedYouTubeChannel,
  AnimeDomain,
  LegacyNetflixItem,
  MediaItem,
  MediaStorage,
  Platform,
} from '../types/media';
import { createCustomSeriesKey, createYouTubeSeriesKey } from './id';

export const defaultMediaStorage: MediaStorage = {
  items: [],
};

const DEFAULT_YOUTUBE_CHANNELS: AllowedYouTubeChannel[] = [
  {
    id: 'youtube-channel-muse-indonesia',
    name: 'Muse Indonesia',
    handle: '@MuseIndonesia',
    enabled: true,
    createdAt: new Date('2026-05-17T00:00:00.000Z').toISOString(),
  },
];

const DEFAULT_ANIME_DOMAINS: AnimeDomain[] = [
  {
    id: 'otakudesu',
    name: 'Otakudesu',
    hostname: 'otakudesu',
    grantedOrigin: null,
    enabled: true,
    createdAt: new Date('2026-05-17T00:00:00.000Z').toISOString(),
  },
];

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createNetflixItemId(title: string): string {
  return `netflix-${normalizeTitle(title)}`;
}

function createYouTubeItemId(videoId: string): string {
  return `youtube-${videoId}`;
}

function extractNetflixTitleId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsedUrl = new URL(value, 'https://www.netflix.com');

    const pathnameTitleMatch = parsedUrl.pathname.match(/\/title\/(\d{6,})/i);
    if (pathnameTitleMatch) {
      return pathnameTitleMatch[1];
    }

    const queryCandidates = [
      parsedUrl.searchParams.get('titleId'),
      parsedUrl.searchParams.get('movieid'),
      parsedUrl.searchParams.get('jbv'),
      parsedUrl.searchParams.get('tctx'),
    ];

    for (const candidate of queryCandidates) {
      const match = candidate?.match(/\b(\d{6,})\b/);
      if (match) {
        return match[1];
      }
    }

    const decodedUrl = decodeURIComponent(parsedUrl.toString());
    const nestedTitleMatch = decodedUrl.match(/\/title\/(\d{6,})/i);
    if (nestedTitleMatch) {
      return nestedTitleMatch[1];
    }
  } catch {
    return null;
  }

  return null;
}

function buildNetflixOpenUrl(title: string, titleId: string | null): string {
  if (titleId) {
    return `https://www.netflix.com/title/${titleId}`;
  }

  return `https://www.netflix.com/search?q=${encodeURIComponent(title)}`;
}

function cleanYouTubeAnimeTitle(title: string): string {
  return title
    .replace(/\[[^\]]*indonesia[^\]]*\]/gi, '')
    .replace(/\([^)]*indonesia[^)]*\)/gi, '')
    .replace(/\s*[-:|]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChannelName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeChannelHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '');
}

function createYouTubeChannelId(name: string, handle?: string | null): string {
  const normalizedHandle = handle ? normalizeChannelHandle(handle) : '';
  const normalizedName = normalizeTitle(name);
  return normalizedHandle
    ? `youtube-channel-${normalizedHandle}`
    : `youtube-channel-${normalizedName}`;
}

function normalizeCurrentDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

function normalizeDomainKeyword(value: string): string {
  return normalizeCurrentDomain(value);
}

function createAnimeDomainId(name: string, hostname: string): string {
  return normalizeTitle(name) || normalizeDomainKeyword(hostname);
}

function parseYouTubeTitleParts(rawTitle: string): {
  title: string;
  episode: string | null;
} {
  const episodeMatch = rawTitle.match(/\b(?:episode|ep)\.?\s*(\d+)\b/i);
  const episode = episodeMatch ? `Episode ${episodeMatch[1]}` : null;

  if (!episodeMatch || episodeMatch.index === undefined) {
    const fallbackTitle = cleanYouTubeAnimeTitle(rawTitle);
    return {
      title: fallbackTitle || rawTitle.trim(),
      episode: null,
    };
  }

  const titleCandidate = cleanYouTubeAnimeTitle(
    rawTitle.slice(0, episodeMatch.index),
  );

  return {
    title: titleCandidate || cleanYouTubeAnimeTitle(rawTitle) || rawTitle.trim(),
    episode,
  };
}

function logStorageAvailability(reason: string): void {
  const chromeExists = typeof chrome !== 'undefined';
  const storageExists = chromeExists && typeof chrome.storage !== 'undefined';
  const localExists = storageExists && typeof chrome.storage.local !== 'undefined';

  console.debug(`${STORAGE_WARN_PREFIX} storage diagnostics`, {
    reason,
    chromeExists,
    storageExists,
    localExists,
  });
}

function getStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }

  return chrome.storage.local;
}

function isPlatform(value: unknown): value is Platform {
  return value === 'netflix' || value === 'youtube' || value === 'custom';
}

function toNullableString(value: unknown): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function toNullableBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeAllowedYouTubeChannel(
  value: unknown,
): AllowedYouTubeChannel | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<AllowedYouTubeChannel>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) {
    return null;
  }

  const rawHandle = toNullableString(candidate.handle);
  const handle =
    typeof rawHandle === 'string' && rawHandle.trim().length > 0
      ? `@${normalizeChannelHandle(rawHandle)}`
      : null;
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : createYouTubeChannelId(name, handle);

  return {
    id,
    name,
    handle,
    enabled: candidate.enabled !== false,
    createdAt:
      typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : new Date().toISOString(),
  };
}

function normalizeAllowedYouTubeChannels(items: unknown[]): AllowedYouTubeChannel[] {
  const byKey = new Map<string, AllowedYouTubeChannel>();

  for (const item of items) {
    const normalized = normalizeAllowedYouTubeChannel(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.handle
      ? `handle:${normalizeChannelHandle(normalized.handle)}`
      : `name:${normalizeChannelName(normalized.name)}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...normalized,
      enabled: normalized.enabled,
    });
  }

  return [...byKey.values()].sort((left, right) => {
    const createdAtDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (!Number.isNaN(createdAtDiff) && createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return left.name.localeCompare(right.name);
  });
}

function normalizeAnimeDomain(value: unknown): AnimeDomain | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<AnimeDomain>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim().replace(/\s+/g, ' ') : '';
  const hostname = typeof candidate.hostname === 'string' ? normalizeDomainKeyword(candidate.hostname) : '';
  if (!name || !hostname) {
    return null;
  }

  const rawGrantedOrigin = toNullableString(candidate.grantedOrigin);
  const grantedOrigin =
    typeof rawGrantedOrigin === 'string' && rawGrantedOrigin.trim().length > 0
      ? rawGrantedOrigin.trim()
      : null;

  return {
    id:
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : createAnimeDomainId(name, hostname),
    name,
    hostname,
    grantedOrigin,
    enabled: candidate.enabled !== false,
    createdAt:
      typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : new Date().toISOString(),
  };
}

function normalizeAnimeDomains(items: unknown[]): AnimeDomain[] {
  const byKey = new Map<string, AnimeDomain>();

  for (const item of items) {
    const normalized = normalizeAnimeDomain(item);
    if (!normalized) {
      continue;
    }

    const key = normalizeDomainKeyword(normalized.hostname);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...normalized,
      enabled: normalized.enabled,
    });
  }

  return [...byKey.values()].sort((left, right) => {
    const createdAtDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (!Number.isNaN(createdAtDiff) && createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return left.name.localeCompare(right.name);
  });
}

function normalizeMediaItem(value: unknown): MediaItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<MediaItem> & LegacyNetflixItem;
  const rawTitle = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const url = typeof candidate.url === 'string' ? candidate.url : '';
  const lastWatchedAt =
    typeof candidate.lastWatchedAt === 'string'
      ? candidate.lastWatchedAt
      : new Date().toISOString();
  const platform =
    candidate.source === 'netflix'
      ? 'netflix'
      : isPlatform(candidate.platform)
        ? candidate.platform
        : null;

  if (!rawTitle || !url || !platform) {
    return null;
  }

  const parsedYouTubeTitle =
    platform === 'youtube' ? parseYouTubeTitleParts(rawTitle) : null;
  const title = parsedYouTubeTitle?.title ?? rawTitle;
  const watchUrl =
    platform === 'netflix'
      ? toNullableString(candidate.watchUrl) ?? url
      : toNullableString(candidate.watchUrl);

  let id = typeof candidate.id === 'string' && candidate.id ? candidate.id : '';
  if (!id && platform === 'netflix') {
    id = createNetflixItemId(title);
  }

  if (!id && platform === 'youtube') {
    try {
      const parsedUrl = new URL(url);
      const videoId = parsedUrl.searchParams.get('v');
      if (videoId) {
        id = createYouTubeItemId(videoId);
      }
    } catch {
      return null;
    }
  }

  if (!id && platform === 'custom') {
    const customHostname = toNullableString(candidate.hostname);
    if (customHostname) {
      id = createCustomSeriesKey(customHostname, title);
    }
  }

  if (!id) {
    return null;
  }

  const channel = toNullableString(candidate.channel);

  const normalizedUrl =
    platform === 'netflix'
      ? buildNetflixOpenUrl(title, extractNetflixTitleId(candidate.url) ?? extractNetflixTitleId(watchUrl))
      : url;

  return {
    id,
    platform,
    title,
    url: normalizedUrl,
    watchUrl,
    seriesKey:
      platform === 'youtube'
        ? createYouTubeSeriesKey(title)
        : platform === 'custom'
          ? createCustomSeriesKey(toNullableString(candidate.hostname) ?? '', title)
          : toNullableString(candidate.seriesKey),
    creator: toNullableString(candidate.creator),
    channel,
    season: toNullableString(candidate.season),
    episode: parsedYouTubeTitle?.episode ?? toNullableString(candidate.episode),
    episodeTitle: toNullableString(candidate.episodeTitle),
    duration: toNullableString(candidate.duration),
    thumbnail: toNullableString(candidate.thumbnail),
    publishedAt: toNullableString(candidate.publishedAt),
    siteName: toNullableString(candidate.siteName),
    hostname: toNullableString(candidate.hostname),
    nextEpisode: toNullableString(candidate.nextEpisode),
    nextEpisodeAvailableAt: toNullableString(candidate.nextEpisodeAvailableAt),
    hasNewEpisode: toNullableBoolean(candidate.hasNewEpisode),
    lastWatchedAt,
  };
}

function normalizeMediaItems(items: unknown[]): MediaItem[] {
  const byId = new Map<string, MediaItem>();
  const latestYoutubeSeries = new Map<string, MediaItem>();
  const latestCustomSeries = new Map<string, MediaItem>();

  for (const rawItem of items) {
    const normalized = normalizeMediaItem(rawItem);
    if (!normalized) {
      continue;
    }

    const existing = byId.get(normalized.id);
    if (!existing || Date.parse(normalized.lastWatchedAt) >= Date.parse(existing.lastWatchedAt)) {
      byId.set(normalized.id, normalized);
    }

    if (normalized.platform === 'youtube' && normalized.seriesKey) {
      const existingSeries = latestYoutubeSeries.get(normalized.seriesKey);
      if (
        !existingSeries ||
        Date.parse(normalized.lastWatchedAt) >= Date.parse(existingSeries.lastWatchedAt)
      ) {
        latestYoutubeSeries.set(normalized.seriesKey, normalized);
      }
    }

    if (normalized.platform === 'custom' && normalized.seriesKey) {
      const existingSeries = latestCustomSeries.get(normalized.seriesKey);
      if (
        !existingSeries ||
        Date.parse(normalized.lastWatchedAt) >= Date.parse(existingSeries.lastWatchedAt)
      ) {
        latestCustomSeries.set(normalized.seriesKey, normalized);
      }
    }
  }

  const itemsByRecency = [...byId.values()].filter((item) => {
    if (item.platform === 'youtube' && item.seriesKey) {
      return latestYoutubeSeries.get(item.seriesKey)?.id === item.id;
    }

    if (item.platform === 'custom' && item.seriesKey) {
      return latestCustomSeries.get(item.seriesKey)?.id === item.id;
    }

    return true;
  });

  return itemsByRecency.sort(
    (left, right) => Date.parse(right.lastWatchedAt) - Date.parse(left.lastWatchedAt),
  );
}

export function setMediaStorage(storage: MediaStorage): Promise<void> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('setMediaStorage');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve();
      return;
    }

    storageArea.set({ [STORAGE_KEY]: storage.items }, () => resolve());
  });
}

export function getMediaStorage(): Promise<MediaStorage> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('getMediaStorage');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve(defaultMediaStorage);
      return;
    }

    storageArea.get([STORAGE_KEY], (result) => {
      const rawItems = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const normalizedItems = normalizeMediaItems(rawItems);
      const hasChanged =
        JSON.stringify(rawItems) !== JSON.stringify(normalizedItems);

      if (hasChanged) {
        void setMediaStorage({ items: normalizedItems });
      }

      resolve({ items: normalizedItems });
    });
  });
}

export async function upsertMediaItem(item: MediaItem): Promise<void> {
  const currentStorage = await getMediaStorage();
  const nextItems = currentStorage.items.filter((existingItem) => {
    if (existingItem.id === item.id) {
      return false;
    }

    if (
      item.platform === 'youtube' &&
      item.seriesKey &&
      existingItem.platform === 'youtube' &&
      existingItem.seriesKey === item.seriesKey
    ) {
      return false;
    }

    if (
      item.platform === 'custom' &&
      item.seriesKey &&
      existingItem.platform === 'custom' &&
      existingItem.seriesKey === item.seriesKey
    ) {
      return false;
    }

    return true;
  });
  nextItems.push(item);
  nextItems.sort(
    (left, right) => Date.parse(right.lastWatchedAt) - Date.parse(left.lastWatchedAt),
  );
  await setMediaStorage({ items: nextItems });
}

export function setYouTubeChannels(channels: AllowedYouTubeChannel[]): Promise<void> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('setYouTubeChannels');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve();
      return;
    }

    const normalizedChannels = normalizeAllowedYouTubeChannels(channels);
    storageArea.set({ [YOUTUBE_CHANNELS_KEY]: normalizedChannels }, () => resolve());
  });
}

export function getYouTubeChannels(): Promise<AllowedYouTubeChannel[]> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('getYouTubeChannels');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve(DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel })));
      return;
    }

    storageArea.get([YOUTUBE_CHANNELS_KEY], (result) => {
      const hasStoredChannels = Object.prototype.hasOwnProperty.call(
        result,
        YOUTUBE_CHANNELS_KEY,
      );
      const rawChannels = Array.isArray(result[YOUTUBE_CHANNELS_KEY])
        ? result[YOUTUBE_CHANNELS_KEY]
        : DEFAULT_YOUTUBE_CHANNELS;
      const normalizedChannels = normalizeAllowedYouTubeChannels(rawChannels);
      const hasChanged =
        !hasStoredChannels ||
        JSON.stringify(rawChannels) !== JSON.stringify(normalizedChannels);

      if (hasChanged) {
        void setYouTubeChannels(normalizedChannels);
      }

      resolve(normalizedChannels);
    });
  });
}

export function setAnimeDomains(domains: AnimeDomain[]): Promise<void> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('setAnimeDomains');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve();
      return;
    }

    const normalizedDomains = normalizeAnimeDomains(domains);
    storageArea.set({ [ANIME_DOMAINS_KEY]: normalizedDomains }, () => resolve());
  });
}

export function getAnimeDomains(): Promise<AnimeDomain[]> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('getAnimeDomains');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve(DEFAULT_ANIME_DOMAINS.map((domain) => ({ ...domain })));
      return;
    }

    storageArea.get([ANIME_DOMAINS_KEY], (result) => {
      const hasStoredDomains = Object.prototype.hasOwnProperty.call(
        result,
        ANIME_DOMAINS_KEY,
      );
      const rawDomains = Array.isArray(result[ANIME_DOMAINS_KEY])
        ? result[ANIME_DOMAINS_KEY]
        : DEFAULT_ANIME_DOMAINS;
      const normalizedDomains = normalizeAnimeDomains(rawDomains);
      const hasChanged =
        !hasStoredDomains ||
        JSON.stringify(rawDomains) !== JSON.stringify(normalizedDomains);

      if (hasChanged) {
        void setAnimeDomains(normalizedDomains);
      }

      resolve(normalizedDomains);
    });
  });
}

export async function upsertAnimeDomain(
  domain: Omit<AnimeDomain, 'createdAt'> & { createdAt?: string },
): Promise<void> {
  const currentDomains = await getAnimeDomains();
  const nextDomain = normalizeAnimeDomain(domain);
  if (!nextDomain) {
    return;
  }

  const filteredDomains = currentDomains.filter((existingDomain) => {
    if (existingDomain.id === nextDomain.id) {
      return false;
    }

    return normalizeDomainKeyword(existingDomain.hostname) !== normalizeDomainKeyword(nextDomain.hostname);
  });

  filteredDomains.push(nextDomain);
  await setAnimeDomains(filteredDomains);
}

export async function removeAnimeDomain(domainId: string): Promise<void> {
  const currentDomains = await getAnimeDomains();
  const nextDomains = currentDomains.filter((domain) => domain.id !== domainId);
  await setAnimeDomains(nextDomains);
}

export async function upsertYouTubeChannel(
  channel: Omit<AllowedYouTubeChannel, 'createdAt'> & { createdAt?: string },
): Promise<void> {
  const currentChannels = await getYouTubeChannels();
  const nextChannel = normalizeAllowedYouTubeChannel(channel);
  if (!nextChannel) {
    return;
  }

  const filteredChannels = currentChannels.filter((existingChannel) => {
    if (existingChannel.id === nextChannel.id) {
      return false;
    }

    if (
      nextChannel.handle &&
      existingChannel.handle &&
      normalizeChannelHandle(existingChannel.handle) === normalizeChannelHandle(nextChannel.handle)
    ) {
      return false;
    }

    return normalizeChannelName(existingChannel.name) !== normalizeChannelName(nextChannel.name);
  });

  filteredChannels.push(nextChannel);
  await setYouTubeChannels(filteredChannels);
}

export async function removeYouTubeChannel(channelId: string): Promise<void> {
  const currentChannels = await getYouTubeChannels();
  const nextChannels = currentChannels.filter((channel) => channel.id !== channelId);
  await setYouTubeChannels(nextChannels);
}

export async function clearMediaStorage(): Promise<void> {
  await setMediaStorage(defaultMediaStorage);
}

export async function removeMediaItem(itemId: string): Promise<void> {
  const currentStorage = await getMediaStorage();
  const nextItems = currentStorage.items.filter((item) => item.id !== itemId);
  await setMediaStorage({ items: nextItems });
}

export async function importMediaItems(items: unknown[]): Promise<number> {
  const currentStorage = await getMediaStorage();
  const normalizedImportedItems = normalizeMediaItems(items);

  if (normalizedImportedItems.length === 0) {
    return 0;
  }

  const mergedItems = normalizeMediaItems([
    ...currentStorage.items,
    ...normalizedImportedItems,
  ]);

  await setMediaStorage({ items: mergedItems });
  return normalizedImportedItems.length;
}

export async function migrateStorage(): Promise<void> {
  await getMediaStorage();
  await getYouTubeChannels();
  await getAnimeDomains();
}
