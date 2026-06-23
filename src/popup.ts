import './style.css';

import type {
  AllowedYouTubeChannel,
  AnimeDomain,
  MediaItem,
  Platform,
} from './types/media';
import {
  clearMediaStorage,
  getAnimeDomains,
  getMediaStorage,
  getYouTubeChannels,
  importMediaItems,
  removeAnimeDomain,
  removeMediaItem,
  removeYouTubeChannel,
  setAnimeDomains,
  setMediaItemArchived,
  upsertAnimeDomain,
  upsertYouTubeChannel,
  getLastFilter,
  setLastFilter,
} from './utils/storage';

type FilterValue = 'all' | Platform;
type ViewValue = 'history' | 'archives' | 'settings';
const DEBUG_PREFIX = '[Anime Watch Tracker]';
type YouTubeChannelDraft = {
  id: string | null;
  createdAt?: string;
  name: string;
  handle: string;
};
type AnimeDomainDraft = {
  id: string | null;
  createdAt?: string;
  name: string;
  currentDomain: string;
  hostname: string;
};

const app = document.querySelector<HTMLDivElement>('#app');
const currentUrl = new URL(window.location.href);
const initialViewParam = currentUrl.searchParams.get('view');
const isStandaloneDomainsView =
  currentUrl.searchParams.get('standalone') === '1';

if (!app) {
  throw new Error('Popup root element #app was not found.');
}

const popupRoot = app;
const state = {
  filter: 'all' as FilterValue,
  view:
    initialViewParam === 'settings'
      ? 'settings'
      : ('history' as ViewValue),
  youtubeChannelModalOpen: false,
  youtubeChannelDraft: {
    id: null,
    name: '',
    handle: '',
  } as YouTubeChannelDraft,
  animeDomainModalOpen: isStandaloneDomainsView,
  animeDomainRequestPermission: true,
  animeDomainDraft: {
    id: currentUrl.searchParams.get('domainId'),
    createdAt: currentUrl.searchParams.get('createdAt') ?? undefined,
    name: currentUrl.searchParams.get('name') ?? '',
    currentDomain: currentUrl.searchParams.get('currentDomain') ?? '',
    hostname: currentUrl.searchParams.get('hostname') ?? '',
  } as AnimeDomainDraft,
};

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const publishedDateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
});

const publishedDayFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
});

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatWatchTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return dateFormatter.format(new Date(timestamp));
}

function formatPublishedDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return publishedDateFormatter.format(new Date(timestamp));
}

function formatPublishedDay(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return publishedDayFormatter.format(new Date(timestamp));
}

function openUrl(url: string): void {
  chrome.tabs.create({ url });
}

