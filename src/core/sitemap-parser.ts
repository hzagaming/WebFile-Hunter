export interface ParsedSitemap {
  urls: string[];
  sitemaps: string[];
}

function decodeXmlText(value: string): string {
  const text = value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'"
    };
    const normalized = code.toLowerCase();
    if (named[normalized]) return named[normalized];
    const point = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    } catch {
      return entity;
    }
  });
}

export function parseSitemapXml(xml: string, maxEntries = 20_000): ParsedSitemap {
  const entries = [...xml.matchAll(/<(?:[\w.-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?loc\s*>/gi)]
    .map((match) => decodeXmlText(match[1] ?? ""))
    .filter(Boolean);
  const values = [...new Set(entries)].slice(0, Math.max(0, maxEntries));
  return /<(?:[\w.-]+:)?sitemapindex\b/i.test(xml)
    ? { urls: [], sitemaps: values }
    : { urls: values, sitemaps: [] };
}
