import { afterEach, describe, expect, it, vi } from "vitest";
import { scanDocument } from "@/content/dom-scanner";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("scanDocument", () => {
  it("扫描 DOM、data 属性、srcset、样式和 Performance 记录", () => {
    document.body.innerHTML = `
      <a href="/notes.txt" download>文本</a>
      <audio src="/song.mp3"></audio>
      <img data-src="/cover.webp" srcset="/small.jpg 1x, /large.jpg 2x">
      <div style="background:url('/inline.png')"></div>
      <a href="/page.html">页面</a>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${location.origin}/loaded.pdf` } as PerformanceEntry
    ]);
    const result = scanDocument({ includeStylesheets: false });
    expect(result.resources.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        `${location.origin}/notes.txt`,
        `${location.origin}/song.mp3`,
        `${location.origin}/cover.webp`,
        `${location.origin}/large.jpg`,
        `${location.origin}/inline.png`,
        `${location.origin}/loaded.pdf`
      ])
    );
    expect(result.pages.map((item) => item.url)).toContain(`${location.origin}/page.html`);
  });

  it("图片开关关闭时跳过 img 元素", () => {
    document.body.innerHTML = `
      <img src="/hidden.png" data-src="/api/lazy-image">
      <video src="/api/video" poster="/api/poster"></video>
      <svg><image href="/api/svg-image"></image></svg>
      <a href="/shown.txt">文本</a>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const result = scanDocument({ includeImages: false, includeStylesheets: false });
    const urls = result.resources.map((item) => item.url);
    for (const url of [
      `${location.origin}/hidden.png`,
      `${location.origin}/api/lazy-image`,
      `${location.origin}/api/poster`,
      `${location.origin}/api/svg-image`
    ]) {
      expect(urls).not.toContain(url);
    }
    expect(urls).toEqual(
      expect.arrayContaining([`${location.origin}/api/video`, `${location.origin}/shown.txt`])
    );
  });

  it("发现视频封面、SVG 图片与延迟媒体属性", () => {
    document.body.innerHTML = `
      <video poster="/poster.webp"></video>
      <svg><image href="/sprite.svg"></image></svg>
      <div data-poster="/lazy-cover.avif"></div>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const urls = scanDocument({ includeStylesheets: false }).resources.map((item) => item.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        `${location.origin}/poster.webp`,
        `${location.origin}/sprite.svg`,
        `${location.origin}/lazy-cover.avif`
      ])
    );
  });

  it("发现常见懒加载背景、data-srcset 与 SVG 引用资源", () => {
    document.body.innerHTML = `
      <img data-srcset="/lazy-small.webp 1x, /lazy-large.webp 2x">
      <div data-lazy-src="/lazy.bin" data-bg="/background.avif"></div>
      <div data-background="/wallpaper.jpg" data-image="/image.png"></div>
      <div data-thumb="/thumb.webp" data-file-url="/manual.pdf"></div>
      <svg>
        <use href="/icons.svg#play"></use>
        <filter><feImage href="/filter.png"></feImage></filter>
      </svg>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const urls = scanDocument({ includeStylesheets: false }).resources.map((item) => item.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        `${location.origin}/lazy-small.webp`,
        `${location.origin}/lazy-large.webp`,
        `${location.origin}/lazy.bin`,
        `${location.origin}/background.avif`,
        `${location.origin}/wallpaper.jpg`,
        `${location.origin}/image.png`,
        `${location.origin}/thumb.webp`,
        `${location.origin}/manual.pdf`,
        `${location.origin}/icons.svg`,
        `${location.origin}/filter.png`
      ])
    );
  });

  it("只保留资源 link 并从资源元信息提取相对 URL", () => {
    document.head.innerHTML = `
      <link rel="canonical" href="/article">
      <link rel="preconnect" href="https://cdn.test">
      <link rel="stylesheet" href="/site.css">
      <link rel="next" href="/page-2">
      <meta property="og:url" content="https://example.test/article">
      <meta property="og:image" content="">
      <meta property="og:image" content="/cover.webp">
      <meta name="twitter:player:stream" content="/video.mp4">
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const result = scanDocument({ includeStylesheets: false });
    const resources = result.resources.map((item) => item.url);

    expect(resources).toEqual(
      expect.arrayContaining([
        `${location.origin}/site.css`,
        `${location.origin}/cover.webp`,
        `${location.origin}/video.mp4`
      ])
    );
    expect(resources).not.toEqual(
      expect.arrayContaining([`${location.origin}/article`, "https://cdn.test/"])
    );
    expect(resources).not.toContain(location.href);
    expect(result.pages.map((item) => item.url)).toContain(`${location.origin}/page-2`);
  });

  it("发现 JSON-LD、enclosure、MIME 与 itemprop 显式资源", () => {
    document.head.innerHTML = `
      <link rel="enclosure" type="audio/mpeg" href="/api/podcast">
      <script type="Application/LD+JSON; charset=utf-8">
        {
          "@context": "https://schema.org",
          "url": "/article",
          "contentUrl": "/api/structured-video",
          "thumbnailUrl": "/files/structured-poster.webp"
        }
      </script>
    `;
    document.body.innerHTML = `
      <a type="application/pdf" href="/api/typed-document">类型文档</a>
      <a itemprop="contentUrl" href="/api/itemprop-video">结构化视频</a>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const result = scanDocument({ includeStylesheets: false });
    const resources = result.resources.map((item) => item.url);

    expect(resources).toEqual(
      expect.arrayContaining([
        `${location.origin}/api/podcast`,
        `${location.origin}/api/typed-document`,
        `${location.origin}/api/itemprop-video`,
        `${location.origin}/api/structured-video`,
        `${location.origin}/files/structured-poster.webp`
      ])
    );
    expect(resources).not.toContain(`${location.origin}/article`);
    expect(
      result.resources.find((item) => item.url.endsWith("/api/structured-video"))
    ).toMatchObject({ resourceHint: "resource" });
    expect(
      result.resources.find((item) => item.url.endsWith("/files/structured-poster.webp"))
    ).toMatchObject({ resourceHint: "image" });
  });

  it("关闭图片扫描时跳过 JSON-LD 图片但保留内容资源", () => {
    document.head.innerHTML = `
      <script type="Application/LD+JSON; charset=utf-8">
        {"contentUrl":"/api/video","thumbnailUrl":"/files/poster.webp"}
      </script>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const resources = scanDocument({
      includeImages: false,
      includeStylesheets: false
    }).resources.map((item) => item.url);

    expect(resources).toContain(`${location.origin}/api/video`);
    expect(resources).not.toContain(`${location.origin}/files/poster.webp`);
  });

  it("进入 template 与开放 Shadow DOM 发现资源", () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <a type="application/pdf" href="/api/template-document">模板文档</a>
      <style>.cover { background: url("/files/template-cover.webp") }</style>
    `;
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = `
      <video src="/files/shadow-video.mp4"></video>
      <style>.wave { mask: url("/files/shadow-wave.svg") }</style>
    `;
    document.body.append(template, host);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const resources = scanDocument().resources.map((item) => item.url);

    expect(resources).toEqual(
      expect.arrayContaining([
        `${location.origin}/api/template-document`,
        `${location.origin}/files/shadow-video.mp4`,
        `${location.origin}/files/template-cover.webp`,
        `${location.origin}/files/shadow-wave.svg`
      ])
    );
  });

  it("保留页面内 blob 临时媒体资源供安全标记", () => {
    document.body.innerHTML = '<audio src="blob:http://localhost/temporary-audio"></audio>';
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const result = scanDocument({ includeStylesheets: false });

    expect(result.resources).toContainEqual(
      expect.objectContaining({
        url: "blob:http://localhost/temporary-audio",
        tagName: "audio"
      })
    );
  });

  it("忽略非 GET 表单 action 但保留普通 GET 页面入口", () => {
    document.body.innerHTML = `
      <form method="post" action="/api/export.csv"></form>
      <form method="get" action="/search"></form>
    `;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const result = scanDocument({ includeStylesheets: false });

    expect(result.resources.map((item) => item.url)).not.toContain(
      `${location.origin}/api/export.csv`
    );
    expect(result.pages.map((item) => item.url)).not.toContain(`${location.origin}/api/export.csv`);
    expect(result.pages.map((item) => item.url)).toContain(`${location.origin}/search`);
  });

  it("页面 robots none 阻止 SPA DOM 链接进入递归队列", () => {
    document.head.innerHTML = '<meta name="robots" content="none">';
    document.body.innerHTML = '<a href="/private-page">页面</a>';
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const result = scanDocument({ includeStylesheets: false });

    expect(result.pages).toContainEqual(
      expect.objectContaining({ url: `${location.origin}/private-page`, noFollow: true })
    );
  });

  it("在发送前限制超长字段和超大资源批次", () => {
    document.title = "长".repeat(3000);
    document.body.innerHTML = `<a download href="https://example.test/${"x".repeat(17_000)}.txt">超长</a>`;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      Array.from(
        { length: 20_005 },
        (_, index) => ({ name: `${location.origin}/asset-${index}.txt` }) as PerformanceEntry
      )
    );

    const result = scanDocument({ includeStylesheets: false });

    expect(result.title).toHaveLength(2048);
    expect(result.resources).toHaveLength(20_000);
    expect(result.resources.some((item) => item.url.length > 16_384)).toBe(false);
  });
});
