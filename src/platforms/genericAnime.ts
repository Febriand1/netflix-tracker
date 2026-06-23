import type { AnimeDomain, MediaItem } from '../types/media';
import { cleanText, getMetaContent } from '../utils/dom';
import {
  normalizeHostname,
  normalizeTitle,
  createCustomSeriesKey,
} from '../utils/id';
import { ANIME_DOMAINS_KEY } from '../constants/storage';

const DEFAULT_ANIME_DOMAINS: AnimeDomain[] = [];

function getStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }

  return chrome.storage.local;
}

function normalizeAnimeDomain(value: unknown): AnimeDomain | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<AnimeDomain>;
  const name =
    typeof candidate.name === 'string'
      ? candidate.name.trim().replace(/\s+/g, ' ')
      : '';
  const hostname =
    typeof candidate.hostname === 'string'
      ? normalizeHostname(candidate.hostname)
      : '';
  if (!name || !hostname) {
    return null;
  }

  return {
    id:
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : normalizeTitle(name) || hostname,
    name,
    hostname,
    grantedOrigin:
      typeof candidate.grantedOrigin === 'string' &&
        candidate.grantedOrigin.trim().length > 0
        ? candidate.grantedOrigin.trim()
        : null,
    enabled: candidate.enabled !== false,
    createdAt:
      typeof candidate.createdAt === 'string' &&
        candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : new Date().toISOString(),
  };
}

function getAnimeDomains(): Promise<AnimeDomain[]> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      resolve(DEFAULT_ANIME_DOMAINS.map((domain) => ({ ...domain })));
      return;
    }

    storageArea.get([ANIME_DOMAINS_KEY], (result) => {
      const rawDomains = Array.isArray(result[ANIME_DOMAINS_KEY])
        ? result[ANIME_DOMAINS_KEY]
        : DEFAULT_ANIME_DOMAINS;
      const domains = rawDomains
        .map((domain) => normalizeAnimeDomain(domain))
        .filter((domain): domain is AnimeDomain => Boolean(domain));
      resolve(domains);
    });
  });
}

