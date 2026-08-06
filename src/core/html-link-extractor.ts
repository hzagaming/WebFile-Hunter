import { parse, type DefaultTreeAdapterMap } from "parse5";
import { extractCssUrls } from "./css-url-extractor";
import { looksLikeFileUrl } from "./file-classifier";
import {
  elementResourceHint,
  isJsonLdType,
  linkTargetKind,
  metaResourceKind,
  resourceMimeHint,
  robotsMetaNoFollow
} from "./html-resource-policy";
import { extractStructuredDataResources } from "./structured-data-resources";
import { normalizeUrl, sameOrigin } from "./url-normalizer";
import type { RawResource } from "@/types/scanner";
import type { ExtractedHtmlLinks, PageCandidate } from "@/types/scanner";
import { MAX_PAGE_TEXT_CHARACTERS, MAX_TEXT_LANGUAGE_LENGTH } from "./page-text-policy";
import { extractRefreshTarget } from "./refresh-target";

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
  use: ["href", "xlink:href"],
  feImage: ["href", "xlink:href"],
  script: ["src"],
  input: ["src"]
};

const DATA_ATTRIBUTES = [
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
  "data-thumb"
];
const OBJECT_PARAM_RESOURCE_NAMES = new Set(["file", "filename", "movie", "src", "url"]);

const TEXT_EXCLUDED_TAGS = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "input",
  "textarea",
  "select",
  "option",
  "datalist",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed"
]);
const TEXT_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);

function attributes(element: Element): Map<string, string> {
  return new Map(element.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

function textContent(node: Node): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join("");
}

function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/, 1)[0])
    .filter((url): url is string => Boolean(url));
}

function inlineStyleHidden(style: string): boolean {
  const declarations = new Map(
    style.split(";").flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 0) return [];
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration
        .slice(separator + 1)
        .replace(/\s*!important\s*$/i, "")
        .trim()
        .toLowerCase();
      return property ? [[property, value] as const] : [];
    })
  );
  const opacity = declarations.get("opacity");
  return (
    declarations.get("display") === "none" ||
    ["hidden", "collapse"].includes(declarations.get("visibility") ?? "") ||
    declarations.get("content-visibility") === "hidden" ||
    (opacity !== undefined && Number(opacity) === 0)
  );
}

function extractStaticText(document: Node, elements: readonly Element[]) {
  let rawContent = "";
  let truncated = false;
  const append = (value: string): void => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || truncated) return;
    const separator = rawContent && !rawContent.endsWith("\n") ? " " : "";
    const addition = `${separator}${normalized}`;
    const remaining = MAX_PAGE_TEXT_CHARACTERS - rawContent.length;
    if (addition.length > remaining) {
      rawContent += addition.slice(0, remaining);
      truncated = true;
    } else {
      rawContent += addition;
    }
  };
  const lineBreak = (): void => {
    if (rawContent && !rawContent.endsWith("\n") && rawContent.length < MAX_PAGE_TEXT_CHARACTERS) {
      rawContent += "\n";
    }
  };
  const walkText = (node: Node): void => {
    if (truncated) return;
    if ("tagName" in node) {
      const attrs = attributes(node);
      const editable = attrs.get("contenteditable");
      const style = attrs.get("style") ?? "";
      if (
        TEXT_EXCLUDED_TAGS.has(node.tagName) ||
        attrs.has("hidden") ||
        attrs.has("inert") ||
        attrs.get("aria-hidden")?.toLowerCase() === "true" ||
        (editable !== undefined && editable.toLowerCase() !== "false") ||
        inlineStyleHidden(style)
      ) {
        return;
      }
      if (TEXT_BLOCK_TAGS.has(node.tagName)) lineBreak();
      if (node.tagName === "details" && !attrs.has("open")) {
        const summary = node.childNodes.find(
          (child): child is Element => "tagName" in child && child.tagName === "summary"
        );
        if (summary) walkText(summary);
        lineBreak();
        return;
      }
    }
    if ("value" in node && typeof node.value === "string") append(node.value);
    if ("childNodes" in node) node.childNodes.forEach(walkText);
    if ("tagName" in node && TEXT_BLOCK_TAGS.has(node.tagName)) lineBreak();
  };
  walkText(document);
  const content = rawContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_PAGE_TEXT_CHARACTERS);
  const html = elements.find((element) => element.tagName === "html");
  const language = html
    ? (attributes(html).get("lang") ?? "").trim().slice(0, MAX_TEXT_LANGUAGE_LENGTH)
    : "";
  return { content, ...(language ? { language } : {}), truncated };
}

