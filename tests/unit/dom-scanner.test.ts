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
});
