import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractCssImports,
  extractCssUrls,
  scanAccessibleStylesheets
} from "@/content/style-url-scanner";

afterEach(() => vi.restoreAllMocks());

describe("extractCssUrls", () => {
  it("提取 url、裸 @import 与标准/前缀 image-set 资源", () => {
    const urls = extractCssUrls(`
      @import "theme/base.css" screen;
      @import url("print.css") print;
      .hero { background-image: image-set("hero.avif" 1x, url('hero@2x.webp') 2x type("image/webp")); }
      .legacy { background: -webkit-image-set('legacy.png' 1x, "legacy@2x.png" 2x); }
      .inline { mask: url(data:image/svg+xml;base64,abc); }
    `);

    expect(urls).toEqual(
      expect.arrayContaining([
        "theme/base.css",
        "print.css",
        "hero.avif",
        "hero@2x.webp",
        "legacy.png",
        "legacy@2x.png"
      ])
    );
    expect(urls).not.toContain("image/webp");
    expect(urls.some((url) => url.startsWith("data:"))).toBe(false);
  });

  it("去重并忽略空地址与 CSS 变量", () => {
    expect(extractCssUrls(`url("same.png");url(same.png);url("");url(var(--asset))`)).toEqual([
      "same.png"
    ]);
  });

  it("忽略 CSS 注释中的伪资源与 import", () => {
    const css = `
      /* @import "commented.css"; .old { background:url("old.png") } */
      .label::before { content: "/* not a comment */"; }
      .live { background:url("live.webp") }
    `;

    expect(extractCssUrls(css)).toEqual(["live.webp"]);
    expect(extractCssImports(css)).toEqual([]);
  });

  it("忽略字符串中的伪函数并解码 CSS 转义 URL", () => {
    const css = String.raw`
      .label::before { content: "url(fake.png) @import 'fake.css'"; }
      .escaped { background: url(icon\20 large.png); }
      .paren { background: url(image\)preview.png); }
      @import "theme\2d dark.css";
    `;

    expect(extractCssUrls(css)).toEqual(
      expect.arrayContaining(["icon large.png", "image)preview.png", "theme-dark.css"])
    );
    expect(extractCssUrls(css)).not.toEqual(expect.arrayContaining(["fake.png", "fake.css"]));
    expect(extractCssImports(css)).toEqual(["theme-dark.css"]);
  });

  it("只提取可递归读取的 CSS import", () => {
    expect(
      extractCssImports(`
        @import "base.css" layer(base);
        @import url('./print.css') print;
        @import url(theme.css) screen;
        .hero { background: url("hero.webp") }
      `)
    ).toEqual(["base.css", "./print.css", "theme.css"]);
  });

  it("递归扫描 @import 并按各自样式表地址解析相对资源", () => {
    const imported = {
      href: "https://example.test/css/theme/theme.css",
      cssRules: [{ cssText: '.theme { background: url("../images/theme.webp") }' }]
    } as unknown as CSSStyleSheet;
    const main = {
      href: "https://example.test/css/app.css",
      cssRules: [
        { cssText: '@import "theme/theme.css"', styleSheet: imported },
        { cssText: '.hero { background: image-set("hero.avif" 1x, "hero.webp" 2x) }' }
      ]
    } as unknown as CSSStyleSheet;
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([main] as unknown as StyleSheetList);

    expect(scanAccessibleStylesheets()).toEqual(
      expect.arrayContaining([
        "https://example.test/css/theme/theme.css",
        "https://example.test/css/images/theme.webp",
        "https://example.test/css/hero.avif",
        "https://example.test/css/hero.webp"
      ])
    );
  });

  it("扫描 Document 与 Shadow Root 采用的构造样式表", () => {
    const constructed = {
      href: null,
      cssRules: [{ cssText: '.icon { mask: url("/adopted.svg") }' }]
    } as unknown as CSSStyleSheet;
    const shadowSheet = {
      href: "https://example.test/components/card.css",
      cssRules: [{ cssText: '.cover { background: url("./card.webp") }' }]
    } as unknown as CSSStyleSheet;
    const root = document.createDocumentFragment();
    Object.defineProperty(root, "adoptedStyleSheets", { value: [constructed] });
    const style = document.createElement("style");
    Object.defineProperty(style, "sheet", { value: shadowSheet });
    root.append(style);

    expect(scanAccessibleStylesheets([root])).toEqual(
      expect.arrayContaining([
        `${location.origin}/adopted.svg`,
        "https://example.test/components/card.webp"
      ])
    );
  });
});