function extractTitle(): string | null {
  const selectorCandidates = [
    cleanText(
      document.querySelector<HTMLElement>('h1.entry-title')?.textContent,
    ),
    cleanText(document.querySelector<HTMLElement>('h1')?.textContent),
    cleanText(document.querySelector<HTMLElement>('.entry-title')?.textContent),
  ];

  for (const candidate of selectorCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  return (
    getMetaContent('meta[property="og:title"]') ?? cleanText(document.title)
  );
}

function normalizeUrl(value: string): string {
  try {
    const parsedUrl = new URL(value, window.location.origin);
    parsedUrl.hash = '';
    parsedUrl.search = '';
    return parsedUrl.toString();
  } catch {
    return value;
  }
}

function extractEpisodeCandidateTexts(): string[] {
  const values = [
    cleanText(
      document.querySelector<HTMLElement>('h1.entry-title')?.textContent,
    ),
    cleanText(document.querySelector<HTMLElement>('h1')?.textContent),
    cleanText(document.querySelector<HTMLElement>('.entry-title')?.textContent),
    cleanText(document.querySelector<HTMLElement>('.infozingle')?.textContent),
    cleanText(document.querySelector<HTMLElement>('.episodelist')?.textContent),
    getMetaContent('meta[property="og:title"]'),
    cleanText(document.title),
    window.location.pathname.replace(/[-_/]+/g, ' '),
  ];

  return values.filter((value): value is string => Boolean(value));
}

function extractEpisode(): string | null {
  const episodePatterns = [
    /\b(?:episode|ep|eps)\.?\s*(\d{1,4})\b/i,
    /\bepisode\s*[-:]?\s*(special|ova|movie)\b/i,
  ];

  for (const value of extractEpisodeCandidateTexts()) {
    for (const pattern of episodePatterns) {
      const match = value.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const episodeValue = match[1].toUpperCase();
      return /^\d+$/.test(episodeValue)
        ? `Episode ${episodeValue}`
        : `Episode ${episodeValue}`;
    }
  }

  return null;
}

function cleanSeriesTitle(value: string): string {
  const episodePattern =
    /\b(?:episode|ep|eps)\.?\s*(\d{1,4}|special|ova|movie)\b/i;
  const episodeMatch = value.match(episodePattern);
  const beforeEpisode =
    episodeMatch?.index !== undefined
      ? value.slice(0, episodeMatch.index)
      : value;

  return beforeEpisode
    .replace(/\bsubtitle\s*indonesia\b/gi, '')
    .replace(/\bsub\s*indo(?:nesia)?\b/gi, '')
    .replace(/\botakudesu\b/gi, '')
    .replace(/\s*[-|:]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeriesTitle(rawTitle: string): string {
  const seriesTitle = cleanSeriesTitle(rawTitle);
  return seriesTitle || rawTitle.trim();
}

function extractThumbnail(): string | null {
  return getMetaContent('meta[property="og:image"]');
}

function extractPublishedAt(): string | null {
  const metaCandidate = getMetaContent(
    'meta[property="article:published_time"]',
  );
  if (metaCandidate) {
    const timestamp = Date.parse(metaCandidate);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  const timeCandidate =
    document.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime;
  if (timeCandidate) {
    const timestamp = Date.parse(timeCandidate);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  return null;
}

function extractCanonicalUrl(): string {
  return normalizeUrl(
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ??
    window.location.href,
  );
}

function extractVideoSourceUrl(): string | null {
  const directVideoSrc =
    document.querySelector<HTMLVideoElement>('video')?.currentSrc;
  if (directVideoSrc) {
    return directVideoSrc;
  }

  const videoSourceSrc =
    document.querySelector<HTMLSourceElement>('video source')?.src;
  if (videoSourceSrc) {
    return videoSourceSrc;
  }

  const iframeSrc = document.querySelector<HTMLIFrameElement>('iframe')?.src;
  if (iframeSrc) {
    return iframeSrc;
  }

  return null;
}

function hasEmbeddedPlayer(): boolean {
  if (document.querySelector('video, video source')) {
    return true;
  }

  const iframeCandidates =
    document.querySelectorAll<HTMLIFrameElement>('iframe[src]');
  for (const iframe of iframeCandidates) {
    const src = iframe.src.toLowerCase();
    if (
      src &&
      !src.startsWith('about:blank') &&
      !/doubleclick|googlesyndication|googleads|disqus|facebook\.com\/plugins/i.test(
        src,
      )
    ) {
      return true;
    }
  }

  return Boolean(
    document.querySelector(
      '[class*="player"], [id*="player"], [class*="stream"], [id*="stream"]',
    ),
  );
}

function isLikelyListingPage(rawTitle: string, canonicalUrl: string): boolean {
  const normalizedTitle = rawTitle.toLowerCase();
  const normalizedUrl = canonicalUrl.toLowerCase();

  return (
    /\b(daftar episode|episode list|list episode|batch|complete|jadwal rilis|daftar anime|home|beranda)\b/i.test(
      normalizedTitle,
    ) ||
    /\/(daftar-anime|complete-series|jadwal-rilis|genre|batch)\b/i.test(
      normalizedUrl,
    )
  );
}

function isTrackableEpisodePage(
  rawTitle: string,
  canonicalUrl: string,
): boolean {
  if (isLikelyListingPage(rawTitle, canonicalUrl)) {
    return false;
  }

  const episode = extractEpisode();
  if (!episode) {
    return false;
  }

  return hasEmbeddedPlayer();
}

function findMatchingAnimeDomain(
  currentHostname: string,
  domains: AnimeDomain[],
): AnimeDomain | null {
  return (
    domains.find(
      (domain) => domain.enabled && currentHostname.includes(domain.hostname),
    ) ?? null
  );
}

export async function isCustomAnimePage(
  url: URL = new URL(window.location.href),
): Promise<boolean> {
  if (!/^https?:$/i.test(url.protocol)) {
    return false;
  }

  const domains = await getAnimeDomains();
  const normalizedCurrentHostname = normalizeHostname(url.hostname);
  return Boolean(findMatchingAnimeDomain(normalizedCurrentHostname, domains));
}

export async function extractGenericAnimeWatchData(): Promise<MediaItem | null> {
  const currentUrl = new URL(window.location.href);
  if (!/^https?:$/i.test(currentUrl.protocol)) {
    return null;
  }

  const domains = await getAnimeDomains();
  const normalizedCurrentHostname = normalizeHostname(currentUrl.hostname);
  const matchedDomain = findMatchingAnimeDomain(
    normalizedCurrentHostname,
    domains,
  );
  if (!matchedDomain) {
    return null;
  }

  const title = extractTitle();
  if (!title) {
    return null;
  }

  const canonicalUrl = extractCanonicalUrl();
  if (!isTrackableEpisodePage(title, canonicalUrl)) {
    return null;
  }

  const episode = extractEpisode();
  if (!episode) {
    return null;
  }

  const seriesTitle = extractSeriesTitle(title);
  const seriesKey = createCustomSeriesKey(
    normalizedCurrentHostname,
    seriesTitle,
  );
  const videoSourceUrl = extractVideoSourceUrl();

  return {
    id: seriesKey,
    platform: 'custom',
    title: seriesTitle,
    url: canonicalUrl,
    seriesKey,
    episode,
    thumbnail: extractThumbnail(),
    publishedAt: extractPublishedAt(),
    siteName: matchedDomain.name,
    hostname: normalizedCurrentHostname,
    creator: videoSourceUrl,
    lastWatchedAt: new Date().toISOString(),
  };
}
