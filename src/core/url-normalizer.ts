const TRACKING_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid"
]);

const TEMPORARY_PARAMETERS = new Set([
  "signature",
  "sig",
  "expires",
  "x-amz-signature",
  "x-amz-expires",
  "x-goog-signature"
]);

export interface NormalizedUrl {
  originalUrl: string;
  canonicalUrl: string;
  warnings: string[];
}

export function normalizeUrl(raw: string, baseUrl?: string): NormalizedUrl {
  const originalUrl = raw.trim();
  let parsed: URL;
  try {
    parsed = baseUrl === undefined ? new URL(originalUrl) : new URL(originalUrl, baseUrl);
  } catch {
    throw new TypeError("无法解析 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("仅支持 HTTP 或 HTTPS 地址");
  }

  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }

  const warnings = [...parsed.searchParams.keys()].some((key) =>
    TEMPORARY_PARAMETERS.has(key.toLowerCase())
  )
    ? ["temporary_url"]
    : [];

  return { originalUrl, canonicalUrl: parsed.href, warnings };
}

export function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export function redactUrlForLog(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "[无法解析的 URL]";
  }
}
