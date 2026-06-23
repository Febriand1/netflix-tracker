import type { MediaItem } from '../types/media';
import { cleanText, getStructuredDataEntries } from '../utils/dom';

const DEBUG_PREFIX = '[Anime Watch Tracker]';

const TITLE_SELECTORS = [
  '[data-uia="player-header-title"]',
  '[data-uia="video-title"]',
  '[data-uia="video-title-link"]',
  '[data-uia="watch-video-title"]',
  '[data-uia="watch-video-title"] a',
  '.video-title h4',
  '.video-title a',
  '.watch-video h4',
  '.watch-video--player-view h4',
  '[class*="watch-video"] h4',
  '[class*="videoMetadata"] h4',
];

const TITLE_LINK_SELECTORS = [
  'a[href*="/title/"]',
  'a[href*="/browse"]',
  '.video-title a',
  '[data-uia="watch-video-title"] a',
  '[data-uia="video-title-link"]',
];

const METADATA_SELECTORS = [
  '[data-uia="watch-video-title"]',
  '[data-uia="watch-video-episode-title"]',
  '[data-uia="player-status-subtitle"]',
  '[data-uia="episode-title"]',
  '[data-uia="video-title"]',
  '.video-title',
  '[class*="episode"]',
  '[class*="metadata"]',
  '[class*="videoMetadata"]',
];

let lastTitleFailureDebugAt = 0;
let lastLoggedTitleSource = '';

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

function extractNumericId(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  const directMatch = text.match(/\b(\d{6,})\b/);
  return directMatch?.[1] ?? null;
}

function extractTitleIdFromNetflixUrl(urlValue: string | null | undefined): string | null {
  if (!urlValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(urlValue, window.location.origin);

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
      const extracted = extractNumericId(candidate);
      if (extracted) {
        return extracted;
      }
    }

    const decodedUrl = decodeURIComponent(parsedUrl.toString());
    const nestedTitleMatch = decodedUrl.match(/\/title\/(\d{6,})/i);
    if (nestedTitleMatch) {
      return nestedTitleMatch[1];
    }
  } catch {
    return extractNumericId(urlValue);
  }

  return null;
}

function extractTitleIdFromPageLinks(): string | null {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/title/"]');

  for (const link of links) {
    const titleId = extractTitleIdFromNetflixUrl(link.href);
    if (titleId) {
      return titleId;
    }
  }

  return null;
}

function extractTitleIdFromMeta(): string | null {
  const metaCandidates = [
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="twitter:url"]')?.content,
  ];

  for (const candidate of metaCandidates) {
    const titleId = extractTitleIdFromNetflixUrl(candidate);
    if (titleId) {
      return titleId;
    }
  }

  return null;
}

function extractTitleIdFromStructuredData(): string | null {
  const entries = getStructuredDataEntries();

  for (const entry of entries) {
    const urlCandidate =
      typeof entry.url === 'string'
        ? entry.url
        : typeof (entry.partOfSeries as Record<string, unknown> | undefined)?.url === 'string'
          ? ((entry.partOfSeries as Record<string, unknown>).url as string)
          : null;

    const titleId = extractTitleIdFromNetflixUrl(urlCandidate);
    if (titleId) {
      return titleId;
    }
  }

  return null;
}

function extractNetflixTitleId(): string | null {
  const currentUrl = window.location.href;
  const titleId =
    extractTitleIdFromNetflixUrl(currentUrl) ??
    extractTitleIdFromPageLinks() ??
    extractTitleIdFromMeta() ??
    extractTitleIdFromStructuredData();

  return titleId;
}

function buildNetflixOpenUrl(title: string, titleId: string | null): string {
  if (titleId) {
    return `https://www.netflix.com/title/${titleId}`;
  }

  return `https://www.netflix.com/search?q=${encodeURIComponent(title)}`;
}

function normalizeIsoDateString(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  return null;
}

function normalizeMonthDayDateString(value: string | null | undefined): string | null {
  const text = cleanText(value)?.replace(/\.$/, '');
  if (!text) {
    return null;
  }

  const directNormalized = normalizeIsoDateString(text);
  if (directNormalized) {
    return directNormalized;
  }

  const withCurrentYear = `${text}, ${new Date().getFullYear()}`;
  return normalizeIsoDateString(withCurrentYear);
}

