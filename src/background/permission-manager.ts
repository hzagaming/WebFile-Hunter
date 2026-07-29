export function originPattern(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("当前页面不是可授权的 HTTP(S) 页面。");
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export async function hasOriginPermission(rawUrl: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(rawUrl)] });
}

export async function getGrantedOrigins(): Promise<string[]> {
  const permissions = await chrome.permissions.getAll();
  return (permissions.origins ?? []).filter((origin) => /^https?:\/\//.test(origin)).sort();
}

export async function revokeOrigin(pattern: string): Promise<boolean> {
  if (!/^https?:\/\/[^/]+\/\*$/.test(pattern)) throw new TypeError("授权地址格式无效。");
  return chrome.permissions.remove({ origins: [pattern] });
}
