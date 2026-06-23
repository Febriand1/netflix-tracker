export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

export function createNetflixItemId(title: string): string {
  return `netflix-${normalizeTitle(title)}`;
}

export function createYouTubeItemId(videoId: string): string {
  return `youtube-${videoId}`;
}

export function cleanYouTubeAnimeTitle(title: string): string {
  return title
    .replace(/\[[^\]]*indonesia[^\]]*\]/gi, '')
    .replace(/\([^)]*indonesia[^)]*\)/gi, '')
    .replace(/\s*[-:|]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractYouTubeSeriesTitle(title: string): string {
  const cleaned = title
    .replace(/\[[^\]]*indonesia[^\]]*\]/gi, '')
    .replace(/\([^)]*indonesia[^)]*\)/gi, '')
    .replace(/\s*-\s*(episode|ep)\.?\s*\d+\b.*$/i, '')
    .replace(/\s+(episode|ep)\.?\s*\d+\b.*$/i, '')
    .replace(/\s*-\s*\d+\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || title.trim();
}

export function createYouTubeSeriesKey(title: string): string {
  return `youtube-series-${normalizeTitle(extractYouTubeSeriesTitle(title))}`;
}

export function createCustomSeriesKey(hostname: string, title: string): string {
  return `anime-domain-${normalizeTitle(hostname)}-${normalizeTitle(title)}`;
}

export function parseYouTubeTitleParts(rawTitle: string): {
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
