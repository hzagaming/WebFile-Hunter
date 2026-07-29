import { describe, expect, it } from "vitest";
import { extractLinksFromHtml } from "@/core/html-link-extractor";

describe("extractLinksFromHtml", () => {
  it("使用 parse5 从无效 HTML 提取资源、页面和元信息", () => {
    const html = `
      <html><head>
        <base href="/assets/">
        <title> 测试 页面 </title>
        <link rel="canonical" href="../canonical">
        <meta name="robots" content="noindex,nofollow">
        <meta http-equiv="refresh" content="3; url=/next">
        <style>.hero{background:url('bg.webp')}</style>
      </head><body>
        <a href="doc.txt">文本
        <a href="/page-2.html">普通页</a>
        <audio src="song.mp3"></audio>
        <source src="movie.mp4" type="video/mp4">
        <img data-src="cover.jpg" srcset="small.jpg 1x, large.jpg 2x">
        <iframe src="/frame"></iframe>
        <div style="background:url(../inline.png)"></div>
        <a href="https://outside.test/book.epub" download>外部</a>
      </body></html>`;
    const result = extractLinksFromHtml(html, "https://example.com/page-1.html");

    expect(result.title).toBe("测试 页面");
    expect(result.baseUrl).toBe("https://example.com/assets/");
    expect(result.canonicalUrl).toBe("https://example.com/canonical");
    expect(result.noFollow).toBe(true);
    expect(result.metaRefresh).toBe("https://example.com/next");
    expect(result.resources.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        "https://example.com/assets/doc.txt",
        "https://example.com/assets/song.mp3",
        "https://example.com/assets/movie.mp4",
        "https://example.com/assets/cover.jpg",
        "https://example.com/assets/small.jpg",
        "https://example.com/assets/large.jpg",
        "https://example.com/assets/bg.webp",
        "https://example.com/inline.png",
        "https://outside.test/book.epub"
      ])
    );
    expect(result.pages.map((item) => item.url)).toEqual(
      expect.arrayContaining(["https://example.com/page-2.html", "https://example.com/frame"])
    );
    expect(result.resources.find((item) => item.url.includes("outside"))?.isExternal).toBe(true);
  });

  it("去重并忽略 javascript/data 地址", () => {
    const result = extractLinksFromHtml(
      '<a href="/a.txt"></a><img src="/a.txt"><a href="javascript:alert(1)"></a><img src="data:x,y">',
      "https://example.com"
    );
    expect(result.resources).toHaveLength(1);
    expect(result.pages).toHaveLength(0);
  });
});
