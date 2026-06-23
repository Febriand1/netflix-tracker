import { getAnimeDomains, migrateStorage } from './utils/storage';
import { normalizeHostname } from './utils/id';



function createWildcardOriginFromExact(origin: string): string | null {
  try {
    const parsedUrl = new URL(origin.replace(/\/\*$/, ''));
    return `https://*.${normalizeHostname(parsedUrl.hostname)}/*`;
  } catch {
    return null;
  }
}

async function injectCustomTrackerIfNeeded(
  tabId: number,
  urlValue: string,
): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    return;
  }

  if (!/^https:$/i.test(parsedUrl.protocol)) {
    return;
  }

  if (
    parsedUrl.hostname.endsWith('netflix.com') ||
    parsedUrl.hostname === 'www.youtube.com' ||
    parsedUrl.hostname === 'youtube.com'
  ) {
    return;
  }

  const domains = await getAnimeDomains();
  const normalizedCurrentHostname = normalizeHostname(parsedUrl.hostname);
  const matchedDomain = domains.find(
    (domain) =>
      domain.enabled &&
      domain.grantedOrigin &&
      normalizedCurrentHostname.includes(normalizeHostname(domain.hostname)),
  );
  if (!matchedDomain?.grantedOrigin) {
    return;
  }

  const derivedWildcardOrigin = createWildcardOriginFromExact(matchedDomain.grantedOrigin);
  const hasExactPermission = await chrome.permissions.contains({
    origins: [matchedDomain.grantedOrigin],
  });
  const hasWildcardPermission = derivedWildcardOrigin
    ? await chrome.permissions.contains({
        origins: [derivedWildcardOrigin],
      })
    : false;
  if (!hasExactPermission && !hasWildcardPermission) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function refreshCustomInjectionAcrossOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    await injectCustomTrackerIfNeeded(tab.id, tab.url);
  }
}

function runMigration(reason: string): void {
  void migrateStorage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Anime Watch Tracker] storage migration failed during ${reason}`, message);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  runMigration('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  runMigration('onStartup');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) {
    return;
  }

  void injectCustomTrackerIfNeeded(tabId, tab.url).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Anime Watch Tracker] custom domain injection failed', message);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'anime-watch-tracker:refresh-custom-injection') {
    return;
  }

  void refreshCustomInjectionAcrossOpenTabs()
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error);
      console.warn('[Anime Watch Tracker] custom domain refresh failed', messageText);
      sendResponse({ ok: false });
    });

  return true;
});
