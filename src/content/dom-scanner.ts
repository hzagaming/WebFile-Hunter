import { looksLikeFileUrl } from "@/core/file-classifier";
import {
  elementResourceHint,
  isJsonLdType,
  linkTargetKind,
  metaResourceKind,
  resourceMimeHint,
  robotsMetaNoFollow
} from "@/core/html-resource-policy";
import { extractStructuredDataResources } from "@/core/structured-data-resources";
import { normalizeUrl } from "@/core/url-normalizer";
import { extractSrcsetUrls } from "@/core/srcset-parser";
import type { PageCandidate, PageScanResult, RawResource } from "@/types/scanner";
import { extractCssUrls, scanAccessibleStylesheets } from "./style-url-scanner";
import { scanPerformanceEntries } from "./performance-scanner";
import { discoverScanRoots } from "./scan-roots";

const MAX_ITEMS = 20_000;
const MAX_TITLE_LENGTH = 2048;
const MAX_URL_LENGTH = 16_384;
const OBJECT_PARAM_RESOURCE_NAMES = new Set(["file", "filename", "movie", "src", "url"]);

const SELECTORS: ReadonlyArray<[string, readonly string[]]> = [
  ["a", ["href"]],
  ["area", ["href"]],
  ["audio", ["src"]],
  ["video", ["src", "poster"]],
  ["source", ["src", "srcset"]],
  ["track", ["src"]],
  ["iframe", ["src"]],
  ["frame", ["src"]],
  ["embed", ["src"]],
  ["object", ["data"]],
  ["img", ["src", "srcset"]],
  ["image", ["href", "xlink:href"]],
  ["use", ["href", "xlink:href"]],
  ["feImage", ["href", "xlink:href"]],
  ["link", ["href"]],
  ["script", ["src"]],
  ["input", ["src"]],
  ["form", ["action"]],
  [
    "[data-src],[data-srcset],[data-url],[data-href],[data-download],[data-file],[data-file-url],[data-audio],[data-video],[data-poster],[data-original],[data-lazy-src],[lazy-src],[data-bg],[data-background],[data-image],[data-thumb],[data-full],[data-full-src],[data-original-src],[data-src-retina],[data-fallback-src],[data-zoom-image],[data-large],[data-large-file],[data-orig-file]",
    [
      "data-src",
      "data-srcset",
      "data-url",
      "data-href",
      "data-download",
      "data-file",
      "data-file-url",
      "data-audio",
      "data-video",
      "data-poster",
      "data-original",
      "data-lazy-src",
      "lazy-src",
      "data-bg",
      "data-background",
      "data-image",
      "data-thumb",
      "data-full",
      "data-full-src",
      "data-original-src",
      "data-src-retina",
      "data-fallback-src",
      "data-zoom-image",
      "data-large",
      "data-large-file",
      "data-orig-file"
    ]
  ]
];

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
    customExtensions?: readonly string[];
  } = {}
): PageScanResult {
  const resources = new Map<string, RawResource>();
  const pages = new Map<string, PageCandidate>();
  const pageOrigin = location.origin;
  const customExtensions = new Set(options.customExtensions ?? []);
  const roots = discoverScanRoots();
  const queryAll = <T extends Element>(selector: string): T[] =>
    roots.flatMap((root) => [...root.querySelectorAll<T>(selector)]);
  const pageNoFollow = [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="robots" i]')
  ].some((meta) => robotsMetaNoFollow(meta.content));

  const addResource = (
    raw: string,
    element: Element | undefined,
    attribute: string | undefined,
    source: RawResource["source"],
    resourceHint?: RawResource["resourceHint"]
  ): void => {
    if (resources.size >= MAX_ITEMS) return;
    const url = normalize(raw);
    if (!url || resources.has(url)) return;
    const mimeType = attribute === "structured-data" ? undefined : element?.getAttribute("type");
    const hasDownload =
      (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) &&
      element.hasAttribute("download");
    resources.set(url, {
      url,
      source: hasDownload ? "DOWNLOAD_ATTRIBUTE" : source,
      ...(element ? { tagName: element.tagName.toLowerCase() } : {}),
      ...(attribute ? { attribute } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(hasDownload ? { hasDownload: true } : {}),
      ...(resourceHint ? { resourceHint } : {}),
      isExternal: new URL(url).origin !== pageOrigin
    });
  };

  for (const [selector, attributeNames] of SELECTORS) {
    for (const element of queryAll(selector)) {
      if (element instanceof HTMLFormElement && element.method.toLowerCase() !== "get") continue;
      for (const attribute of attributeNames) {
        const resourceHint = elementResourceHint({
          tagName: element.tagName,
          attribute,
          rel: element.getAttribute("rel") ?? undefined,
          as: element.getAttribute("as") ?? undefined,
          itemprop: element.getAttribute("itemprop") ?? undefined
        });
        if (resourceHint === "image" && options.includeImages === false) continue;
        const raw = element.getAttribute(attribute);
        if (!raw) continue;
        const values = ["srcset", "data-srcset"].includes(attribute)
          ? extractSrcsetUrls(raw)
          : [raw];
        for (const value of values) {
          const url = normalize(value);
          if (!url) continue;
          if (element.tagName.toLowerCase() === "link") {
            const kind = linkTargetKind(element.getAttribute("rel") ?? undefined);
            const explicitResource =
              resourceMimeHint(element.getAttribute("type") ?? undefined) ||
              Boolean(
                metaResourceKind({ itemprop: element.getAttribute("itemprop") ?? undefined })
              );
            if (
              looksLikeFileUrl(url, customExtensions) ||
              kind === "resource" ||
              explicitResource
            ) {
              addResource(value, element, attribute, "DOM_ATTRIBUTE", resourceHint);
            } else if (kind === "page" && pages.size < MAX_ITEMS && !pages.has(url)) {
              pages.set(url, { url, tagName: "link", noFollow: pageNoFollow });
            }
            continue;
          }
          const pageElement = element.matches("a,area,form,iframe,frame");
          const downloadable =
            (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) &&
            element.hasAttribute("download");
          const explicitResource =
            resourceMimeHint(element.getAttribute("type") ?? undefined) ||
            Boolean(metaResourceKind({ itemprop: element.getAttribute("itemprop") ?? undefined }));
          if (
            !pageElement ||
            looksLikeFileUrl(url, customExtensions) ||
            downloadable ||
            explicitResource
          ) {
            addResource(value, element, attribute, "DOM_ATTRIBUTE", resourceHint);
          } else if (pages.size < MAX_ITEMS && !pages.has(url)) {
            pages.set(url, {
              url,
              tagName: element.tagName.toLowerCase(),
              noFollow:
                pageNoFollow ||
                (element.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("nofollow") ??
                  false)
            });
          }
        }
      }
    }
  }

  for (const param of queryAll<HTMLParamElement>("object > param[name][value]")) {
    if (!OBJECT_PARAM_RESOURCE_NAMES.has(param.name.trim().toLowerCase())) continue;
    addResource(param.value, param, "value", "DOM_ATTRIBUTE", "resource");
  }

  for (const element of queryAll<HTMLElement>("[style]")) {
    for (const raw of extractCssUrls(element.getAttribute("style") ?? "")) {
      addResource(raw, element, "style", "CSS_URL", "resource");
    }
  }
  if (options.includeStylesheets !== false) {
    for (const element of queryAll<HTMLStyleElement>("style")) {
      for (const raw of extractCssUrls(element.textContent ?? "")) {
        addResource(raw, element, "style", "CSS_URL", "resource");
      }
    }
    for (const raw of scanAccessibleStylesheets(roots))
      addResource(raw, undefined, undefined, "CSS_URL", "resource");
  }
  if (options.includePerformance !== false) {
    for (const raw of scanPerformanceEntries())
      addResource(raw, undefined, undefined, "PERFORMANCE_ENTRY");
  }
  for (const meta of queryAll<HTMLMetaElement>("meta[content]")) {
    const content = meta.content.trim();
    const kind = metaResourceKind({
      name: meta.name || undefined,
      property: meta.getAttribute("property") ?? undefined,
      itemprop: meta.getAttribute("itemprop") ?? undefined
    });
    if (content && kind && !(kind === "image" && options.includeImages === false)) {
      addResource(
        content,
        meta,
        "content",
        "DOM_ATTRIBUTE",
        kind === "image" ? "image" : "resource"
      );
    }
  }
  for (const script of queryAll<HTMLScriptElement>("script[type]")) {
    if (!isJsonLdType(script.type)) continue;
    for (const resource of extractStructuredDataResources(script.textContent ?? "")) {
      if (resource.kind === "image" && options.includeImages === false) continue;
      addResource(resource.url, script, "structured-data", "DOM_ATTRIBUTE", resource.kind);
    }
  }

  return {
    pageUrl: location.href,
    baseUrl: document.baseURI,
    title: document.title.slice(0, MAX_TITLE_LENGTH),
    resources: [...resources.values()],
    pages: [...pages.values()]
  };
}