function extractHumanReadableDateFromText(text: string | null | undefined): string | null {
  const normalizedText = cleanText(text);
  if (!normalizedText) {
    return null;
  }

  const monthPattern =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const patterns = [
    new RegExp(`\\b(?:available|coming)(?:\\s+on)?\\s+(${monthPattern}\\s+\\d{1,2}(?:,\\s*\\d{4})?)\\b`, 'i'),
    new RegExp(`\\b(${monthPattern}\\s+\\d{1,2},\\s*\\d{4})\\b`, 'i'),
    new RegExp(`\\b(${monthPattern}\\s+\\d{1,2})\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match) {
      continue;
    }

    const extractedDate = normalizeMonthDayDateString(match[1]);
    if (extractedDate) {
      return extractedDate;
    }
  }

  return null;
}

function extractDateFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeIsoDateString(value) ?? extractHumanReadableDateFromText(value);
  }

  return null;
}

function deepFindPublishedDate(
  input: unknown,
  depth = 0,
): string | null {
  if (!input || depth > 6 || typeof input !== 'object') {
    return null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = deepFindPublishedDate(item, depth + 1);
      if (found) {
        return found;
      }
    }

    return null;
  }

  const record = input as Record<string, unknown>;
  const directCandidates = [
    record.datePublished,
    record.releaseDate,
    record.availabilityStartTime,
    record.availabilityStarts,
    record.publishDate,
  ];

  for (const candidate of directCandidates) {
    const normalized = extractDateFromUnknown(candidate);
    if (normalized) {
      return normalized;
    }
  }

  for (const value of Object.values(record)) {
    const found = deepFindPublishedDate(value, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function parseEpisodeNumber(episode: string | null | undefined): number | null {
  const match = episode?.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

type NetflixEpisodeState = Pick<
  MediaItem,
  'publishedAt' | 'nextEpisode' | 'nextEpisodeAvailableAt' | 'hasNewEpisode'
>;

type EpisodeEntry = {
  episodeNumber: number;
  episodeLabel: string;
  availableAt: string | null;
};

function createEpisodeLabel(episodeNumber: number): string {
  return `Episode ${episodeNumber}`;
}

function extractEpisodeNumberFromText(text: string | null | undefined): number | null {
  const normalized = cleanText(text);
  if (!normalized) {
    return null;
  }

  const explicitMatch =
    normalized.match(/\bEpisode\s+(\d+)\b/i) ??
    normalized.match(/\bEp\.?\s*(\d+)\b/i) ??
    normalized.match(/\bE(\d+)\b/i);

  if (!explicitMatch) {
    return null;
  }

  return Number.parseInt(explicitMatch[1], 10);
}

function stringsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = cleanText(left)?.toLowerCase();
  const normalizedRight = cleanText(right)?.toLowerCase();

  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft === normalizedRight,
  );
}

function extractDirectDateFromRecord(record: Record<string, unknown>): string | null {
  const directCandidates = [
    record.datePublished,
    record.releaseDate,
    record.availabilityStartTime,
    record.availabilityStarts,
    record.publishDate,
    (record.availability as Record<string, unknown> | undefined)?.start,
    (record.availability as Record<string, unknown> | undefined)?.availabilityStartTime,
  ];

  for (const candidate of directCandidates) {
    const normalized = extractDateFromUnknown(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function recordMatchesEpisode(
  record: Record<string, unknown>,
  episodeTitle: string | null | undefined,
  episodeNumber: number | null,
): boolean {
  const titleCandidates = [
    typeof record.title === 'string' ? record.title : null,
    typeof record.name === 'string' ? record.name : null,
    typeof record.episodeTitle === 'string' ? record.episodeTitle : null,
    typeof record.subtitle === 'string' ? record.subtitle : null,
    typeof record.shortTitle === 'string' ? record.shortTitle : null,
  ];

  if (episodeTitle) {
    for (const titleCandidate of titleCandidates) {
      if (stringsEqual(titleCandidate, episodeTitle)) {
        return true;
      }
    }
  }

  if (episodeNumber !== null) {
    const numberCandidates = [
      record.episodeNumber,
      record.seq,
      record.index,
      record.number,
      record.episode,
    ];

    for (const candidate of numberCandidates) {
      const numericCandidate =
        typeof candidate === 'number'
          ? candidate
          : typeof candidate === 'string' && /^\d+$/.test(candidate)
            ? Number.parseInt(candidate, 10)
            : null;

      if (numericCandidate === episodeNumber) {
        return true;
      }
    }
  }

  return false;
}

function deepFindEpisodePublishedDate(
  input: unknown,
  episodeTitle: string | null | undefined,
  episodeNumber: number | null,
  depth = 0,
): string | null {
  if (!input || depth > 8 || typeof input !== 'object') {
    return null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = deepFindEpisodePublishedDate(
        item,
        episodeTitle,
        episodeNumber,
        depth + 1,
      );
      if (found) {
        return found;
      }
    }

    return null;
  }

  const record = input as Record<string, unknown>;

  if (recordMatchesEpisode(record, episodeTitle, episodeNumber)) {
    const directDate = extractDirectDateFromRecord(record);
    if (directDate) {
      return directDate;
    }
  }

  for (const value of Object.values(record)) {
    const found = deepFindEpisodePublishedDate(
      value,
      episodeTitle,
      episodeNumber,
      depth + 1,
    );
    if (found) {
      return found;
    }
  }

  return null;
}

function extractNetflixPublishedAtFromHtml(
  html: string,
  episodeTitle: string | null | undefined,
  episode: string | null | undefined,
): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const metaCandidates = [
    doc.querySelector<HTMLMetaElement>('meta[property="video:release_date"]')?.content,
    doc.querySelector<HTMLMetaElement>('meta[itemprop="datePublished"]')?.content,
  ];

  for (const candidate of metaCandidates) {
    const normalized = normalizeIsoDateString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const episodeListPublishedAt = extractNetflixPublishedAtFromEpisodeEntries(
    doc,
    episodeTitle,
    episode,
  );
  if (episodeListPublishedAt) {
    return episodeListPublishedAt;
  }

  const episodeNumber = parseEpisodeNumber(episode);
  const scripts = doc.querySelectorAll<HTMLScriptElement>('script');

  for (const script of scripts) {
    const content = cleanText(script.textContent);
    if (!content) {
      continue;
    }

    if (script.type === 'application/ld+json') {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown> | Array<Record<string, unknown>>;
        const entries = Array.isArray(parsed) ? parsed : [parsed];

        for (const entry of entries) {
          const episodePublishedAt = deepFindEpisodePublishedDate(
            entry,
            episodeTitle,
            episodeNumber,
          );
          if (episodePublishedAt) {
            return episodePublishedAt;
          }

          const generalPublishedAt = deepFindPublishedDate(entry);
          if (generalPublishedAt) {
            return generalPublishedAt;
          }
        }
      } catch {
        continue;
      }
    }

    const episodeSnippetAnchor = cleanText(episodeTitle);
    if (episodeSnippetAnchor) {
      const anchorIndex = content.toLowerCase().indexOf(episodeSnippetAnchor.toLowerCase());
      if (anchorIndex >= 0) {
        const snippet = content.slice(
          Math.max(0, anchorIndex - 1500),
          Math.min(content.length, anchorIndex + 1500),
        );
        const dateMatch = snippet.match(
          /"(?:datePublished|releaseDate|availabilityStartTime|availabilityStarts|publishDate)":"([^"]+)"/,
        );
        if (dateMatch) {
          const normalized = normalizeIsoDateString(dateMatch[1]);
          if (normalized) {
            return normalized;
          }
        }
      }
    }
  }

  return null;
}

function extractNetflixEpisodeStateFromHtml(
  html: string,
  episodeTitle: string | null | undefined,
  episode: string | null | undefined,
): NetflixEpisodeState {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const episodeState = extractNetflixEpisodeState(doc, episodeTitle, episode);

  return {
    publishedAt:
      episodeState.publishedAt ??
      extractNetflixPublishedAtFromHtml(html, episodeTitle, episode),
    nextEpisode: episodeState.nextEpisode,
    nextEpisodeAvailableAt: episodeState.nextEpisodeAvailableAt,
    hasNewEpisode: episodeState.hasNewEpisode,
  };
}

function getElementTextCandidates(element: Element): string[] {
  const candidates = new Set<string>();
  const textContent = cleanText(element.textContent);
  if (textContent) {
    candidates.add(textContent);
  }

  if (element instanceof HTMLElement) {
    const selfAttributes = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ];

    for (const attributeValue of selfAttributes) {
      const cleaned = cleanText(attributeValue);
      if (cleaned) {
        candidates.add(cleaned);
      }
    }
  }

  if (element instanceof HTMLImageElement) {
    const altText = cleanText(element.alt);
    if (altText) {
      candidates.add(altText);
    }
  }

  const attributedDescendants = element.querySelectorAll<HTMLElement>('[aria-label], [title], img[alt]');
  for (const descendant of attributedDescendants) {
    const attributeValues = [
      descendant.getAttribute('aria-label'),
      descendant.getAttribute('title'),
    ];

    for (const attributeValue of attributeValues) {
      const cleaned = cleanText(attributeValue);
      if (cleaned) {
        candidates.add(cleaned);
      }
    }
  }

  const imageDescendants = element.querySelectorAll<HTMLImageElement>('img[alt]');
  for (const image of imageDescendants) {
    const altText = cleanText(image.alt);
    if (altText) {
      candidates.add(altText);
    }
  }

  return [...candidates];
}

function extractEpisodeEntries(root: ParentNode): EpisodeEntry[] {
  const selectors = [
    '[data-uia*="episode"]',
    '[class*="episode"]',
    'li',
    'button',
    'article',
    '[role="button"]',
  ];
  const candidates = root.querySelectorAll<Element>(selectors.join(','));
  const entriesByNumber = new Map<number, EpisodeEntry>();

  for (const element of candidates) {
    const textCandidates = getElementTextCandidates(element);
    if (textCandidates.length === 0) {
      continue;
    }

    const combinedText = textCandidates.join(' | ');
    const episodeNumber = extractEpisodeNumberFromText(combinedText);
    if (episodeNumber === null) {
      continue;
    }

    let availableAt: string | null = null;
    for (const candidate of textCandidates) {
      const extractedDate = extractHumanReadableDateFromText(candidate);
      if (extractedDate) {
        availableAt = extractedDate;
        break;
      }
    }

    const nextEntry: EpisodeEntry = {
      episodeNumber,
      episodeLabel: createEpisodeLabel(episodeNumber),
      availableAt,
    };
    const existingEntry = entriesByNumber.get(episodeNumber);

    if (
      !existingEntry ||
      (!existingEntry.availableAt && nextEntry.availableAt)
    ) {
      entriesByNumber.set(episodeNumber, nextEntry);
    }
  }

  return [...entriesByNumber.values()].sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  );
}

function extractNetflixEpisodeStateFromEntries(
  entries: EpisodeEntry[],
  episode: string | null | undefined,
): Pick<MediaItem, 'nextEpisode' | 'nextEpisodeAvailableAt' | 'hasNewEpisode'> {
  const currentEpisodeNumber = parseEpisodeNumber(episode);
  if (currentEpisodeNumber === null) {
    return {
      nextEpisode: null,
      nextEpisodeAvailableAt: null,
      hasNewEpisode: false,
    };
  }

  const nextEntry = entries.find((entry) => entry.episodeNumber > currentEpisodeNumber);
  if (!nextEntry) {
    return {
      nextEpisode: null,
      nextEpisodeAvailableAt: null,
      hasNewEpisode: false,
    };
  }

  const availableAtTimestamp = nextEntry.availableAt
    ? Date.parse(nextEntry.availableAt)
    : Number.NaN;
  const hasNewEpisode =
    !nextEntry.availableAt ||
    (!Number.isNaN(availableAtTimestamp) && availableAtTimestamp <= Date.now());

  return {
    nextEpisode: nextEntry.episodeLabel,
    nextEpisodeAvailableAt: hasNewEpisode ? null : nextEntry.availableAt,
    hasNewEpisode,
  };
}

function episodeTextMatches(
  text: string,
  episodeTitle: string | null | undefined,
  episodeNumber: number | null,
): boolean {
  const normalizedText = cleanText(text)?.toLowerCase();
  if (!normalizedText) {
    return false;
  }

  if (episodeTitle) {
    const normalizedEpisodeTitle = cleanText(episodeTitle)?.toLowerCase();
    if (normalizedEpisodeTitle && normalizedText.includes(normalizedEpisodeTitle)) {
      return true;
    }
  }

  if (episodeNumber !== null) {
    const episodePatterns = [
      new RegExp(`\\bepisode\\s*${episodeNumber}\\b`, 'i'),
      new RegExp(`\\be\\s*${episodeNumber}\\b`, 'i'),
      new RegExp(`\\b${episodeNumber}\\b`, 'i'),
    ];

    for (const pattern of episodePatterns) {
      if (pattern.test(normalizedText)) {
        return true;
      }
    }
  }

  return false;
}

function extractNetflixPublishedAtFromEpisodeEntries(
  root: ParentNode,
  episodeTitle: string | null | undefined,
  episode: string | null | undefined,
): string | null {
  const episodeNumber = parseEpisodeNumber(episode);
  if (!episodeTitle && episodeNumber === null) {
    return null;
  }

  const selectors = [
    '[data-uia*="episode"]',
    '[class*="episode"]',
    'li',
    'button',
    'article',
    '[role="button"]',
  ];
  const candidates = root.querySelectorAll<Element>(selectors.join(','));

  for (const element of candidates) {
    const textCandidates = getElementTextCandidates(element);
    if (textCandidates.length === 0) {
      continue;
    }

    const isMatchingEpisode = textCandidates.some((candidate) =>
      episodeTextMatches(candidate, episodeTitle, episodeNumber),
    );
    if (!isMatchingEpisode) {
      continue;
    }

    for (const candidate of textCandidates) {
      const publishedAt =
        extractDateFromUnknown(candidate) ?? extractHumanReadableDateFromText(candidate);
      if (publishedAt) {
        return publishedAt;
      }
    }
  }

  return null;
}

function extractNetflixEpisodeState(
  root: ParentNode,
  episodeTitle: string | null | undefined,
  episode: string | null | undefined,
): NetflixEpisodeState {
  const entries = extractEpisodeEntries(root);
  const nextEpisodeState = extractNetflixEpisodeStateFromEntries(entries, episode);

  return {
    publishedAt: extractNetflixPublishedAtFromEpisodeEntries(root, episodeTitle, episode),
    nextEpisode: nextEpisodeState.nextEpisode,
    nextEpisodeAvailableAt: nextEpisodeState.nextEpisodeAvailableAt,
    hasNewEpisode: nextEpisodeState.hasNewEpisode,
  };
}

function extractNetflixPublishedAtFromInlineScripts(): string | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script');

  for (const script of scripts) {
    const content = cleanText(script.textContent);
    if (!content) {
      continue;
    }

    const patterns = [
      /"datePublished":"([^"]+)"/,
      /"releaseDate":"([^"]+)"/,
      /"availabilityStartTime":"([^"]+)"/,
      /"availabilityStarts":"([^"]+)"/,
      /"publishDate":"([^"]+)"/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (!match) {
        continue;
      }

      const normalized = normalizeIsoDateString(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function extractNetflixPublishedAtFromWindowState(): string | null {
  const scopedWindow = window as Window & {
    netflix?: unknown;
    __INITIAL_STATE__?: unknown;
    __PRELOADED_STATE__?: unknown;
  };

  return (
    deepFindPublishedDate(scopedWindow.__INITIAL_STATE__) ??
    deepFindPublishedDate(scopedWindow.__PRELOADED_STATE__) ??
    deepFindPublishedDate(scopedWindow.netflix)
  );
}

function extractNetflixPublishedAt(
  episodeTitle: string | null | undefined,
  episode: string | null | undefined,
): string | null {
  const metaCandidates = [
    document.querySelector<HTMLMetaElement>('meta[property="video:release_date"]')
      ?.content,
    document.querySelector<HTMLMetaElement>('meta[itemprop="datePublished"]')
      ?.content,
  ];

  for (const candidate of metaCandidates) {
    const normalized = normalizeIsoDateString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const episodeState = extractNetflixEpisodeState(document, episodeTitle, episode);
  if (episodeState.publishedAt) {
    return episodeState.publishedAt;
  }

  const windowStatePublishedAt = extractNetflixPublishedAtFromWindowState();
  if (windowStatePublishedAt) {
    return windowStatePublishedAt;
  }

  const entries = getStructuredDataEntries();

  for (const entry of entries) {
    const candidates = [
      typeof entry.datePublished === 'string' ? entry.datePublished : null,
      typeof entry.releaseDate === 'string' ? entry.releaseDate : null,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeIsoDateString(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  const inlineScriptPublishedAt = extractNetflixPublishedAtFromInlineScripts();
  if (inlineScriptPublishedAt) {
    return inlineScriptPublishedAt;
  }

  return null;
}

export async function lookupNetflixPublishedAt(
  item: Pick<MediaItem, 'url' | 'watchUrl' | 'episode' | 'episodeTitle'>,
): Promise<string | null> {
  const titleId =
    extractTitleIdFromNetflixUrl(item.url) ??
    extractTitleIdFromNetflixUrl(item.watchUrl);

  if (!titleId) {
    return null;
  }

  const titleUrl = `https://www.netflix.com/title/${titleId}`;

  try {
    const response = await fetch(titleUrl, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractNetflixPublishedAtFromHtml(
      html,
      item.episodeTitle ?? null,
      item.episode ?? null,
    );
  } catch {
    return null;
  }
}

export async function lookupNetflixEpisodeState(
  item: Pick<MediaItem, 'url' | 'watchUrl' | 'episode' | 'episodeTitle'>,
): Promise<NetflixEpisodeState> {
  const titleId =
    extractTitleIdFromNetflixUrl(item.url) ??
    extractTitleIdFromNetflixUrl(item.watchUrl);

  if (!titleId) {
    return {
      publishedAt: null,
      nextEpisode: null,
      nextEpisodeAvailableAt: null,
      hasNewEpisode: false,
    };
  }

  const titleUrl = `https://www.netflix.com/title/${titleId}`;

  try {
    const response = await fetch(titleUrl, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        publishedAt: null,
        nextEpisode: null,
        nextEpisodeAvailableAt: null,
        hasNewEpisode: false,
      };
    }

    const html = await response.text();
    return extractNetflixEpisodeStateFromHtml(
      html,
      item.episodeTitle ?? null,
      item.episode ?? null,
    );
  } catch {
    return {
      publishedAt: null,
      nextEpisode: null,
      nextEpisodeAvailableAt: null,
      hasNewEpisode: false,
    };
  }
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^[`"']+|[`"']+$/g, '').trim();
}

function isIgnoredTitleText(text: string): boolean {
  return (
    /^Netflix$/i.test(text) ||
    /^rated\s*\d+\+?$/i.test(text) ||
    /^(tv|pg|nc|ma|r)[-\s]?\d*[a-z+]*$/i.test(text) ||
    /^skip intro$/i.test(text)
  );
}

function getTextsFromSelectors(selectors: string[]): string[] {
  const results = new Set<string>();

  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector);

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (text) {
        results.add(text);
      }
    }
  }

  return [...results];
}

