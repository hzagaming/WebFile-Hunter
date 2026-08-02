import { describe, expect, it } from "vitest";
import { parseRobotsTxt } from "@/background/robots-parser";

const ROBOTS = `
# 全局组
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 1.5
Sitemap: https://example.com/sitemap.xml

User-agent: OtherBot
Disallow: /
`;

describe("parseRobotsTxt", () => {
  it("解析通配组、延迟和站点地图", () => {
    const rules = parseRobotsTxt(ROBOTS);
    expect(rules.crawlDelayMs).toBe(1500);
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(rules.isAllowed("https://example.com/open")).toBe(true);
    expect(rules.isAllowed("https://example.com/private/a")).toBe(false);
  });

  it("最长匹配优先，Allow 在同长度时优先", () => {
    const rules = parseRobotsTxt(ROBOTS);
    expect(rules.isAllowed("https://example.com/private/public/report.pdf")).toBe(true);
    const tied = parseRobotsTxt("User-agent: *\nDisallow: /same\nAllow: /same");
    expect(tied.isAllowed("https://example.com/same")).toBe(true);
  });

  it("空规则允许所有 URL", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow:").isAllowed("https://e.test/a")).toBe(true);
    expect(parseRobotsTxt("").isAllowed("https://e.test/a")).toBe(true);
  });

  it("Crawl-delay 后的新 User-agent 开始独立分组", () => {
    const rules = parseRobotsTxt(`
User-agent: *
Crawl-delay: 1

User-agent: BlockedBot
Disallow: /
`);

    expect(rules.crawlDelayMs).toBe(1000);
    expect(rules.isAllowed("https://example.com/public")).toBe(true);
  });
});