function downloadJsonFile(items: MediaItem[]): void {
  const blob = new Blob([JSON.stringify({ items }, null, 2)], {
    type: 'application/json',
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `anime-watch-tracker-${new Date().toISOString()}.json`;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

async function importJsonFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text) as { items?: unknown };
  const importedItems = Array.isArray(parsed.items) ? parsed.items : [];
  const importedCount = await importMediaItems(importedItems);

  if (importedCount === 0) {
    throw new Error('No valid watch items found in the selected JSON file.');
  }
}

function createButton(
  text: string,
  onClick: () => void,
  variant: 'primary' | 'secondary' = 'secondary',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button button-${variant}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

const ICONS = {
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  archive: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
  unarchive: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="12" y1="12" x2="12" y2="16"></line><polyline points="10 14 12 12 14 14"></polyline></svg>`,
  delete: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`
};

function createIconButton(
  iconSvg: string,
  onClick: () => void,
  variant: 'primary' | 'secondary' | 'danger' = 'secondary',
  text?: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button icon-button-${variant}`;
  button.innerHTML = text ? `${iconSvg}<span>${text}</span>` : iconSvg;
  if (!text) {
    button.classList.add('icon-only');
  }
  button.addEventListener('click', onClick);
  return button;
}

function createFilterButton(label: string, value: FilterValue): HTMLElement {
  const isSelected = state.filter === value;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `filter-chip ${isSelected ? 'is-active' : ''}`;
  button.textContent = label;

  button.addEventListener('click', () => {
    if (state.filter !== value) {
      state.filter = value;
      void setLastFilter(value);
      void renderPopup();
    }
  });

  return button;
}

function createViewTabButton(
  label: string,
  value: ViewValue,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `view-tab${state.view === value ? ' is-active' : ''}`;
  button.textContent = label;
  button.addEventListener('click', () => {
    state.view = value;
    void renderPopup();
  });
  return button;
}

function createBadge(platform: Platform): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `platform-badge platform-${platform}`;
  badge.textContent =
    platform === 'netflix'
      ? 'Netflix'
      : platform === 'youtube'
        ? 'YouTube'
        : 'Custom';
  return badge;
}

function createUploadDayBadge(day: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'platform-badge upload-day-badge';
  badge.textContent = day;
  return badge;
}

function normalizeChannelHandle(value: string): string {
  return `@${value.trim().replace(/^@/, '').replace(/\s+/g, '')}`;
}

function normalizeDomainInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

function normalizeCurrentDomainInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

function sameAnimeDomainHostname(left: string, right: string): boolean {
  return normalizeDomainInput(left) === normalizeDomainInput(right);
}

function resetYouTubeChannelDraft(): void {
  state.youtubeChannelDraft = {
    id: null,
    name: '',
    handle: '',
  };
}

function closeYouTubeChannelModal(): void {
  state.youtubeChannelModalOpen = false;
}

function openYouTubeChannelModal(channel?: AllowedYouTubeChannel): void {
  if (channel) {
    state.youtubeChannelDraft = {
      id: channel.id,
      createdAt: channel.createdAt,
      name: channel.name,
      handle: channel.handle ?? '',
    };
  } else {
    resetYouTubeChannelDraft();
  }

  state.youtubeChannelModalOpen = true;
  void renderPopup();
}

function getValidatedYouTubeChannelDraft(): YouTubeChannelDraft {
  const name = state.youtubeChannelDraft.name.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new Error('Channel name is required.');
  }

  const handle = state.youtubeChannelDraft.handle.trim();

  return {
    ...state.youtubeChannelDraft,
    name,
    handle,
  };
}

async function saveYouTubeChannelFromDraft(
  channels: AllowedYouTubeChannel[],
): Promise<void> {
  const nextDraft = getValidatedYouTubeChannelDraft();
  const normalizedHandle = nextDraft.handle
    ? normalizeChannelHandle(nextDraft.handle)
    : null;
  const existingChannel = channels.find((channel) => {
    if (channel.id === nextDraft.id) {
      return true;
    }

    if (normalizedHandle && channel.handle) {
      return normalizeChannelHandle(channel.handle) === normalizedHandle;
    }

    return channel.name.trim().toLowerCase() === nextDraft.name.toLowerCase();
  });

  await upsertYouTubeChannel({
    id: nextDraft.id ?? existingChannel?.id ?? `youtube-channel-${Date.now()}`,
    name: nextDraft.name,
    handle: normalizedHandle ? `@${normalizedHandle}` : null,
    enabled: existingChannel?.enabled ?? true,
    createdAt: nextDraft.createdAt ?? existingChannel?.createdAt,
  });

  closeYouTubeChannelModal();
  resetYouTubeChannelDraft();
  await renderPopup();
}

function resetAnimeDomainDraft(): void {
  state.animeDomainDraft = {
    id: null,
    name: '',
    currentDomain: '',
    hostname: '',
  };
}

function closeAnimeDomainModal(): void {
  state.animeDomainModalOpen = false;
}

function openAnimeDomainModal(domain?: AnimeDomain): void {
  if (domain) {
    state.animeDomainDraft = {
      id: domain.id,
      createdAt: domain.createdAt,
      name: domain.name,
      currentDomain: domain.grantedOrigin
        ? normalizeCurrentDomainInput(domain.grantedOrigin)
        : '',
      hostname: domain.hostname,
    };
  } else if (!state.animeDomainDraft.id) {
    resetAnimeDomainDraft();
  }

  state.animeDomainModalOpen = true;
  void renderPopup();
}

function startAnimeDomainEdit(domain: AnimeDomain): void {
  openAnimeDomainModal(domain);
}

function getValidatedAnimeDomainDraft(): AnimeDomainDraft {
  const name = state.animeDomainDraft.name.trim().replace(/\s+/g, ' ');
  const currentDomain = normalizeCurrentDomainInput(
    state.animeDomainDraft.currentDomain,
  );
  const hostname = normalizeDomainInput(state.animeDomainDraft.hostname);

  if (!name) {
    throw new Error('Domain name is required.');
  }

  if (!currentDomain) {
    throw new Error('Current domain is required.');
  }

  if (!hostname) {
    throw new Error('Match keyword is required.');
  }

  return {
    ...state.animeDomainDraft,
    name,
    currentDomain,
    hostname,
  };
}

function buildAnimeDomainBase(domains: AnimeDomain[]): {
  nextDraft: AnimeDomainDraft;
  existingDomain: AnimeDomain | undefined;
  baseDomain: AnimeDomain;
} {
  const nextDraft = getValidatedAnimeDomainDraft();
  const existingDomain = domains.find((domain) =>
    sameAnimeDomainHostname(domain.hostname, nextDraft.hostname),
  );

  return {
    nextDraft,
    existingDomain,
    baseDomain: {
      id: nextDraft.id ?? existingDomain?.id ?? `anime-domain-${Date.now()}`,
      name: nextDraft.name,
      hostname: nextDraft.hostname,
      grantedOrigin: existingDomain?.grantedOrigin ?? null,
      enabled: true,
      createdAt:
        nextDraft.createdAt ??
        existingDomain?.createdAt ??
        new Date().toISOString(),
    },
  };
}

function mergeAnimeDomains(
  domains: AnimeDomain[],
  nextDomain: AnimeDomain,
): AnimeDomain[] {
  const filteredDomains = domains.filter((existingDomain) => {
    if (existingDomain.id === nextDomain.id) {
      return false;
    }

    return !sameAnimeDomainHostname(
      existingDomain.hostname,
      nextDomain.hostname,
    );
  });

  filteredDomains.push(nextDomain);
  return filteredDomains;
}

async function requestAnimeDomainPermission(
  currentDomain: string,
): Promise<string> {
  const normalizedCurrentDomain = normalizeCurrentDomainInput(currentDomain);
  const exactOrigin = `https://${normalizedCurrentDomain}/*`;
  const wildcardOrigin = `https://*.${normalizedCurrentDomain}/*`;
  console.debug(`${DEBUG_PREFIX} requesting anime domain permission`, {
    currentDomain,
    normalizedCurrentDomain,
    exactOrigin,
    wildcardOrigin,
  });

  const granted = await new Promise<boolean>((resolve, reject) => {
    if (!chrome.permissions?.request) {
      reject(
        new Error(
          'chrome.permissions.request is unavailable in this popup context.',
        ),
      );
      return;
    }

    chrome.permissions.request(
      {
        origins: [exactOrigin, wildcardOrigin],
      },
      (result) => {
        if (chrome.runtime.lastError?.message) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(Boolean(result));
      },
    );
  });

  console.debug(`${DEBUG_PREFIX} anime domain permission result`, {
    normalizedCurrentDomain,
    granted,
  });

  if (!granted) {
    throw new Error('Permission denied. Domain was not saved.');
  }

  return exactOrigin;
}

async function injectTrackerIntoActiveTabIfNeeded(
  hostnameKeyword: string,
): Promise<void> {
  if (!chrome.tabs?.query || !chrome.scripting?.executeScript) {
    console.debug(
      `${DEBUG_PREFIX} active tab injection skipped: API unavailable`,
    );
    return;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab?.id || !activeTab.url) {
    console.debug(
      `${DEBUG_PREFIX} active tab injection skipped: no active tab`,
    );
    return;
  }

  try {
    const parsedUrl = new URL(activeTab.url);
    if (
      !normalizeDomainInput(parsedUrl.hostname).includes(
        normalizeDomainInput(hostnameKeyword),
      )
    ) {
      console.debug(
        `${DEBUG_PREFIX} active tab injection skipped: hostname mismatch`,
        {
          activeHostname: parsedUrl.hostname,
          hostnameKeyword,
        },
      );
      return;
    }

    console.debug(`${DEBUG_PREFIX} injecting tracker into active tab`, {
      tabId: activeTab.id,
      url: activeTab.url,
      hostnameKeyword,
    });
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content.js'],
    });
    console.debug(`${DEBUG_PREFIX} tracker injected into active tab`, {
      tabId: activeTab.id,
      url: activeTab.url,
    });
  } catch {
    console.warn(
      `${DEBUG_PREFIX} active tab injection failed ${stringifyForLog({
        hostnameKeyword,
      })}`,
    );
    return;
  }
}

