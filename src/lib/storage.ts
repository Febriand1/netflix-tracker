import type { WatchItem, WatchStorage } from '../types/watch';

const STORAGE_KEY = 'items';
const STORAGE_WARN_PREFIX = '[Anime Netflix Tracker]';

export const defaultWatchStorage: WatchStorage = {
  items: [],
};

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

export function getWatchStorage(): Promise<WatchStorage> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('getWatchStorage');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve(defaultWatchStorage);
      return;
    }

    storageArea.get([STORAGE_KEY], (result) => {
      const items = Array.isArray(result[STORAGE_KEY]) ? (result[STORAGE_KEY] as WatchItem[]) : [];
      resolve({ items });
    });
  });
}

export function setWatchStorage(storage: WatchStorage): Promise<void> {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      logStorageAvailability('setWatchStorage');
      console.warn(`${STORAGE_WARN_PREFIX} chrome.storage.local is unavailable`);
      resolve();
      return;
    }

    storageArea.set({ [STORAGE_KEY]: storage.items }, () => resolve());
  });
}
