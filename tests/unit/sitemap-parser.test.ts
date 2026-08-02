import { describe, expect, it } from "vitest";
import { parseSitemapXml } from "@/core/sitemap-parser";

describe("parseSitemapXml", () => {
  it("解析 URL 集并解码 XML 实体与 CDATA", () => {
    const parsed = parseSitemapXml(`
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.test/page?a=1&amp;b=2</loc></url>
        <url><loc><![CDATA[https://example.test/中文]]></loc></url>
      </urlset>
    `);

    expect(parsed).toEqual({
      urls: ["https://example.test/page?a=1&b=2", "https://example.test/中文"],
      sitemaps: []
    });
  });

  it("解析 Sitemap 索引并限制条目数量", () => {
    const xml = `<sitemapindex>${Array.from(
      { length: 5 },
      (_, index) => `<sitemap><loc>https://example.test/map-${index}.xml</loc></sitemap>`
    ).join("")}</sitemapindex>`;

    expect(parseSitemapXml(xml, 3)).toEqual({
      urls: [],
      sitemaps: [
        "https://example.test/map-0.xml",
        "https://example.test/map-1.xml",
        "https://example.test/map-2.xml"
      ]
    });
  });
});
