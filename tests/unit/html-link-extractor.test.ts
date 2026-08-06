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

  it("从静态 HTML 发现 JSON-LD、enclosure、MIME 与 itemprop 资源", () => {
    const result = extractLinksFromHtml(
      `
        <link rel="enclosure" type="audio/mpeg" href="/api/podcast">
        <script type="Application/LD+JSON; charset=utf-8">
          {
            "@context": "https://schema.org",
            "url": "/article",
            "contentUrl": "/api/structured-video",
            "image": {"url": "/files/structured-cover.webp"}
          }
        </script>
        <a type="application/pdf" href="/api/typed-document">类型文档</a>
        <link itemprop="contentUrl" href="/api/itemprop-video">
      `,
      "https://example.test/article"
    );
    const resources = result.resources.map((item) => item.url);

    expect(resources).toEqual(
      expect.arrayContaining([
        "https://example.test/api/podcast",
        "https://example.test/api/typed-document",
        "https://example.test/api/itemprop-video",
        "https://example.test/api/structured-video",
        "https://example.test/files/structured-cover.webp"
      ])
    );
    expect(resources).not.toContain("https://example.test/article");
    expect(
      result.resources.find((item) => item.url.endsWith("/api/structured-video"))
    ).toMatchObject({ resourceHint: "resource" });
    expect(
      result.resources.find((item) => item.url.endsWith("/files/structured-cover.webp"))
    ).toMatchObject({ resourceHint: "image" });
  });

  it("进入 template 内容树发现静态资源", () => {
    const result = extractLinksFromHtml(
      '<template><a type="application/pdf" href="/api/template-document">模板文档</a></template>',
      "https://example.test/article"
    );

    expect(result.resources).toContainEqual(
      expect.objectContaining({ url: "https://example.test/api/template-document" })
    );
  });

  it("从静态 HTML 发现扩展懒加载属性与 SVG 引用", () => {
    const result = extractLinksFromHtml(
      `
        <img data-srcset="/small.webp 1x, /large.webp 2x">
        <div data-lazy-src="/lazy.bin" data-bg="/bg.avif" data-file-url="/doc.pdf"></div>
        <svg><use href="/icons.svg#play"></use><feImage href="/filter.png"></feImage></svg>
      `,
      "https://example.test/article"
    );

    expect(result.resources.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        "https://example.test/small.webp",
        "https://example.test/large.webp",
        "https://example.test/lazy.bin",
        "https://example.test/bg.avif",
        "https://example.test/doc.pdf",
        "https://example.test/icons.svg",
        "https://example.test/filter.png"
      ])
    );
  });

  it("从静态 object param 发现明确资源且不扫描通用参数值", () => {
    const result = extractLinksFromHtml(
      `
        <object>
          <param name="movie" value="/api/legacy-player">
          <param name="url" value="/files/legacy-video.mp4">
          <param name="autoplay" value="true">
        </object>
        <param name="url" value="/api/stray-noise">
      `,
      "https://example.test/article"
    );

    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.test/api/legacy-player",
          resourceHint: "resource"
        }),
        expect.objectContaining({ url: "https://example.test/files/legacy-video.mp4" })
      ])
    );
    expect(result.resources.some((item) => item.url.endsWith("/true"))).toBe(false);
    expect(result.resources.some((item) => item.url.endsWith("/api/stray-noise"))).toBe(false);
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

  it("从静态 HTML 发现 area、frame、alternate 与扩展 CSS 资源", () => {
    const result = extractLinksFromHtml(
      `
        <link rel="alternate" href="/translated">
        <map><area href="/mapped-page"><area href="/files/mapped.pdf"></map>
        <style>
          @import "theme.css";
          .hero { background-image: image-set("hero.avif" 1x, url("hero.webp") 2x); }
        </style>
      `,
      "https://example.test/article"
    );
    const frameResult = extractLinksFromHtml(
      "<html><head></head><frameset><frame src='/legacy-frame'></frameset></html>",
      "https://example.test/article"
    );

    expect(result.pages.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        "https://example.test/translated",
        "https://example.test/mapped-page"
      ])
    );
    expect(frameResult.pages.map((item) => item.url)).toContain(
      "https://example.test/legacy-frame"
    );
    expect(result.resources.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        "https://example.test/files/mapped.pdf",
        "https://example.test/theme.css",
        "https://example.test/hero.avif",
        "https://example.test/hero.webp"
      ])
    );
  });

  it("将 robots none 视为 nofollow", () => {
    const result = extractLinksFromHtml(
      '<meta name="robots" content="none"><a href="/private-page">页面</a>',
      "https://example.test/article"
    );

    expect(result.noFollow).toBe(true);
  });

  it("提取递归页面正文并排除脚本、样式、模板与表单值", () => {
    const result = extractLinksFromHtml(
      `
        <html lang="zh-CN"><head><title>正文页</title></head><body>
          <main><h1>公开标题</h1><p>递归 页面 正文</p></main>
          <script>script-secret</script><style>style-secret</style>
          <template>template-secret</template>
          <input value="input-secret"><textarea>textarea-secret</textarea>
          <div contenteditable="true">draft-secret</div>
          <p hidden>hidden-secret</p>
        </body></html>
      `,
      "https://example.test/article"
    );

    expect(result.text).toMatchObject({ language: "zh-CN", truncated: false });
    expect(result.text.content).toContain("公开标题");
    expect(result.text.content).toContain("递归 页面 正文");
    for (const secret of [
      "script-secret",
      "style-secret",
      "template-secret",
      "input-secret",
      "textarea-secret",
      "draft-secret",
      "hidden-secret"
    ]) {
      expect(result.text.content).not.toContain(secret);
    }
  });

  it("递归正文保留半透明文字并排除折叠 details 内容", () => {
    const result = extractLinksFromHtml(
      `
        <p style="opacity: 0.5">半透明可见正文</p>
        <details><summary>折叠摘要</summary><p>closed-details-secret</p></details>
        <details open><summary>展开摘要</summary><p>展开公开正文</p></details>
      `,
      "https://example.test/article"
    );

    expect(result.text.content).toContain("半透明可见正文");
    expect(result.text.content).toContain("折叠摘要");
    expect(result.text.content).toContain("展开公开正文");
    expect(result.text.content).not.toContain("closed-details-secret");
  });
});
