import { elementResourceHint, linkTargetKind, resourceMimeHint } from "./html-resource-policy";
import { normalizeUrl } from "./url-normalizer";
import type { PageCandidate, RawResource } from "@/types/scanner";

export interface ExtractedHttpLinks {
  resources: RawResource[];
  pages: PageCandidate[];
}

const MAX_HTTP_LINKS = 1_000;

function splitOutside(value: string, separator: string, trackAngles = false): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let inAngle = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (trackAngles && character === "<") inAngle = true;
    else if (trackAngles && character === ">") inAngle = false;
    else if (character === separator && !inAngle) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  }
  return trimmed;
}

export function extractHttpLinkHeader(
  value: string | undefined,
  baseUrl: string
): ExtractedHttpLinks {
  const resources = new Map<string, RawResource>();
  const pages = new Map<string, PageCandidate>();
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { resources: [], pages: [] };
  }

  for (const rawEntry of splitOutside(value ?? "", ",", true)) {
    if (resources.size + pages.size >= MAX_HTTP_LINKS) break;
    const parts = splitOutside(rawEntry, ";");
    const target = /^\s*<([^>]*)>\s*$/.exec(parts.shift() ?? "")?.[1]?.trim();
    if (!target) continue;
    const parameters = new Map<string, string>();
    for (const rawParameter of parts) {
      const separator = rawParameter.indexOf("=");
      if (separator <= 0) continue;
      parameters.set(
        rawParameter.slice(0, separator).trim().toLowerCase(),
        unquote(rawParameter.slice(separator + 1))
      );
    }
    const kind = linkTargetKind(parameters.get("rel"));
    if (kind === "ignore") continue;
    let url: string;
    try {
      url = normalizeUrl(target, baseUrl).canonicalUrl;
    } catch {
      continue;
    }
    const mimeType = parameters.get("type");
    if (kind === "resource" || (kind === "page" && resourceMimeHint(mimeType))) {
      if (!resources.has(url)) {
        resources.set(url, {
          url,
          source: "NETWORK_HEADER",
          tagName: "link",
          attribute: "link",
          ...(mimeType ? { mimeType } : {}),
          resourceHint: elementResourceHint({
            tagName: "link",
            attribute: "link",
            rel: parameters.get("rel"),
            as: parameters.get("as")
          }),
          isExternal: new URL(url).origin !== origin
        });
      }
    } else if (!pages.has(url)) {
      pages.set(url, { url, tagName: "link", noFollow: false });
    }
  }
  return { resources: [...resources.values()], pages: [...pages.values()] };
}
