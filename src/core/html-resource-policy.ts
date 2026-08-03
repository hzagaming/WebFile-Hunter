import { isHtmlMime, normalizeMimeType } from "./mime-map";

export type LinkTargetKind = "resource" | "page" | "ignore";
export type MetaResourceKind = "image" | "media";

const RESOURCE_LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "apple-touch-icon",
  "apple-touch-startup-image",
  "mask-icon",
  "preload",
  "modulepreload",
  "manifest",
  "enclosure"
]);
const PAGE_LINK_RELS = new Set(["canonical", "next", "prev"]);
const IMAGE_LINK_RELS = new Set([
  "icon",
  "apple-touch-icon",
  "apple-touch-startup-image",
  "mask-icon"
]);
const IMAGE_META_KEYS = new Set([
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
  "msapplication-tileimage",
  "image",
  "thumbnailurl"
]);
const MEDIA_META_KEYS = new Set([
  "og:video",
  "og:video:url",
  "og:video:secure_url",
  "og:audio",
  "og:audio:url",
  "og:audio:secure_url",
  "twitter:player:stream",
  "contenturl",
  "embedurl"
]);

export function linkTargetKind(rel?: string): LinkTargetKind {
  const tokens = rel?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.some((token) => RESOURCE_LINK_RELS.has(token))) return "resource";
  if (tokens.some((token) => PAGE_LINK_RELS.has(token))) return "page";
  return "ignore";
}

export function metaResourceKind(values: {
  name?: string | undefined;
  property?: string | undefined;
  itemprop?: string | undefined;
}): MetaResourceKind | undefined {
  const keys = [values.name, values.property, values.itemprop]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (keys.some((key) => IMAGE_META_KEYS.has(key))) return "image";
  if (keys.some((key) => MEDIA_META_KEYS.has(key))) return "media";
  return undefined;
}

export function resourceMimeHint(type?: string): boolean {
  const mime = normalizeMimeType(type);
  return Boolean(mime?.includes("/") && !isHtmlMime(mime));
}

export function isJsonLdType(type?: string): boolean {
  return normalizeMimeType(type) === "application/ld+json";
}

export function elementResourceHint(values: {
  tagName?: string | undefined;
  attribute?: string | undefined;
  rel?: string | undefined;
  as?: string | undefined;
  itemprop?: string | undefined;
}): "image" | "resource" {
  const tagName = values.tagName?.toLowerCase();
  const attribute = values.attribute?.toLowerCase();
  const rel = values.rel?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const itemKind = metaResourceKind({ itemprop: values.itemprop });
  return tagName === "img" ||
    tagName === "image" ||
    attribute === "poster" ||
    attribute === "data-poster" ||
    values.as?.toLowerCase() === "image" ||
    rel.some((token) => IMAGE_LINK_RELS.has(token)) ||
    itemKind === "image"
    ? "image"
    : "resource";
}

export function robotsMetaNoFollow(content: string): boolean {
  const directives = content
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean);
  return directives.includes("nofollow") || directives.includes("none");
}