async function notifyBackgroundToInjectCustomDomain(): Promise<void> {
  if (!chrome.runtime?.sendMessage) {
    console.debug(
      `${DEBUG_PREFIX} background notify skipped: sendMessage unavailable`,
    );
    return;
  }

  try {
    console.debug(
      `${DEBUG_PREFIX} requesting background custom domain refresh`,
    );
    const response = await chrome.runtime.sendMessage({
      type: 'anime-watch-tracker:refresh-custom-injection',
    });
    console.debug(
      `${DEBUG_PREFIX} background custom domain refresh response`,
      response,
    );
  } catch {
    console.warn(`${DEBUG_PREFIX} background custom domain refresh failed`);
    return;
  }
}

async function saveAnimeDomainFromDraft(domains: AnimeDomain[]): Promise<void> {
  const { nextDraft, existingDomain, baseDomain } =
    buildAnimeDomainBase(domains);

  console.debug(`${DEBUG_PREFIX} anime domain save submitted`, {
    nextDraft,
    existingDomain,
    currentDomainCount: domains.length,
  });

  const grantedOrigin = await requestAnimeDomainPermission(
    nextDraft.currentDomain,
  );
  await upsertAnimeDomain({
    ...baseDomain,
    grantedOrigin,
  });

  console.debug(`${DEBUG_PREFIX} anime domain saved to storage`, {
    hostname: nextDraft.hostname,
    grantedOrigin,
    mode: nextDraft.id || existingDomain ? 'update-existing' : 'create-new',
  });

  await injectTrackerIntoActiveTabIfNeeded(nextDraft.hostname);
  await notifyBackgroundToInjectCustomDomain();
  closeAnimeDomainModal();
  resetAnimeDomainDraft();
  await renderPopup();
  window.alert(
    nextDraft.id || existingDomain
      ? 'Anime domain updated.'
      : 'Anime domain saved.',
  );
}

