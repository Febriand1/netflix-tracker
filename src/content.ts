import type { MediaItem } from './types/media';
import { extractGenericAnimeWatchData } from './platforms/genericAnime';
import {
  extractNetflixWatchData,
  isNetflixWatchPage,
  lookupNetflixEpisodeState,
} from './platforms/netflix';
import { extractYouTubeWatchData, isYouTubeWatchPage } from './platforms/youtube';
import { debounce } from './utils/debounce';

const DEBUG_PREFIX = '[Anime Watch Tracker]';
const STORAGE_KEY = 'items';
const SAVE_DEBOUNCE_MS = 1200;
const MIN_SAVE_INTERVAL_MS = 45000;
const INTERACTION_SAVE_INTERVAL_MS = 1500;

let lastProcessedUrl = window.location.href;
let lastSavedSignature = '';
let lastSavedAt = 0;
let lastInteractionSaveAt = 0;
let isContentScriptActive = true;
let pageObserver: MutationObserver | null = null;
const lastNetflixPublishedLookupAttemptAt = new Map<string, number>();
const cleanupCallbacks: Array<() => void> = [];
const scopedWindow = window as Window & {
  __animeWatchTrackerInitialized?: boolean;
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createYouTubeSeriesKey(title: string): string {
  const cleaned = title
    .replace(/\[[^\]]*indonesia[^\]]*\]/gi, '')
    .replace(/\([^)]*indonesia[^)]*\)/gi, '')
    .replace(/\s*-\s*(episode|ep)\.?\s*\d+\b.*$/i, '')
    .replace(/\s+(episode|ep)\.?\s*\d+\b.*$/i, '')
    .replace(/\s*-\s*\d+\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `youtube-series-${normalizeTitle(cleaned || title.trim())}`;
}

function createCustomSeriesKey(hostname: string, title: string): string {
  return `anime-domain-${normalizeTitle(hostname)}-${normalizeTitle(title)}`;
}

function isCustomInjectedPage(url: URL = new URL(window.location.href)): boolean {
  return !isNetflixWatchPage(url) && !isYouTubeWatchPage(url);
}

function isContextInvalidationError(error: unknown): boolean {
  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : null;

  return Boolean(message && /extension context invalidated/i.test(message));
}

function deactivateContentScript(error?: unknown): void {
  let runtimeMessage: string | null = null;
  try {
    runtimeMessage =
      typeof chrome !== 'undefined' && chrome.runtime?.lastError?.message
        ? chrome.runtime.lastError.message
        : null;
  } catch {
    runtimeMessage = null;
  }

  const shouldDeactivate =
    !isContentScriptActive ||
    (typeof chrome === 'undefined' || !chrome.runtime?.id) ||
    Boolean(runtimeMessage && /extension context invalidated/i.test(runtimeMessage)) ||
    isContextInvalidationError(error);

  if (!shouldDeactivate) {
    return;
  }

  isContentScriptActive = false;
  pageObserver?.disconnect();
  pageObserver = null;

  while (cleanupCallbacks.length > 0) {
    const cleanup = cleanupCallbacks.pop();
    cleanup?.();
  }

  console.debug(`${DEBUG_PREFIX} content script deactivated`, {
    href: window.location.href,
    reason: runtimeMessage ?? (error instanceof Error ? error.message : null),
  });
}

function isExtensionContextValid(): boolean {
  if (!isContentScriptActive) {
    return false;
  }

  try {
    return Boolean(
      typeof chrome !== 'undefined' &&
        chrome.runtime?.id &&
        chrome.storage?.local,
    );
  } catch (error) {
    deactivateContentScript(error);
    return false;
  }
}

function getStorageArea(): chrome.storage.StorageArea | null {
  if (!isExtensionContextValid()) {
    return null;
  }

  try {
    return chrome.storage.local;
  } catch (error) {
    deactivateContentScript(error);
    return null;
  }
}

function getStoredItems(): Promise<MediaItem[]> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      resolve([]);
      return;
    }

    try {
      storageArea.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          deactivateContentScript(chrome.runtime.lastError);
          resolve([]);
          return;
        }

        const items = Array.isArray(result[STORAGE_KEY]) ? (result[STORAGE_KEY] as MediaItem[]) : [];
        resolve(items);
      });
    } catch (error) {
      deactivateContentScript(error);
      resolve([]);
    }
  });
}

