import {
  ALL_SITES_ORIGINS,
  isAllSitesOrigin,
  permissionPatternsForSite,
  siteOriginPattern
} from "@/core/host-permissions";

export { ALL_SITES_ORIGINS, isAllSitesOrigin, permissionPatternsForSite };

export const originPattern = siteOriginPattern;

export async function hasOriginPermission(rawUrl: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(rawUrl)] });
}

export async function hasAllSitesPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ALL_SITES_ORIGINS });
}

export async function getGrantedOrigins(): Promise<string[]> {
  const permissions = await chrome.permissions.getAll();
  return (permissions.origins ?? []).filter((origin) => /^https?:\/\//.test(origin)).sort();
}

export async function revokeOrigin(pattern: string): Promise<boolean> {
  if (!/^https?:\/\/[^/]+\/\*$/.test(pattern)) throw new TypeError("授权地址格式无效。");
  return chrome.permissions.remove({ origins: [pattern] });
}

export async function revokeAllSitesPermission(): Promise<boolean> {
  const granted = (await chrome.permissions.getAll()).origins ?? [];
  const origins = ALL_SITES_ORIGINS.filter((origin) => granted.includes(origin));
  return origins.length ? chrome.permissions.remove({ origins }) : false;
}