function saveAnimeDomainFromPopup(domains: AnimeDomain[]): void {
  let prepared:
    | {
        nextDraft: AnimeDomainDraft;
        existingDomain: AnimeDomain | undefined;
        baseDomain: AnimeDomain;
      }
    | undefined;

  try {
    prepared = buildAnimeDomainBase(domains);
  } catch (error) {
    const message = describeUnknownError(error);
    window.alert(message);
    return;
  }

  if (!prepared) {
    return;
  }

  const { nextDraft, existingDomain, baseDomain } = prepared;
  const nextDomains = mergeAnimeDomains(domains, baseDomain);
  void setAnimeDomains(nextDomains);

  console.debug(
    `${DEBUG_PREFIX} anime domain saved from popup before permission`,
    {
      nextDraft,
      existingDomain,
      requestPermissionNow: state.animeDomainRequestPermission,
    },
  );

  if (!state.animeDomainRequestPermission) {
    closeAnimeDomainModal();
    resetAnimeDomainDraft();
    void renderPopup();
    window.alert(
      `${nextDraft.id || existingDomain ? 'Anime domain updated.' : 'Anime domain saved.'} Permission bisa diminta nanti.`,
    );
    return;
  }

  void requestAnimeDomainPermission(nextDraft.currentDomain)
    .then(async (grantedOrigin) => {
      await upsertAnimeDomain({
        ...baseDomain,
        grantedOrigin,
      });
      await injectTrackerIntoActiveTabIfNeeded(nextDraft.hostname);
      await notifyBackgroundToInjectCustomDomain();
      closeAnimeDomainModal();
      resetAnimeDomainDraft();
      await renderPopup();
      window.alert(
        nextDraft.id || existingDomain
          ? 'Anime domain updated.'
          : 'Anime domain saved.',
      );
    })
    .catch((error: unknown) => {
      console.warn(
        `${DEBUG_PREFIX} anime domain popup permission failed ${stringifyForLog(
          {
            draft: nextDraft,
            errorMessage: describeUnknownError(error),
          },
        )}`,
      );
    });
}

// function createThumbnail(item: MediaItem): HTMLElement {
//   const frame = document.createElement('div');
//   frame.className = 'watch-thumb';

//   if (item.thumbnail) {
//     const image = document.createElement('img');
//     image.src = item.thumbnail;
//     image.alt = item.title;
//     image.loading = 'lazy';
//     frame.append(image);
//     return frame;
//   }

//   const fallback = document.createElement('div');
//   fallback.className = 'watch-thumb-fallback';
//   fallback.textContent = item.platform === 'netflix' ? 'N' : 'YT';
//   frame.append(fallback);
//   return frame;
// }

function buildMetadataText(item: MediaItem): string {
  if (item.platform === 'netflix') {
    if (item.episode && item.episodeTitle && item.episode === item.episodeTitle) {
      return item.episode;
    }
    return [item.episode, item.episodeTitle].filter(Boolean).join(' - ');
  }

  if (item.platform === 'custom') {
    return [item.episode, item.siteName].filter(Boolean).join(' - ');
  }

  return [item.episode, item.channel].filter(Boolean).join(' - ');
}

function buildNetflixEpisodeStatusText(item: MediaItem): string | null {
  if (item.platform !== 'netflix') {
    return null;
  }

  if (item.hasNewEpisode) {
    return item.nextEpisode
      ? `New episode available: ${item.nextEpisode}`
      : 'New episode available';
  }

  if (item.nextEpisode && item.nextEpisodeAvailableAt) {
    const formattedDate = formatPublishedDate(item.nextEpisodeAvailableAt);
    return formattedDate
      ? `Next episode: ${item.nextEpisode} - ${formattedDate}`
      : `Next episode: ${item.nextEpisode}`;
  }

  return null;
}

