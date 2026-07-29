export function extractCssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
    .map((match) => match[2]?.trim())
    .filter(
      (url): url is string => typeof url === "string" && Boolean(url) && !url.startsWith("data:")
    );
}

export function scanAccessibleStylesheets(): string[] {
  const urls = new Set<string>();
  for (const stylesheet of document.styleSheets) {
    try {
      for (const rule of stylesheet.cssRules) {
        for (const url of extractCssUrls(rule.cssText)) urls.add(url);
      }
    } catch {
      // 跨域样式表受浏览器同源策略保护，跳过即可。
    }
  }
  return [...urls];
}