function getAttributeTextsFromSelectors(
  selectors: string[],
  attributes: string[],
): string[] {
  const results = new Set<string>();

  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector);

    for (const node of nodes) {
      for (const attribute of attributes) {
        const text = cleanText(node.getAttribute(attribute));
        if (text) {
          results.add(text);
        }
      }
    }
  }

  return [...results];
}

function findFirstMatchingText(
  selectors: string[],
): { selector: string; text: string } | null {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector);

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (text) {
        return { selector, text };
      }
    }
  }

  return null;
}

function extractVideoTitleBlockData(): {
  title: string | null;
  episode: string | null;
  episodeTitle: string | null;
  rawText: string | null;
  selector: string;
} | null {
  const blocks = document.querySelectorAll<HTMLElement>('[data-uia="video-title"]');

  for (const block of blocks) {
    const title = cleanText(block.querySelector('h4')?.textContent);
    if (!title || isIgnoredTitleText(title) || isEpisodeMetadataText(title)) {
      continue;
    }

    const spanTexts = [...block.querySelectorAll('span')]
      .map((node) => cleanText(node.textContent))
      .filter((value): value is string => Boolean(value));

    const shorthandEpisode = spanTexts.find((text) => /^E\d+$/i.test(text)) ?? null;
    const explicitEpisode = spanTexts.find((text) => /^Episode\s+\d+$/i.test(text)) ?? null;
    const episodeNumber =
      shorthandEpisode?.match(/\d+/)?.[0] ?? explicitEpisode?.match(/\d+/)?.[0] ?? null;
    const episode = episodeNumber ? `Episode ${episodeNumber}` : explicitEpisode;
    const episodeTitle =
      spanTexts.find((text) => !/^E\d+$/i.test(text) && !/^Episode\s+\d+$/i.test(text)) ?? null;

    return {
      title,
      episode,
      episodeTitle,
      rawText: cleanText(block.textContent),
      selector: '[data-uia="video-title"]',
    };
  }

  return null;
}