function createListRowBase(
  nameText: string,
  metaText: string,
  isEnabled: boolean,
  onToggle: () => void,
  onEdit: () => void,
  onDelete: () => void
): HTMLElement {
  const item = document.createElement('article');
  item.className = 'channel-item';

  const info = document.createElement('div');
  info.className = 'channel-item-info';

  const name = document.createElement('p');
  name.className = 'channel-item-name';
  name.textContent = nameText;

  const meta = document.createElement('p');
  meta.className = 'channel-item-meta';
  meta.textContent = metaText;

  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'channel-item-actions';
  actions.append(
    createButton(isEnabled ? 'Disable' : 'Enable', onToggle),
    createButton('Edit', onEdit),
    createButton('Delete', onDelete),
  );

  item.append(info, actions);
  return item;
}

function createYouTubeChannelRow(channel: AllowedYouTubeChannel): HTMLElement {
  const metaText = [channel.handle, channel.enabled ? 'Enabled' : 'Disabled']
    .filter(Boolean)
    .join(' - ');

  return createListRowBase(
    channel.name,
    metaText,
    channel.enabled,
    () => {
      void upsertYouTubeChannel({
        ...channel,
        enabled: !channel.enabled,
      }).then(() => renderPopup());
    },
    () => openYouTubeChannelModal(channel),
    () => {
      void removeYouTubeChannel(channel.id).then(() => renderPopup());
    }
  );
}

function createYouTubeChannelsSection(
  channels: AllowedYouTubeChannel[],
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'channels-panel';

  const header = document.createElement('div');
  header.className = 'channels-panel-header';

  const titleGroup = document.createElement('div');

  const title = document.createElement('h2');
  title.className = 'channels-panel-title';
  title.textContent = 'YouTube Channels';

  const subtitle = document.createElement('p');
  subtitle.className = 'channels-panel-copy';
  subtitle.textContent = 'Hanya video dari channel enabled yang akan disimpan.';

  titleGroup.append(title, subtitle);
  header.append(
    titleGroup,
    createButton('Add Channel', () => {
      openYouTubeChannelModal();
    }),
  );

  const list = document.createElement('div');
  list.className = 'channel-list';

  if (channels.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'channel-list-empty';
    empty.textContent =
      'Belum ada channel. Tambahkan satu channel untuk mulai tracking YouTube.';
    list.append(empty);
  } else {
    for (const channel of channels) {
      list.append(createYouTubeChannelRow(channel));
    }
  }

  section.append(header, list);

  if (state.youtubeChannelModalOpen) {
    section.append(createYouTubeChannelModal(channels));
  }

  return section;
}

function createYouTubeChannelModal(
  channels: AllowedYouTubeChannel[],
): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'domain-modal-overlay';

  const dialog = document.createElement('section');
  dialog.className = 'domain-modal';

  const title = document.createElement('h3');
  title.className = 'domain-form-title';
  title.textContent = state.youtubeChannelDraft.id
    ? 'Edit YouTube Channel'
    : 'Add YouTube Channel';

  const copy = document.createElement('p');
  copy.className = 'channels-panel-copy';
  copy.textContent =
    'Hanya channel enabled yang akan dipakai untuk tracking video YouTube.';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'domain-label';
  nameLabel.textContent = 'Channel name';

  const nameInput = document.createElement('input');
  nameInput.className = 'domain-input';
  nameInput.type = 'text';
  nameInput.placeholder = 'Channel name, e.g. Muse Indonesia';
  nameInput.value = state.youtubeChannelDraft.name;
  nameInput.addEventListener('input', () => {
    state.youtubeChannelDraft.name = nameInput.value;
  });

  const handleLabel = document.createElement('label');
  handleLabel.className = 'domain-label';
  handleLabel.textContent = 'Channel handle';

  const handleInput = document.createElement('input');
  handleInput.className = 'domain-input';
  handleInput.type = 'text';
  handleInput.placeholder = 'Optional handle, e.g. @MuseIndonesia';
  handleInput.value = state.youtubeChannelDraft.handle;
  handleInput.addEventListener('input', () => {
    state.youtubeChannelDraft.handle = handleInput.value;
  });

  const actions = document.createElement('div');
  actions.className = 'domain-form-actions';
  actions.append(
    createButton(
      'Save Channel',
      () => {
        void saveYouTubeChannelFromDraft(channels).catch((error: unknown) => {
          const message =
            describeUnknownError(error) || 'Failed to save YouTube channel.';
          console.warn(
            `${DEBUG_PREFIX} youtube channel save failed ${stringifyForLog({
              draft: state.youtubeChannelDraft,
              errorMessage: message,
              rawError: describeUnknownError(error),
            })}`,
          );
          window.alert(message);
        });
      },
      'primary',
    ),
    createButton('Cancel', () => {
      closeYouTubeChannelModal();
      void renderPopup();
    }),
  );

  dialog.append(
    title,
    copy,
    nameLabel,
    nameInput,
    handleLabel,
    handleInput,
    actions,
  );
  overlay.append(dialog);
  return overlay;
}

