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

export function permissionPatternsForSite(input: string): string[] {
  const value = input.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const authority = value.slice(hasScheme ? value.indexOf("://") + 3 : 0).split(/[/?#]/, 1)[0];
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    throw new TypeError("请输入有效的 HTTP(S) 网站地址。");
  }
  if (
    !value ||
    !authority ||
    /[\s%*]/.test(authority) ||
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new TypeError("请输入有效的 HTTP(S) 网站地址。");
  }
  const protocols = hasScheme ? [url.protocol] : ["http:", "https:"];
  return protocols.map((protocol) => `${protocol}//${url.hostname}/*`);
}
