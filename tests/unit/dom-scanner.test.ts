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
    document.body.innerHTML = '<img src="/hidden.png"><a href="/shown.txt">文本</a>';
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const result = scanDocument({ includeImages: false, includeStylesheets: false });
    expect(result.resources.some((item) => item.url.endsWith("hidden.png"))).toBe(false);
    expect(result.resources.some((item) => item.url.endsWith("shown.txt"))).toBe(true);
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