function createAnimeDomainRow(domain: AnimeDomain): HTMLElement {
  const metaText = [
    domain.hostname,
    domain.grantedOrigin
      ? normalizeCurrentDomainInput(domain.grantedOrigin)
      : 'Permission belum diberikan',
    domain.enabled ? 'Enabled' : 'Disabled',
  ]
    .filter(Boolean)
    .join(' - ');

  return createListRowBase(
    domain.name,
    metaText,
    domain.enabled,
    () => {
      void upsertAnimeDomain({
        ...domain,
        enabled: !domain.enabled,
      }).then(() => renderPopup());
    },
    () => startAnimeDomainEdit(domain),
    () => {
      void removeAnimeDomain(domain.id).then(() => renderPopup());
    }
  );
}

function createAnimeDomainsSection(domains: AnimeDomain[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'channels-panel';

  const header = document.createElement('div');
  header.className = 'channels-panel-header';

  const titleGroup = document.createElement('div');

  const title = document.createElement('h2');
  title.className = 'channels-panel-title';
  title.textContent = 'Anime Domains';

  const subtitle = document.createElement('p');
  subtitle.className = 'channels-panel-copy';
  subtitle.textContent = isStandaloneDomainsView
    ? 'Tab ini aman untuk grant permission dan save domain anime.'
    : 'Tambah atau edit domain lewat dialog, lalu lanjutkan grant permission.';

  titleGroup.append(title, subtitle);
  header.append(
    titleGroup,
    createButton('Add Domain', () => {
      resetAnimeDomainDraft();
      openAnimeDomainModal();
    }),
  );

  const list = document.createElement('div');
  list.className = 'channel-list';

  if (domains.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'channel-list-empty';
    empty.textContent =
      'Belum ada domain anime. Tambahkan satu domain untuk mulai tracking situs custom.';
    list.append(empty);
  } else {
    for (const domain of domains) {
      list.append(createAnimeDomainRow(domain));
    }
  }

  section.append(header, list);

  if (state.animeDomainModalOpen) {
    section.append(createAnimeDomainModal(domains));
  }

  return section;
}

function createAnimeDomainModal(domains: AnimeDomain[]): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'domain-modal-overlay';

  const dialog = document.createElement('section');
  dialog.className = 'domain-modal';

  const title = document.createElement('h3');
  title.className = 'domain-form-title';
  title.textContent = state.animeDomainDraft.id
    ? 'Edit Anime Domain'
    : 'Add Anime Domain';

  const copy = document.createElement('p');
  copy.className = 'channels-panel-copy';
  copy.textContent = isStandaloneDomainsView
    ? 'Klik Save Domain untuk meminta permission dan menyimpan domain.'
    : 'Klik Continue in Tab agar permission request dilakukan dari tab penuh, bukan popup.';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'domain-label';
  nameLabel.textContent = 'Domain name';

  const nameInput = document.createElement('input');
  nameInput.className = 'domain-input';
  nameInput.type = 'text';
  nameInput.placeholder = 'Name, e.g. Otakudesu';
  nameInput.value = state.animeDomainDraft.name;
  nameInput.addEventListener('input', () => {
    state.animeDomainDraft.name = nameInput.value;
  });

  const currentDomainLabel = document.createElement('label');
  currentDomainLabel.className = 'domain-label';
  currentDomainLabel.textContent = 'Current domain';

  const currentDomainInput = document.createElement('input');
  currentDomainInput.className = 'domain-input';
  currentDomainInput.type = 'text';
  currentDomainInput.placeholder = 'Current domain, e.g. otakudesu.blog';
  currentDomainInput.value = state.animeDomainDraft.currentDomain;
  currentDomainInput.addEventListener('input', () => {
    state.animeDomainDraft.currentDomain = currentDomainInput.value;
  });

  const hostnameLabel = document.createElement('label');
  hostnameLabel.className = 'domain-label';
  hostnameLabel.textContent = 'Match keyword';

  const hostnameInput = document.createElement('input');
  hostnameInput.className = 'domain-input';
  hostnameInput.type = 'text';
  hostnameInput.placeholder = 'Match keyword, e.g. otakudesu';
  hostnameInput.value = state.animeDomainDraft.hostname;
  hostnameInput.addEventListener('input', () => {
    state.animeDomainDraft.hostname = hostnameInput.value;
  });

  const permissionToggle = document.createElement('label');
  permissionToggle.className = 'domain-permission-toggle';

  const permissionCheckbox = document.createElement('input');
  permissionCheckbox.type = 'checkbox';
  permissionCheckbox.checked = state.animeDomainRequestPermission;
  permissionCheckbox.addEventListener('change', () => {
    state.animeDomainRequestPermission = permissionCheckbox.checked;
  });

  const permissionText = document.createElement('span');
  permissionText.textContent = isStandaloneDomainsView
    ? 'Minta permission domain sekarang'
    : 'Minta permission sekarang. Popup mungkin tertutup saat dialog Chrome muncul.';

  permissionToggle.append(permissionCheckbox, permissionText);

  const actions = document.createElement('div');
  actions.className = 'domain-form-actions';
  if (isStandaloneDomainsView) {
    actions.append(
      createButton(
        'Save Domain',
        () => {
          void saveAnimeDomainFromDraft(domains).catch((error: unknown) => {
            const message =
              describeUnknownError(error) || 'Failed to save anime domain.';
            console.warn(
              `${DEBUG_PREFIX} anime domain save failed ${stringifyForLog({
                draft: state.animeDomainDraft,
                errorMessage: message,
                rawError: describeUnknownError(error),
              })}`,
            );
            window.alert(message);
          });
        },
        'primary',
      ),
      createButton('Cancel', () => {
        closeAnimeDomainModal();
        void renderPopup();
      }),
    );
  } else {
    actions.append(
      createButton(
        'Save Domain',
        () => saveAnimeDomainFromPopup(domains),
        'primary',
      ),
      createButton('Cancel', () => {
        closeAnimeDomainModal();
        void renderPopup();
      }),
    );
  }

  dialog.append(
    title,
    copy,
    nameLabel,
    nameInput,
    currentDomainLabel,
    currentDomainInput,
    hostnameLabel,
    hostnameInput,
    permissionToggle,
    actions,
  );
  overlay.append(dialog);
  return overlay;
}