function findEpisodeMarkerIndex(text: string): number {
  const combinedPatterns = [
    /S\d+\s*:\s*E\d+/i,
    /Season\s+\d+\s+Episode\s+\d+/i,
    /E\d+(?=[A-Z"'`\s]|$)/i,
  ];

  let bestIndex = -1;

  for (const pattern of combinedPatterns) {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) {
      continue;
    }

    const candidateIndex = match.index;
    if (bestIndex === -1 || candidateIndex < bestIndex) {
      bestIndex = candidateIndex;
    }
  }

  if (bestIndex <= 0) {
    return bestIndex;
  }

  const previousChar = text[bestIndex - 1];
  if (previousChar && /[A-Za-z0-9)]/.test(previousChar)) {
    return bestIndex;
  }

  return bestIndex;
}

function splitCombinedTitleCandidate(text: string): {
  title: string | null;
  metadata: string | null;
} {
  const cleaned = cleanText(stripWrappingQuotes(text));
  if (!cleaned) {
    return { title: null, metadata: null };
  }

  const markerIndex = findEpisodeMarkerIndex(cleaned);
  if (markerIndex <= 0) {
    return { title: cleaned, metadata: null };
  }

  return {
    title: cleanText(cleaned.slice(0, markerIndex)),
    metadata: cleanText(cleaned.slice(markerIndex)),
  };
}

