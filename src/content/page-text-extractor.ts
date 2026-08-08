import {
  MAX_PAGE_TEXT_CHARACTERS,
  MAX_PAGE_TEXT_NODES,
  MAX_TEXT_LANGUAGE_LENGTH
} from "@/core/page-text-policy";
import type { ExtractedPageText } from "@/types/scanner";
import { discoverScanRoots } from "./scan-roots";

const EXCLUDED_TAGS = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "DATALIST",
  "SVG",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "EMBED"
]);
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL"
]);

function isShadowRoot(root: ParentNode): root is ShadowRoot {
  return root instanceof DocumentFragment && "host" in root;
}

function isHiddenElement(element: Element): boolean {
  const editable = element.getAttribute("contenteditable");
  if (
    EXCLUDED_TAGS.has(element.tagName) ||
    element.hasAttribute("hidden") ||
    element.hasAttribute("inert") ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
    (editable !== null && editable.toLowerCase() !== "false")
  ) {
    return true;
  }
  try {
    const style = getComputedStyle(element);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      style.getPropertyValue("content-visibility") === "hidden"
    );
  } catch {
    return false;
  }
}

function hasHiddenAncestor(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isHiddenElement(current)) return true;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

function isInsideCollapsedDetails(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  const details = element?.closest("details:not([open])");
  if (!details || node === details) return false;
  const summary = [...details.children].find((child) => child.tagName === "SUMMARY");
  return !summary?.contains(node);
}

export function extractPageText(): ExtractedPageText {
  let rawContent = "";
  let truncated = false;
  let visitedNodes = 0;
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

  for (const root of discoverScanRoots()) {
    if (root !== document.documentElement && !isShadowRoot(root)) continue;
    if (isShadowRoot(root) && hasHiddenAncestor(root.host)) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node instanceof Element) {
          return isHiddenElement(node) || isInsideCollapsedDetails(node)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
        return isInsideCollapsedDetails(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node && !truncated) {
      visitedNodes += 1;
      if (visitedNodes > MAX_PAGE_TEXT_NODES) {
        truncated = true;
        break;
      }
      if (node instanceof Text) append(node.data);
      else if (node instanceof Element && BLOCK_TAGS.has(node.tagName)) lineBreak();
      node = walker.nextNode();
    }
    if (truncated) break;
    lineBreak();
  }

  const content = rawContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_PAGE_TEXT_CHARACTERS);
  const language = document.documentElement.lang.trim().slice(0, MAX_TEXT_LANGUAGE_LENGTH);
  return {
    content,
    ...(language ? { language } : {}),
    truncated
  };
}