function setStoredItems(items: MediaItem[]): Promise<void> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      resolve();
      return;
    }

    try {
      storageArea.set({ [STORAGE_KEY]: items }, () => {
        if (chrome.runtime.lastError) {
          deactivateContentScript(chrome.runtime.lastError);
        }

        resolve();
      });
    } catch (error) {
      deactivateContentScript(error);
      resolve();
    }
  });
}

async function upsertMediaItem(item: MediaItem): Promise<void> {
  const items = (await getStoredItems()).filter((existingItem) => {
    if (existingItem.id === item.id) {
      return false;
    }

    if (
      item.platform === 'youtube' &&
      (item.seriesKey ?? createYouTubeSeriesKey(item.title)) &&
      existingItem.platform === 'youtube'
    ) {
      const currentSeriesKey = item.seriesKey ?? createYouTubeSeriesKey(item.title);
      const existingSeriesKey =
        existingItem.seriesKey ?? createYouTubeSeriesKey(existingItem.title);

      if (existingSeriesKey === currentSeriesKey) {
        return false;
      }
    }

    if (
      item.platform === 'custom' &&
      (item.seriesKey ?? createCustomSeriesKey(item.hostname ?? '', item.title)) &&
      existingItem.platform === 'custom'
    ) {
      const currentSeriesKey =
        item.seriesKey ?? createCustomSeriesKey(item.hostname ?? '', item.title);
      const existingSeriesKey =
        existingItem.seriesKey ??
        createCustomSeriesKey(existingItem.hostname ?? '', existingItem.title);

      if (existingSeriesKey === currentSeriesKey) {
        return false;
      }
    }

    return true;
  });
  items.push(item);
  items.sort(
    (left, right) => Date.parse(right.lastWatchedAt) - Date.parse(left.lastWatchedAt),
  );
  await setStoredItems(items);
}

function isSupportedWatchPage(url: URL = new URL(window.location.href)): boolean {
  return isNetflixWatchPage(url) || isYouTubeWatchPage(url) || isCustomInjectedPage(url);
}

async function extractCurrentWatchData(): Promise<MediaItem | null> {
  if (isNetflixWatchPage()) {
    return extractNetflixWatchData();
  }

  if (isYouTubeWatchPage()) {
    return extractYouTubeWatchData();
  }

  if (isCustomInjectedPage()) {
    return extractGenericAnimeWatchData();
  }

  return null;
}

function buildItemSignature(item: MediaItem): string {
  return [
    item.id,
    item.title,
    item.url,
    item.watchUrl ?? '',
    item.season ?? '',
    item.episode ?? '',
    item.episodeTitle ?? '',
    item.channel ?? '',
    item.duration ?? '',
    item.publishedAt ?? '',
    item.siteName ?? '',
    item.hostname ?? '',
    item.nextEpisode ?? '',
    item.nextEpisodeAvailableAt ?? '',
    item.hasNewEpisode ? '1' : '0',
  ].join('|');
}

async function processWatchState(reason: string): Promise<void> {
  if (!isExtensionContextValid() || !isSupportedWatchPage()) {
    return;
  }

  try {
    let item = await extractCurrentWatchData();
    if (!item) {
      return;
    }

    if (
      item.platform === 'netflix' &&
      (
        !item.publishedAt ||
        (!item.nextEpisode && !item.nextEpisodeAvailableAt && !item.hasNewEpisode)
      )
    ) {
      const now = Date.now();
      const lastLookupAt = lastNetflixPublishedLookupAttemptAt.get(item.id) ?? 0;

      if (now - lastLookupAt > 15 * 60 * 1000) {
        lastNetflixPublishedLookupAttemptAt.set(item.id, now);
        const episodeState = await lookupNetflixEpisodeState(item);

        if (!isExtensionContextValid()) {
          return;
        }

        item = {
          ...item,
          publishedAt: episodeState.publishedAt ?? item.publishedAt,
          nextEpisode: episodeState.nextEpisode ?? item.nextEpisode,
          nextEpisodeAvailableAt:
            episodeState.nextEpisodeAvailableAt ?? item.nextEpisodeAvailableAt,
          hasNewEpisode: episodeState.hasNewEpisode || item.hasNewEpisode === true,
        };
      }
    }

    const signature = buildItemSignature(item);
    const savedAtCheck = Date.now();
    if (
      signature === lastSavedSignature &&
      savedAtCheck - lastSavedAt < MIN_SAVE_INTERVAL_MS
    ) {
      return;
    }

    await upsertMediaItem(item);
    if (!isExtensionContextValid()) {
      return;
    }

    lastSavedSignature = signature;
    lastSavedAt = savedAtCheck;

    console.debug(`${DEBUG_PREFIX} saved watch item`, {
      reason,
      platform: item.platform,
      title: item.title,
      url: item.url,
    });
  } catch (error) {
    if (isContextInvalidationError(error)) {
      deactivateContentScript(error);
      return;
    }

    throw error;
  }
}