function collectFallbackCombinedCandidates(): string[] {
  const results = new Set<string>();
  const attributeCandidates = getAttributeTextsFromSelectors(
    ['a', '[aria-label]', '[title]', 'img[alt]', '[data-uia]'],
    ['aria-label', 'title', 'alt'],
  );

  for (const candidate of attributeCandidates) {
    const normalized = normalizeMetadataText(candidate);
    if (findEpisodeMarkerIndex(normalized) > 0) {
      results.add(normalized);
    }
  }

  if (!document.body) {
    return [...results];
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const tagName = parent.tagName.toLowerCase();
      if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
        return NodeFilter.FILTER_REJECT;
      }

      const text = cleanText(node.textContent);
      if (!text || text.length < 4 || text.length > 200) {
        return NodeFilter.FILTER_REJECT;
      }

      if (findEpisodeMarkerIndex(normalizeMetadataText(text)) <= 0) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let currentNode = walker.nextNode();
  let count = 0;
  while (currentNode && count < 400) {
    const text = cleanText(currentNode.textContent);
    if (text) {
      results.add(normalizeMetadataText(text));
    }

    currentNode = walker.nextNode();
    count += 1;
  }

  return [...results];
}

function normalizeMetadataText(text: string): string {
  return text
    .replace(/(S\d+\s*:\s*E\d+)(?=[A-Z"'`])/g, '$1 ')
    .replace(/(Season\s+\d+\s+Episode\s+\d+)(?=[A-Z"'`])/gi, '$1 ')
    .replace(/(E(?:pisode)?\s*\d+)(?=[A-Z"'`])/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function logTitleExtractionFailure(): void {
  const now = Date.now();
  if (now - lastTitleFailureDebugAt < 5000) {
    return;
  }

  lastTitleFailureDebugAt = now;

  console.debug(`${DEBUG_PREFIX} title diagnostics`, {
    href: window.location.href,
    documentTitle: cleanText(document.title),
    titleCandidates: getTextsFromSelectors(TITLE_SELECTORS),
    linkedTitleCandidates: getTextsFromSelectors(TITLE_LINK_SELECTORS),
    metadataCandidates: getTextsFromSelectors(METADATA_SELECTORS),
    fallbackCombinedCandidates: collectFallbackCombinedCandidates(),
  });
}

function logResolvedTitle(
  source: string,
  title: string,
  details?: Record<string, unknown>,
): void {
  const signature = `${source}:${title}:${JSON.stringify(details ?? {})}`;
  if (signature === lastLoggedTitleSource) {
    return;
  }

  lastLoggedTitleSource = signature;
  console.debug(`${DEBUG_PREFIX} title resolved`, {
    source,
    title,
    href: window.location.href,
    ...details,
  });
}

export function isNetflixWatchPage(url: URL = new URL(window.location.href)): boolean {
  return url.hostname.endsWith('netflix.com') && url.pathname.includes('/watch/');
}

export function isEpisodeMetadataText(text: string): boolean {
  const normalized = cleanText(text);
  if (!normalized) {
    return false;
  }

  const metadataText = normalizeMetadataText(normalized);
  return /^(?:s\d+\s*:\s*e\d+\b|s(?:eason)?\s+\d+\s*[:,-]?\s*e(?:pisode)?\s+\d+\b|season\s+\d+\s+episode\s+\d+\b|e(?:pisode)?\s*\d+\b)/i.test(
    metadataText,
  );
}

function extractTitleFromDocumentTitle(): string | null {
  const pageTitle = cleanText(document.title);
  if (!pageTitle) {
    return null;
  }

  const cleanedTitle = stripWrappingQuotes(
    pageTitle
      .replace(/\s*\|\s*Netflix(?:\s+Official\s+Site)?\s*$/i, '')
      .replace(/^Watch\s+/i, '')
      .trim(),
  );

  if (
    !cleanedTitle ||
    isIgnoredTitleText(cleanedTitle) ||
    isEpisodeMetadataText(cleanedTitle)
  ) {
    return null;
  }

  return cleanedTitle;
}

function extractTitleFromMetaTags(): string | null {
  const metaCandidates = [
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.content,
  ];

  for (const candidate of metaCandidates) {
    const cleaned = candidate
      ? stripWrappingQuotes(candidate.replace(/\s*\|\s*Netflix.*$/i, '').trim())
      : null;

    if (
      cleaned &&
      !isIgnoredTitleText(cleaned) &&
      !isEpisodeMetadataText(cleaned)
    ) {
      return cleaned;
    }
  }

  return null;
}

function extractTitleFromStructuredData(): string | null {
  const entries = getStructuredDataEntries();

  for (const entry of entries) {
    const partOfSeries = entry.partOfSeries as
      | Record<string, unknown>
      | undefined;
    const seriesName = cleanText(
      typeof partOfSeries?.name === 'string' ? partOfSeries.name : null,
    );
    if (
      seriesName &&
      !isIgnoredTitleText(seriesName) &&
      !isEpisodeMetadataText(seriesName)
    ) {
      return stripWrappingQuotes(seriesName);
    }

    const name = cleanText(typeof entry.name === 'string' ? entry.name : null);
    if (
      name &&
      !/^Watch\b/i.test(name) &&
      !isIgnoredTitleText(name) &&
      !isEpisodeMetadataText(name)
    ) {
      return stripWrappingQuotes(name.replace(/\s*\|\s*Netflix.*$/i, ''));
    }
  }

  return null;
}

function pickSeriesTitle(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const { title } = splitCombinedTitleCandidate(candidate);
    if (!title || isIgnoredTitleText(title) || isEpisodeMetadataText(title)) {
      continue;
    }

    return title;
  }

  return null;
}

function extractTitle(): string | null {
  const documentTitle = extractTitleFromDocumentTitle();
  if (documentTitle) {
    logResolvedTitle('document.title', documentTitle);
    return documentTitle;
  }

  const structuredTitle = extractTitleFromStructuredData();
  if (structuredTitle) {
    logResolvedTitle('structured-data', structuredTitle);
    return structuredTitle;
  }

  const metaTitle = extractTitleFromMetaTags();
  if (metaTitle) {
    logResolvedTitle('meta-tag', metaTitle);
    return metaTitle;
  }

  const videoTitleBlockData = extractVideoTitleBlockData();
  if (videoTitleBlockData?.title) {
    logResolvedTitle('video-title-block', videoTitleBlockData.title, {
      selector: videoTitleBlockData.selector,
      rawText: videoTitleBlockData.rawText,
    });
    return videoTitleBlockData.title;
  }

  const firstLinkedMatch = findFirstMatchingText(TITLE_LINK_SELECTORS);
  const linkedTitle = pickSeriesTitle(getTextsFromSelectors(TITLE_LINK_SELECTORS));
  if (linkedTitle) {
    logResolvedTitle('title-link-selector', linkedTitle, {
      selector: firstLinkedMatch?.selector ?? null,
      rawText: firstLinkedMatch?.text ?? null,
    });
    return linkedTitle;
  }

  const fallbackCombinedTitle = pickSeriesTitle(collectFallbackCombinedCandidates());
  if (fallbackCombinedTitle) {
    logResolvedTitle('fallback-combined-candidate', fallbackCombinedTitle);
    return fallbackCombinedTitle;
  }

  const firstSelectorMatch = findFirstMatchingText(TITLE_SELECTORS);
  const selectorTitle = pickSeriesTitle(getTextsFromSelectors(TITLE_SELECTORS));
  if (selectorTitle) {
    logResolvedTitle('title-selector', selectorTitle, {
      selector: firstSelectorMatch?.selector ?? null,
      rawText: firstSelectorMatch?.text ?? null,
    });
    return selectorTitle;
  }

  return null;
}

function collectMetadataTexts(): string[] {
  const rawTexts = [
    ...getTextsFromSelectors(METADATA_SELECTORS),
    ...getTextsFromSelectors(TITLE_SELECTORS),
    ...collectFallbackCombinedCandidates(),
  ];
  const results = new Set<string>();
  const videoTitleBlockData = extractVideoTitleBlockData();

  if (videoTitleBlockData?.episode) {
    results.add(videoTitleBlockData.episode);
  }

  if (videoTitleBlockData?.episodeTitle) {
    results.add(videoTitleBlockData.episodeTitle);
  }

  if (videoTitleBlockData?.episode && videoTitleBlockData?.episodeTitle) {
    results.add(`${videoTitleBlockData.episode} ${videoTitleBlockData.episodeTitle}`);
  }

  for (const rawText of rawTexts) {
    if (rawText.length > 220) {
      continue;
    }

    const normalized = normalizeMetadataText(rawText);
    if (
      isEpisodeMetadataText(normalized) ||
      /\bseason\b/i.test(normalized) ||
      /\bepisode\b/i.test(normalized) ||
      /\bs\d+\s*:\s*e\d+\b/i.test(normalized) ||
      findEpisodeMarkerIndex(normalized) >= 0
    ) {
      results.add(normalized);
    }

    const { metadata } = splitCombinedTitleCandidate(normalized);
    if (metadata) {
      results.add(normalizeMetadataText(metadata));
    }
  }

  return [...results];
}

function extractSeasonAndEpisode(texts: string[]): {
  season: string | null;
  episode: string | null;
  episodeTitle: string | null;
} {
  let season: string | null = null;
  let episode: string | null = null;
  let episodeTitle: string | null = null;

  for (const rawText of texts) {
    const text = normalizeMetadataText(stripWrappingQuotes(rawText));

    const combinedMatch = text.match(
      /\bSeason\s+(\d+)\b[\s:,-]*Episode\s+(\d+)\b(?:[\s:,-]+(.+))?/i,
    );
    if (combinedMatch) {
      season = `Season ${combinedMatch[1]}`;
      episode = `Episode ${combinedMatch[2]}`;
      episodeTitle = cleanText(stripWrappingQuotes(combinedMatch[3] ?? ''));
      break;
    }

    const shorthandMatch = text.match(/\bS(\d+)\s*:\s*E(\d+)\b(?:[\s:,-]+(.+))?/i);
    if (shorthandMatch) {
      season = `Season ${shorthandMatch[1]}`;
      episode = `Episode ${shorthandMatch[2]}`;
      episodeTitle = cleanText(stripWrappingQuotes(shorthandMatch[3] ?? ''));
      break;
    }

    const shortWordsMatch = text.match(
      /\bS(?:eason)?\s+(\d+)\s*[:,-]?\s*E(?:pisode)?\s+(\d+)\b(?:[\s:,-]+(.+))?/i,
    );
    if (shortWordsMatch) {
      season = `Season ${shortWordsMatch[1]}`;
      episode = `Episode ${shortWordsMatch[2]}`;
      episodeTitle = cleanText(stripWrappingQuotes(shortWordsMatch[3] ?? ''));
      break;
    }

    if (!season) {
      const seasonMatch =
        text.match(/(?:^|[\s([{])Season\s+(\d+)\b/i) ??
        text.match(/(?:^|[\s([{])S(\d+)\b/i);
      if (seasonMatch) {
        season = `Season ${seasonMatch[1]}`;
      }
    }

    if (!episode) {
      const episodeMatch =
        text.match(/(?:^|[\s([{])Episode\s+(\d+)\b/i) ??
        text.match(/(?:^|[\s([{])E(\d+)\b/i);
      if (episodeMatch) {
        episode = `Episode ${episodeMatch[1]}`;
      }
    }

    if (!episodeTitle && isEpisodeMetadataText(text)) {
      const titlePart = text
        .replace(/^\s*S\d+\s*:\s*E\d+\b[\s:,-]*/i, '')
        .replace(/^\s*Season\s+\d+\s+Episode\s+\d+\b[\s:,-]*/i, '')
        .replace(/^\s*E(?:pisode)?\s*\d+\b[\s:,-]*/i, '');
      episodeTitle = cleanText(stripWrappingQuotes(titlePart));
    }
  }

  return { season, episode, episodeTitle };
}

export function extractNetflixWatchData(): MediaItem | null {
  if (!isNetflixWatchPage()) {
    return null;
  }

  const videoTitleBlockData = extractVideoTitleBlockData();
  const title = cleanText(extractTitle() ?? videoTitleBlockData?.title);
  if (!title) {
    console.debug(`${DEBUG_PREFIX} watch data skipped: no valid series title found`);
    logTitleExtractionFailure();
    return null;
  }

  const metadataTexts = collectMetadataTexts();
  const extractedMetadata = extractSeasonAndEpisode(metadataTexts);
  const season = extractedMetadata.season;
  const episode = extractedMetadata.episode ?? videoTitleBlockData?.episode ?? null;
  const episodeTitle =
    extractedMetadata.episodeTitle ?? videoTitleBlockData?.episodeTitle ?? null;
  const episodeState = extractNetflixEpisodeState(document, episodeTitle, episode);

  return {
    id: createNetflixItemId(title),
    platform: 'netflix',
    title,
    season,
    episode,
    episodeTitle,
    url: buildNetflixOpenUrl(title, extractNetflixTitleId()),
    watchUrl: window.location.href,
    publishedAt: episodeState.publishedAt ?? extractNetflixPublishedAt(episodeTitle, episode),
    nextEpisode: episodeState.nextEpisode,
    nextEpisodeAvailableAt: episodeState.nextEpisodeAvailableAt,
    hasNewEpisode: episodeState.hasNewEpisode,
    lastWatchedAt: new Date().toISOString(),
  };
}
