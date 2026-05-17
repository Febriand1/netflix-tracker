export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function createNetflixItemId(title: string): string {
  return `netflix-${normalizeTitle(title)}`;
}

export function createYouTubeItemId(videoId: string): string {
  return `youtube-${videoId}`;
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
