import { parse, type DefaultTreeAdapterMap } from "parse5";
import { looksLikeFileUrl } from "./file-classifier";
import { linkTargetKind, metaResourceKind } from "./html-resource-policy";
import { normalizeUrl, sameOrigin } from "./url-normalizer";
import type { RawResource } from "@/types/scanner";
import type { ExtractedHtmlLinks, PageCandidate } from "@/types/scanner";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const RESOURCE_ATTRIBUTES: Record<string, readonly string[]> = {
  audio: ["src"],
  video: ["src", "poster"],
  source: ["src", "srcset"],
  track: ["src"],
  embed: ["src"],
  object: ["data"],
  img: ["src", "srcset", "data-src", "data-original", "lazy-src"],
  image: ["href", "xlink:href"],
  script: ["src"],
  input: ["src"]
};

const DATA_ATTRIBUTES = [
  "data-src",
  "data-url",
  "data-href",
  "data-download",
  "data-file",
  "data-audio",
  "data-video",
  "data-poster",
  "data-original",
  "lazy-src"
];

function attributes(element: Element): Map<string, string> {
  return new Map(element.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

function textContent(node: Node): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join("");
}

function cssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
    .map((match) => match[2]?.trim())
    .filter((url): url is string => Boolean(url));
}

function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/, 1)[0])
    .filter((url): url is string => Boolean(url));
}

export function extractLinksFromHtml(html: string, pageUrl: string): ExtractedHtmlLinks {
  const document = parse(html);
  const elements: Element[] = [];
  const walk = (node: Node): void => {
    if ("tagName" in node) elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(document);

  const baseElement = elements.find((element) => element.tagName === "base");
  const rawBase = baseElement ? attributes(baseElement).get("href") : undefined;
  let baseUrl = pageUrl;
  if (rawBase) {
    try {
      baseUrl = normalizeUrl(rawBase, pageUrl).canonicalUrl;
    } catch {
      baseUrl = pageUrl;
    }
  }
  const origin = new URL(pageUrl).origin;
  const resourceMap = new Map<string, RawResource>();
  const pageMap = new Map<string, PageCandidate>();
  let title = "";
  let canonicalUrl: string | undefined;
  let metaRefresh: string | undefined;
  let noFollow = false;

  const addResource = (
    raw: string,
    source: RawResource["source"],
    element: Element,
    attribute?: string
  ): void => {
    const values = attribute === "srcset" ? srcsetUrls(raw) : [raw];
    for (const value of values) {
      try {
        const url = normalizeUrl(value, baseUrl).canonicalUrl;
        if (!resourceMap.has(url)) {
          const attrs = attributes(element);
          const mimeType = attrs.get("type");
          resourceMap.set(url, {
            url,
            source,
            tagName: element.tagName,
            ...(attribute ? { attribute } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(attrs.has("download") ? { hasDownload: true } : {}),
            isExternal: new URL(url).origin !== origin
          });
        }
      } catch {
        // 无效或非 HTTP(S) 资源不会进入爬虫。
      }
    }
  };

  for (const element of elements) {
    const attrs = attributes(element);
    if (element.tagName === "title") title = textContent(element).replace(/\s+/g, " ").trim();
    if (element.tagName === "meta") {
      const name = attrs.get("name")?.toLowerCase();
      const content = attrs.get("content") ?? "";
      if (
        name === "robots" &&
        content
          .toLowerCase()
          .split(/[,\s]+/)
          .includes("nofollow")
      )
        noFollow = true;
      if (attrs.get("http-equiv")?.toLowerCase() === "refresh") {
        const target = /(?:^|;)\s*url\s*=\s*['"]?([^'"]+)['"]?/i.exec(content)?.[1]?.trim();
        if (target) {
          try {
            metaRefresh = normalizeUrl(target, baseUrl).canonicalUrl;
          } catch {
            metaRefresh = undefined;
          }
        }
      }
      if (
        content &&
        metaResourceKind({
          name: attrs.get("name"),
          property: attrs.get("property"),
          itemprop: attrs.get("itemprop")
        })
      ) {
        addResource(content, "CRAWLED_PAGE", element, "content");
      }
    }
    if (
      element.tagName === "link" &&
      attrs.get("rel")?.toLowerCase().split(/\s+/).includes("canonical")
    ) {
      const href = attrs.get("href");
      if (href) {
        try {
          canonicalUrl = normalizeUrl(href, baseUrl).canonicalUrl;
        } catch {
          canonicalUrl = undefined;
        }
      }
    }
    if (element.tagName === "link") {
      const href = attrs.get("href");
      if (href) {
        try {
          const url = normalizeUrl(href, baseUrl).canonicalUrl;
          const kind = linkTargetKind(attrs.get("rel"));
          if (looksLikeFileUrl(url) || kind === "resource") {
            addResource(href, "CRAWLED_PAGE", element, "href");
          } else if (kind === "page") {
            pageMap.set(url, { url, tagName: "link", noFollow: false });
          }
        } catch {
          // 无效 link 地址忽略。
        }
      }
    }
    if (element.tagName === "style") {
      for (const raw of cssUrls(textContent(element))) addResource(raw, "CSS_URL", element);
    }
    const style = attrs.get("style");
    if (style) for (const raw of cssUrls(style)) addResource(raw, "CSS_URL", element);

    for (const attrName of new Set([
      ...(RESOURCE_ATTRIBUTES[element.tagName] ?? []),
      ...DATA_ATTRIBUTES
    ])) {
      const raw = attrs.get(attrName);
      if (!raw) continue;
      const values = attrName === "srcset" ? srcsetUrls(raw) : [raw];
      for (const value of values) {
        let normalized: string;
        try {
          normalized = normalizeUrl(value, baseUrl).canonicalUrl;
        } catch {
          continue;
        }
        const isPageContainer = element.tagName === "iframe";
        const isAnchor = element.tagName === "a" || element.tagName === "form";
        if (looksLikeFileUrl(normalized) || (!isAnchor && !isPageContainer)) {
          addResource(
            value,
            attrs.has("download") ? "DOWNLOAD_ATTRIBUTE" : "CRAWLED_PAGE",
            element,
            attrName
          );
        } else if (isPageContainer) {
          pageMap.set(normalized, { url: normalized, tagName: element.tagName, noFollow: false });
        }
      }
    }

    if (element.tagName === "a" || element.tagName === "form" || element.tagName === "iframe") {
      const attribute =
        element.tagName === "form" ? "action" : element.tagName === "iframe" ? "src" : "href";
      const raw = attrs.get(attribute);
      if (!raw) continue;
      try {
        const url = normalizeUrl(raw, baseUrl).canonicalUrl;
        if (looksLikeFileUrl(url) || attrs.has("download")) {
          addResource(
            raw,
            attrs.has("download") ? "DOWNLOAD_ATTRIBUTE" : "CRAWLED_PAGE",
            element,
            attribute
          );
        } else if (!pageMap.has(url)) {
          pageMap.set(url, {
            url,
            tagName: element.tagName,
            noFollow: attrs.get("rel")?.toLowerCase().split(/\s+/).includes("nofollow") ?? false
          });
        }
      } catch {
        // 非 HTTP(S) 地址忽略。
      }
    }
  }

  return {
    pageUrl,
    title,
    baseUrl,
    resources: [...resourceMap.values()],
    pages: [...pageMap.values()].filter((page) => page.url !== pageUrl),
    noFollow,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(metaRefresh ? { metaRefresh } : {})
  };
}

export function isSameOriginPage(candidate: PageCandidate, pageUrl: string): boolean {
  return sameOrigin(candidate.url, pageUrl);
}