const scheduleSave = debounce((reason: string) => {
  if (!isExtensionContextValid()) {
    return;
  }

  void processWatchState(reason);
}, SAVE_DEBOUNCE_MS);

function handleUrlChange(reason: string): void {
  const currentUrl = window.location.href;
  if (currentUrl === lastProcessedUrl) {
    return;
  }

  lastProcessedUrl = currentUrl;
  lastSavedSignature = '';
  lastSavedAt = 0;
  console.debug(`${DEBUG_PREFIX} url changed`, { reason, url: currentUrl });

  if (isSupportedWatchPage()) {
    scheduleSave('url-change');
  }
}

function handleStorageChanges(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
): void {
  if (!isExtensionContextValid()) {
    return;
  }

  if (areaName !== 'local' || !changes.items) {
    return;
  }

  const nextItems = Array.isArray(changes.items.newValue) ? changes.items.newValue : [];
  if (nextItems.length > 0) {
    return;
  }

  lastSavedSignature = '';
  lastSavedAt = 0;

  if (isSupportedWatchPage()) {
    scheduleSave('storage-cleared');
  }
}

function observePageMutations(): void {
  pageObserver = new MutationObserver(() => {
    handleUrlChange('mutation');

    if (isSupportedWatchPage()) {
      scheduleSave('mutation');
    }
  });

  pageObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

function observeUserInteractions(): void {
  const handleInteraction = (): void => {
    if (!isSupportedWatchPage()) {
      return;
    }

    const now = Date.now();
    if (now - lastInteractionSaveAt < INTERACTION_SAVE_INTERVAL_MS) {
      return;
    }

    lastInteractionSaveAt = now;
    scheduleSave('interaction');
  };

  window.addEventListener('mousemove', handleInteraction, { passive: true });
  window.addEventListener('pointerdown', handleInteraction, { passive: true });
  window.addEventListener('keydown', handleInteraction);
  window.addEventListener('touchstart', handleInteraction, { passive: true });

  cleanupCallbacks.push(() => {
    window.removeEventListener('mousemove', handleInteraction);
    window.removeEventListener('pointerdown', handleInteraction);
    window.removeEventListener('keydown', handleInteraction);
    window.removeEventListener('touchstart', handleInteraction);
  });
}

function patchHistoryEvents(): void {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const wrapHistoryMethod = (methodName: 'pushState' | 'replaceState'): void => {
    const originalMethod = history[methodName];
    history[methodName] = function (...args) {
      const result = originalMethod.apply(this, args);
      window.dispatchEvent(new Event('anime-watch-tracker:urlchange'));
      return result;
    };
  };

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');

  const handlePopState = (): void => {
    window.dispatchEvent(new Event('anime-watch-tracker:urlchange'));
  };

  const handleTrackerUrlChange = (): void => {
    handleUrlChange('history');

    if (isSupportedWatchPage()) {
      scheduleSave('history');
    }
  };

  window.addEventListener('popstate', handlePopState);
  window.addEventListener('anime-watch-tracker:urlchange', handleTrackerUrlChange);

  cleanupCallbacks.push(() => {
    window.removeEventListener('popstate', handlePopState);
    window.removeEventListener('anime-watch-tracker:urlchange', handleTrackerUrlChange);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });
}

function init(): void {
  if (scopedWindow.__animeWatchTrackerInitialized) {
    return;
  }

  if (!isExtensionContextValid()) {
    return;
  }

  scopedWindow.__animeWatchTrackerInitialized = true;
  console.debug(`${DEBUG_PREFIX} initialized`, { href: window.location.href });
  patchHistoryEvents();
  observePageMutations();
  observeUserInteractions();
  chrome.storage.onChanged.addListener(handleStorageChanges);
  cleanupCallbacks.push(() => {
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.onChanged?.hasListener(handleStorageChanges)
      ) {
        chrome.storage.onChanged.removeListener(handleStorageChanges);
      }
    } catch {
      return;
    }
  });

  if (isSupportedWatchPage()) {
    scheduleSave('init');
  }
}

init();
