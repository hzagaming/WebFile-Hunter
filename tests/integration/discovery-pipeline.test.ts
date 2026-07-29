import { describe, expect, it } from "vitest";
import { createFileCandidate } from "@/core/candidate-factory";
import { extractLinksFromHtml } from "@/core/html-link-extractor";
import { deduplicateCandidates } from "@/core/url-deduplicator";
import { exportCsv } from "@/export/export-csv";

describe("discovery pipeline", () => {
  it("从 HTML 提取、分类、去重并导出", () => {
    const extracted = extractLinksFromHtml(
      '<title>演示</title><a href="/a.txt">文本</a><audio src="/song.mp3"></audio><a href="/a.txt" download>重复</a><a href="/page-2.html">页面</a>',
      "https://example.com/index.html"
    );
    const candidates = extracted.resources.map((resource) =>
      createFileCandidate({
        url: resource.url,
        source: resource.source,
        sourcePageUrl: extracted.pageUrl,
        sourcePageTitle: extracted.title,
        ...(resource.tagName ? { tagName: resource.tagName } : {}),
        ...(resource.hasDownload ? { hasDownload: true } : {})
      })
    );
    const files = deduplicateCandidates(candidates);
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.category)).toEqual(expect.arrayContaining(["text", "audio"]));
    expect(extracted.pages.map((page) => page.url)).toEqual(["https://example.com/page-2.html"]);
    expect(exportCsv(files)).toContain("https://example.com/song.mp3");
  });
});