export function extractLinksFromHtml(html: string, pageUrl: string): ExtractedHtmlLinks {
  const document = parse(html);
  const elements: Element[] = [];
  const walk = (node: Node): void => {
    if ("tagName" in node) {
      elements.push(node);
      if ("content" in node) walk(node.content);
    }
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
    attribute?: string,
    resourceHint?: RawResource["resourceHint"]
  ): void => {
    const values = attribute === "srcset" ? srcsetUrls(raw) : [raw];
    for (const value of values) {
      try {
        const url = normalizeUrl(value, baseUrl).canonicalUrl;
        if (!resourceMap.has(url)) {
          const attrs = attributes(element);
          const mimeType = attribute === "structured-data" ? undefined : attrs.get("type");
          resourceMap.set(url, {
            url,
            source,
            tagName: element.tagName,
            ...(attribute ? { attribute } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(attrs.has("download") ? { hasDownload: true } : {}),
            ...(resourceHint ? { resourceHint } : {}),
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
      if (name === "robots" && robotsMetaNoFollow(content)) noFollow = true;
      if (attrs.get("http-equiv")?.toLowerCase() === "refresh") {
        metaRefresh = extractRefreshTarget(content, baseUrl);
      }
      const resourceKind = metaResourceKind({
        name: attrs.get("name"),
        property: attrs.get("property"),
        itemprop: attrs.get("itemprop")
      });
      if (content && resourceKind) {
        addResource(
          content,
          "CRAWLED_PAGE",
          element,
          "content",
          resourceKind === "image" ? "image" : "resource"
        );
      }
    }
    if (element.tagName === "script" && isJsonLdType(attrs.get("type"))) {
      for (const resource of extractStructuredDataResources(textContent(element))) {
        addResource(resource.url, "CRAWLED_PAGE", element, "structured-data", resource.kind);
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
          const explicitResource =
            resourceMimeHint(attrs.get("type")) ||
            Boolean(metaResourceKind({ itemprop: attrs.get("itemprop") }));
          if (looksLikeFileUrl(url) || kind === "resource" || explicitResource) {
            addResource(
              href,
              "CRAWLED_PAGE",
              element,
              "href",
              elementResourceHint({
                tagName: element.tagName,
                attribute: "href",
                rel: attrs.get("rel"),
                as: attrs.get("as"),
                itemprop: attrs.get("itemprop")
              })
            );
          } else if (kind === "page") {
            pageMap.set(url, { url, tagName: "link", noFollow: false });
          }
        } catch {
          // 无效 link 地址忽略。
        }
      }
    }
    if (element.tagName === "style") {
      for (const raw of extractCssUrls(textContent(element)))
        addResource(raw, "CSS_URL", element, undefined, "resource");
    }
    if (
      element.tagName === "param" &&
      element.parentNode &&
      "tagName" in element.parentNode &&
      element.parentNode.tagName === "object" &&
      OBJECT_PARAM_RESOURCE_NAMES.has((attrs.get("name") ?? "").trim().toLowerCase())
    ) {
      const value = attrs.get("value");
      if (value) addResource(value, "CRAWLED_PAGE", element, "value", "resource");
    }
    const style = attrs.get("style");
    if (style)
      for (const raw of extractCssUrls(style))
        addResource(raw, "CSS_URL", element, undefined, "resource");

    for (const attrName of new Set([
      ...(RESOURCE_ATTRIBUTES[element.tagName] ?? []),
      ...DATA_ATTRIBUTES
    ])) {
      const raw = attrs.get(attrName);
      if (!raw) continue;
      const values = ["srcset", "data-srcset"].includes(attrName) ? srcsetUrls(raw) : [raw];
      for (const value of values) {
        let normalized: string;
        try {
          normalized = normalizeUrl(value, baseUrl).canonicalUrl;
        } catch {
          continue;
        }
        const isPageContainer = element.tagName === "iframe" || element.tagName === "frame";
        const isAnchor = ["a", "area", "form"].includes(element.tagName);
        if (looksLikeFileUrl(normalized) || (!isAnchor && !isPageContainer)) {
          addResource(
            value,
            attrs.has("download") ? "DOWNLOAD_ATTRIBUTE" : "CRAWLED_PAGE",
            element,
            attrName,
            elementResourceHint({
              tagName: element.tagName,
              attribute: attrName,
              rel: attrs.get("rel"),
              as: attrs.get("as"),
              itemprop: attrs.get("itemprop")
            })
          );
        } else if (isPageContainer) {
          pageMap.set(normalized, { url: normalized, tagName: element.tagName, noFollow: false });
        }
      }
    }

    if (["a", "area", "form", "iframe", "frame"].includes(element.tagName)) {
      const formMethod = (attrs.get("method") ?? "").trim().toLowerCase();
      if (element.tagName === "form" && (formMethod === "post" || formMethod === "dialog"))
        continue;
      const attribute =
        element.tagName === "form"
          ? "action"
          : element.tagName === "iframe" || element.tagName === "frame"
            ? "src"
            : "href";
      const raw = attrs.get(attribute);
      if (!raw) continue;
      try {
        const url = normalizeUrl(raw, baseUrl).canonicalUrl;
        const explicitResource =
          resourceMimeHint(attrs.get("type")) ||
          Boolean(metaResourceKind({ itemprop: attrs.get("itemprop") }));
        if (looksLikeFileUrl(url) || attrs.has("download") || explicitResource) {
          addResource(
            raw,
            attrs.has("download") ? "DOWNLOAD_ATTRIBUTE" : "CRAWLED_PAGE",
            element,
            attribute,
            elementResourceHint({
              tagName: element.tagName,
              attribute,
              rel: attrs.get("rel"),
              as: attrs.get("as"),
              itemprop: attrs.get("itemprop")
            })
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
    text: extractStaticText(document, elements),
    noFollow,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(metaRefresh ? { metaRefresh } : {})
  };
}

export function isSameOriginPage(candidate: PageCandidate, pageUrl: string): boolean {
  return sameOrigin(candidate.url, pageUrl);
}
