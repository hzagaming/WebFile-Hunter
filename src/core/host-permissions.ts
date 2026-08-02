export const ALL_SITES_ORIGINS = ["http://*/*", "https://*/*"];

export function isAllSitesOrigin(pattern: string): boolean {
  return ALL_SITES_ORIGINS.includes(pattern);
}

export function siteOriginPattern(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("当前页面不是可授权的 HTTP(S) 页面。");
  }
  return `${url.protocol}//${url.hostname}/*`;
}
