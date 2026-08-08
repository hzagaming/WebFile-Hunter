function addUrl(urls: Set<string>, raw: string | undefined): void {
  const value = raw ? decodeCssEscapes(raw).trim() : "";
  if (!value || value.startsWith("#") || /^data:/i.test(value) || /^var\s*\(/i.test(value)) {
    return;
  }
  urls.add(value);
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|((?:\r\n)|[\n\f\r])|(.))/gi,
    (_match, hexadecimal: string | undefined, lineBreak: string | undefined, escaped: string) => {
      if (lineBreak) return "";
      if (!hexadecimal) return escaped ?? "";
      const codePoint = Number.parseInt(hexadecimal, 16);
      return !codePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    }
  );
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

interface FunctionBody {
  value: string;
  index: number;
}

function functionBodies(value: string, pattern: RegExp): FunctionBody[] {
  const bodies: FunctionBody[] = [];
  for (const match of outsideMatches(value, pattern)) {
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
        bodies.push({ value: value.slice(start, index), index: match.index ?? 0 });
        break;
      }
    }
  }
  return bodies;
}

function outsideMatches(value: string, pattern: RegExp): RegExpMatchArray[] {
  const matches: RegExpMatchArray[] = [];
  let position = 0;
  let quote = "";
  let escaped = false;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    for (; position < start; position += 1) {
      const character = value[position]!;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
    }
    if (!quote) matches.push(match);
    const end = start + match[0].length;
    for (; position < end; position += 1) {
      const character = value[position]!;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
    }
  }
  return matches;
}

function urlBody(value: string): string {
  const body = value.trim();
  const quote = body[0];
  return quote && (quote === '"' || quote === "'") && body.at(-1) === quote
    ? body.slice(1, -1)
    : body;
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
  for (const body of functionBodies(css, /\burl\s*\(/gi)) {
    addUrl(urls, urlBody(body.value));
  }
  for (const match of outsideMatches(css, /@import\s+(?!url\s*\()(["'])(.*?)\1/gi)) {
    addUrl(urls, match[2]);
  }
  for (const body of functionBodies(css, /(?:-webkit-)?image-set\s*\(/gi)) {
    for (const candidate of splitTopLevel(body.value)) {
      const match = /^\s*(["'])(.*?)\1/.exec(candidate);
      if (match) addUrl(urls, match[2]);
    }
  }
  return [...urls];
}

export function extractCssImports(value: string): string[] {
  const css = stripComments(value);
  const urls = new Set<string>();
  const imports = [
    ...functionBodies(css, /@import\s+url\s*\(/gi).map((body) => ({
      index: body.index,
      value: urlBody(body.value)
    })),
    ...outsideMatches(css, /@import\s+(["'])(.*?)\1/gi).map((match) => ({
      index: match.index ?? 0,
      value: match[2]
    }))
  ].sort((left, right) => left.index - right.index);
  for (const imported of imports) {
    addUrl(urls, imported.value);
  }
  return [...urls];
}
