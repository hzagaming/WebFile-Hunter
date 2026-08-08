function addUrl(urls: Set<string>, raw: string | undefined): void {
  const value = raw?.trim();
  if (!value || value.startsWith("#") || /^data:/i.test(value) || /^var\s*\(/i.test(value)) {
    return;
  }
  urls.add(value);
}

function stripComments(value: string): string {
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (quote) {
      output += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      output += character;
      quote = character;
      continue;
    }
    if (character === "/" && value[index + 1] === "*") {
      const end = value.indexOf("*/", index + 2);
      if (end < 0) break;
      index = end + 1;
      output += " ";
      continue;
    }
    output += character;
  }
  return output;
}

function functionBodies(value: string, pattern: RegExp): string[] {
  const bodies: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let quote = "";
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0) {
        bodies.push(value.slice(start, index));
        break;
      }
    }
  }
  return bodies;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function extractCssUrls(value: string): string[] {
  const css = stripComments(value);
  const urls = new Set<string>();
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    addUrl(urls, match[1] ?? match[2] ?? match[3]);
  }
  for (const match of css.matchAll(/@import\s+(?!url\s*\()(["'])(.*?)\1/gi)) {
    addUrl(urls, match[2]);
  }
  for (const body of functionBodies(css, /(?:-webkit-)?image-set\s*\(/gi)) {
    for (const candidate of splitTopLevel(body)) {
      const match = /^\s*(["'])(.*?)\1/.exec(candidate);
      if (match) addUrl(urls, match[2]);
    }
  }
  return [...urls];
}

export function extractCssImports(value: string): string[] {
  const css = stripComments(value);
  const urls = new Set<string>();
  for (const match of css.matchAll(
    /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)|"([^"]*)"|'([^']*)')/gi
  )) {
    addUrl(urls, match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
  }
  return [...urls];
}
