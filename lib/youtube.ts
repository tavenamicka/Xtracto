const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|playlist\?list=)|youtu\.be\/)[\w-]+/i;

export function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url.trim());
}
