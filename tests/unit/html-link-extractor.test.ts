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
        <video poster="poster.webp"><source src="movie.mp4" type="video/mp4"></video>
        <img data-src="cover.jpg" srcset="small.jpg 1x, large.jpg 2x">
        <svg><image href="sprite.svg"></image></svg>
        <div data-poster="lazy-poster.avif"></div>
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
        "https://example.com/assets/poster.webp",
        "https://example.com/assets/cover.jpg",
        "https://example.com/assets/small.jpg",
        "https://example.com/assets/large.jpg",
        "https://example.com/assets/sprite.svg",
        "https://example.com/assets/lazy-poster.avif",
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

  it("过滤非资源 link 并提取 Open Graph 与分页链接", () => {
    const result = extractLinksFromHtml(
      `
        <link rel="canonical" href="/article">
        <link rel="preconnect" href="https://cdn.test">
        <link rel="stylesheet" href="/site.css">
        <link rel="next" href="/page-2">
        <meta property="og:url" content="https://example.test/article">
        <meta property="og:image" content="">
        <meta property="og:image" content="/cover.webp">
        <meta name="twitter:player:stream" content="/video.mp4">
      `,
      "https://example.test/article"
    );

    expect(result.resources.map((item) => item.url)).toEqual([
      "https://example.test/site.css",
      "https://example.test/cover.webp",
      "https://example.test/video.mp4"
    ]);
    expect(result.pages.map((item) => item.url)).toContain("https://example.test/page-2");
  });

  it("忽略非 GET 表单 action 但保留普通 GET 页面入口", () => {
    const result = extractLinksFromHtml(
      [
        '<form method="post" action="/api/export.csv"></form>',
        '<form action="/search"></form>',
        '<form method="" action="/empty-method"></form>',
        '<form method="invalid" action="/invalid-method"></form>'
      ].join(""),
      "https://example.test/article"
    );

    expect(result.resources.map((item) => item.url)).not.toContain(
      "https://example.test/api/export.csv"
    );
    expect(result.pages.map((item) => item.url)).not.toContain(
      "https://example.test/api/export.csv"
    );
    expect(result.pages.map((item) => item.url)).toContain("https://example.test/search");
    expect(result.pages.map((item) => item.url)).toContain("https://example.test/empty-method");
    expect(result.pages.map((item) => item.url)).toContain("https://example.test/invalid-method");
  });

  it("将 robots none 视为 nofollow", () => {
    const result = extractLinksFromHtml(
      '<meta name="robots" content="none"><a href="/private-page">页面</a>',
      "https://example.test/article"
    );

    expect(result.noFollow).toBe(true);
  });
});
