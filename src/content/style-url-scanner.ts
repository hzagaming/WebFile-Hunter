import { extractCssUrls } from "@/core/css-url-extractor";

export { extractCssImports, extractCssUrls } from "@/core/css-url-extractor";

const MAX_STYLESHEETS = 1_000;
const MAX_CSS_RULES = 20_000;

export function accessibleStyleSheets(roots: readonly ParentNode[] = []): CSSStyleSheet[] {
  const stylesheets = new Set<CSSStyleSheet>();
  const add = (stylesheet: CSSStyleSheet): void => {
    if (stylesheets.size < MAX_STYLESHEETS) stylesheets.add(stylesheet);
  };
  for (const stylesheet of document.styleSheets) add(stylesheet);
  for (const root of [document, ...roots]) {
    const adopted = (root as Document | ShadowRoot).adoptedStyleSheets;
    if (adopted) adopted.forEach(add);
    for (const element of root.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style,link[rel~="stylesheet"]'
    )) {
      const stylesheet = element.sheet;
      if (stylesheet && "cssRules" in stylesheet) add(stylesheet);
    }
  }
  return [...stylesheets];
}

export function scanAccessibleStylesheets(roots: readonly ParentNode[] = []): string[] {
  const urls = new Set<string>();
  const visited = new Set<CSSStyleSheet>();
  let ruleCount = 0;
  const visit = (stylesheet: CSSStyleSheet): void => {
    if (visited.has(stylesheet) || visited.size >= MAX_STYLESHEETS) return;
    visited.add(stylesheet);
    try {
      for (const rule of stylesheet.cssRules) {
        if (ruleCount >= MAX_CSS_RULES) return;
        ruleCount += 1;
        for (const raw of extractCssUrls(rule.cssText)) {
          try {
            urls.add(new URL(raw, stylesheet.href ?? document.baseURI).href);
          } catch {
            // 无效 CSS URL 留给统一扫描校验层忽略。
          }
        }
        const imported = "styleSheet" in rule ? (rule as CSSImportRule).styleSheet : null;
        if (imported) visit(imported);
      }
    } catch {
      // 跨域样式表受浏览器同源策略保护，跳过即可。
    }
  };
  accessibleStyleSheets(roots).forEach(visit);
  return [...urls];
}