function createWatchCard(item: MediaItem): HTMLElement {
  const card = document.createElement('article');
  card.className = 'watch-card';

  const content = document.createElement('div');
  content.className = 'watch-card-content';

  const badgeRow = document.createElement('div');
  badgeRow.className = 'watch-card-badge-row';
  badgeRow.append(createBadge(item.platform));

  const title = document.createElement('h2');
  title.className = 'watch-card-title';
  title.textContent = item.title;

  const titleRow = document.createElement('div');
  titleRow.className = 'watch-card-title-row';
  titleRow.append(title);

  const metadata = document.createElement('p');
  metadata.className = 'watch-card-meta';
  metadata.textContent = buildMetadataText(item) || 'Metadata belum tersedia';

  const watchedAt = document.createElement('p');
  watchedAt.className = 'watch-card-time';
  watchedAt.textContent = `Last watched: ${formatWatchTime(item.lastWatchedAt)}`;

  const episodeStatus = document.createElement('p');
  episodeStatus.className = 'watch-card-time';
  const episodeStatusText = buildNetflixEpisodeStatusText(item);
  if (episodeStatusText) {
    episodeStatus.textContent = episodeStatusText;
  }

  const publishedAt = document.createElement('p');
  publishedAt.className = 'watch-card-time';
  const publishedText = formatPublishedDate(item.publishedAt);
  if (publishedText) {
    publishedAt.textContent = `Published: ${publishedText}`;
  }

  const publishedDayText = formatPublishedDay(item.publishedAt);
  if (publishedDayText) {
    titleRow.append(createUploadDayBadge(publishedDayText));
  }

  const footer = document.createElement('div');
  footer.className = 'watch-card-footer';
  
  const mainAction = createIconButton(
    ICONS.play,
    () => openUrl(item.url),
    'primary',
    item.platform === 'netflix' ? 'Netflix' : item.platform === 'youtube' ? 'YouTube' : 'Open Page'
  );
  mainAction.style.flexGrow = '1';

  footer.append(
    mainAction,
    createIconButton(
      item.isArchived ? ICONS.unarchive : ICONS.archive,
      () => void setMediaItemArchived(item.id, !item.isArchived).then(() => renderPopup()),
      'secondary'
    ),
    createIconButton(
      ICONS.delete,
      () => void removeMediaItem(item.id).then(() => renderPopup()),
      'danger'
    ),
  );

  content.append(badgeRow, titleRow, metadata, watchedAt);

  if (episodeStatusText) {
    content.append(episodeStatus);
  }

  if (publishedText) {
    content.append(publishedAt);
  }

  content.append(footer);
  card.append(content);
  return card;
}

