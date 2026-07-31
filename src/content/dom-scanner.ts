import { looksLikeFileUrl } from "@/core/file-classifier";
import { normalizeUrl } from "@/core/url-normalizer";
import type { PageCandidate, PageScanResult, RawResource } from "@/types/scanner";
import { extractCssUrls, scanAccessibleStylesheets } from "./style-url-scanner";
import { scanPerformanceEntries } from "./performance-scanner";

const MAX_ITEMS = 20_000;
const MAX_TITLE_LENGTH = 2048;
const MAX_URL_LENGTH = 16_384;

const SELECTORS: ReadonlyArray<[string, readonly string[]]> = [
  ["a", ["href"]],
  ["audio", ["src"]],
  ["video", ["src"]],
  ["source", ["src", "srcset"]],
  ["track", ["src"]],
  ["iframe", ["src"]],
  ["embed", ["src"]],
  ["object", ["data"]],
  ["img", ["src", "srcset"]],
  ["link", ["href"]],
  ["script", ["src"]],
  ["input", ["src"]],
  ["form", ["action"]],
  [
    "[data-src],[data-url],[data-href],[data-download],[data-file],[data-audio],[data-video],[data-original],[lazy-src]",
    [
      "data-src",
      "data-url",
      "data-href",
      "data-download",
      "data-file",
      "data-audio",
      "data-video",
      "data-original",
      "lazy-src"
    ]
  ]
];

function splitSrcset(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/, 1)[0])
    .filter((url): url is string => Boolean(url));
}

function normalize(raw: string): string | undefined {
  try {
    const parsed = new URL(raw, document.baseURI);
    const url =
      parsed.protocol === "blob:" ? parsed.href : normalizeUrl(raw, document.baseURI).canonicalUrl;
    return url.length <= MAX_URL_LENGTH ? url : undefined;
  } catch {
    return undefined;
  }
}

export function scanDocument(
  options: {
    includePerformance?: boolean;
    includeStylesheets?: boolean;
    includeImages?: boolean;
  } = {}
): PageScanResult {
  const resources = new Map<string, RawResource>();
  const pages = new Map<string, PageCandidate>();
  const pageOrigin = location.origin;

  const addResource = (
    raw: string,
    element: Element | undefined,
    attribute: string | undefined,
    source: RawResource["source"]
  ): void => {
    if (resources.size >= MAX_ITEMS) return;
    const url = normalize(raw);
    if (!url || resources.has(url)) return;
    const mimeType = element?.getAttribute("type") ?? undefined;
    const hasDownload = element instanceof HTMLAnchorElement && element.hasAttribute("download");
    resources.set(url, {
      url,
      source: hasDownload ? "DOWNLOAD_ATTRIBUTE" : source,
      ...(element ? { tagName: element.tagName.toLowerCase() } : {}),
      ...(attribute ? { attribute } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(hasDownload ? { hasDownload: true } : {}),
      isExternal: new URL(url).origin !== pageOrigin
    });
  };

  for (const [selector, attributeNames] of SELECTORS) {
    if (selector === "img" && options.includeImages === false) continue;
    for (const element of document.querySelectorAll(selector)) {
      for (const attribute of attributeNames) {
        const raw = element.getAttribute(attribute);
        if (!raw) continue;
        const values = attribute === "srcset" ? splitSrcset(raw) : [raw];
        for (const value of values) {
          const url = normalize(value);
          if (!url) continue;
          const pageElement = element.matches("a,form,iframe");
          const downloadable =
            element instanceof HTMLAnchorElement && element.hasAttribute("download");
          if (!pageElement || looksLikeFileUrl(url) || downloadable) {
            addResource(value, element, attribute, "DOM_ATTRIBUTE");
          } else if (pages.size < MAX_ITEMS && !pages.has(url)) {
            pages.set(url, {
              url,
              tagName: element.tagName.toLowerCase(),
              noFollow:
                element.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("nofollow") ??
                false
            });
          }
        }
      }
    }
  }

  for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
    for (const raw of extractCssUrls(element.getAttribute("style") ?? "")) {
      addResource(raw, element, "style", "CSS_URL");
    }
  }
  if (options.includeStylesheets !== false) {
    for (const raw of scanAccessibleStylesheets())
      addResource(raw, undefined, undefined, "CSS_URL");
  }
  if (options.includePerformance !== false) {
    for (const raw of scanPerformanceEntries())
      addResource(raw, undefined, undefined, "PERFORMANCE_ENTRY");
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>("meta[content]")) {
    const content = meta.content.trim();
    if (/^https?:\/\//i.test(content)) addResource(content, meta, "content", "DOM_ATTRIBUTE");
  }

  return {
    pageUrl: location.href,
    title: document.title.slice(0, MAX_TITLE_LENGTH),
    resources: [...resources.values()],
    pages: [...pages.values()]
  };
}