function createEmptyState(): HTMLElement {
  const emptyState = document.createElement('section');
  emptyState.className = 'empty-state';

  const title = document.createElement('h2');
  title.textContent = 'Belum ada history';

  const description = document.createElement('p');
  description.textContent =
    'Buka Netflix, YouTube yang diizinkan, atau situs anime custom yang aktif, lalu riwayat akan muncul di sini.';

  emptyState.append(title, description);
  return emptyState;
}

function filterItems(items: MediaItem[]): MediaItem[] {
  const platformFiltered = state.filter === 'all' 
    ? items 
    : items.filter((item) => item.platform === state.filter);

  if (state.view === 'archives') {
    return platformFiltered.filter((item) => item.isArchived);
  }

  if (state.view === 'history') {
    return platformFiltered.filter((item) => !item.isArchived);
  }

  return platformFiltered;
}

async function renderPopup(): Promise<void> {
  const [storage, youtubeChannels, animeDomains] = await Promise.all([
    getMediaStorage(),
    getYouTubeChannels(),
    getAnimeDomains(),
  ]);
  const items = [...storage.items].sort(
    (left, right) =>
      Date.parse(right.lastWatchedAt) - Date.parse(left.lastWatchedAt),
  );
  const filteredItems = filterItems(items);

  popupRoot.replaceChildren();

  const container = document.createElement('main');
  container.className = 'popup-shell';

  const hero = document.createElement('header');
  hero.className = 'hero-panel';
  hero.innerHTML =
    '<p class="eyebrow">Local Extension</p><h1>Anime Watch Tracker</h1><p class="hero-copy">Riwayat anime dari Netflix dan YouTube tersimpan lokal di browser.</p>';

  const actions = document.createElement('div');
  actions.className = 'toolbar';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.className = 'visually-hidden';
  importInput.addEventListener('change', () => {
    const [file] = importInput.files ?? [];
    if (!file) {
      return;
    }

    void importJsonFile(file)
      .then(() => renderPopup())
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to import JSON file.';
        window.alert(message);
      })
      .finally(() => {
        importInput.value = '';
      });
  });

  actions.append(
    createButton('Import JSON', () => importInput.click()),
    createButton('Export JSON', () => downloadJsonFile(items)),
    createButton(
      'Clear History',
      () => void clearMediaStorage().then(() => renderPopup()),
      'primary',
    ),
  );

  const filters = document.createElement('div');
  filters.className = 'filter-row';
  filters.append(
    createFilterButton('All', 'all'),
    createFilterButton('Netflix', 'netflix'),
    createFilterButton('YouTube', 'youtube'),
    createFilterButton('Custom', 'custom'),
  );

  const tabs = document.createElement('div');
  tabs.className = 'view-tabs';
  tabs.append(
    createViewTabButton('History', 'history'),
    createViewTabButton('Archives', 'archives'),
    createViewTabButton('Settings', 'settings'),
  );

  const summary = document.createElement('section');
  summary.className = 'summary-panel';
  summary.innerHTML = `<p>${filteredItems.length} shown</p><span>${items.length} total item tersimpan</span>`;

  container.append(hero, tabs);

  if (state.view === 'history' || state.view === 'archives') {
    const content = document.createElement('section');
    content.className = 'content';

    if (filteredItems.length === 0) {
      if (state.view === 'archives') {
        const emptyState = createEmptyState();
        const title = emptyState.querySelector('h2');
        const desc = emptyState.querySelector('p');
        if (title) title.textContent = 'Belum ada arsip';
        if (desc) desc.textContent = 'Anime yang Anda arsipkan akan muncul di sini.';
        content.append(emptyState);
      } else {
        content.append(createEmptyState());
      }
    } else {
      for (const item of filteredItems) {
        content.append(createWatchCard(item));
      }
    }

    container.append(filters, summary, content);
  } else if (state.view === 'settings') {
    container.append(actions, importInput);
    container.append(createYouTubeChannelsSection(youtubeChannels));
    container.append(createAnimeDomainsSection(animeDomains));
  }

  popupRoot.append(container);
}

chrome.storage.onChanged.addListener(() => {
  void renderPopup();
});

void getLastFilter().then((filter) => {
  state.filter = filter as FilterValue;
  void renderPopup();
});
