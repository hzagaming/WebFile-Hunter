const ASCII_WHITESPACE = /[\t\n\f\r ]/;

export function extractSrcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let position = 0;
  while (position < value.length) {
    while (
      position < value.length &&
      (ASCII_WHITESPACE.test(value[position]!) || value[position] === ",")
    ) {
      position += 1;
    }
    const start = position;
    while (position < value.length && !ASCII_WHITESPACE.test(value[position]!)) position += 1;
    let url = value.slice(start, position);
    const trailingCommas = /,+$/.exec(url)?.[0].length ?? 0;
    if (trailingCommas) url = url.slice(0, -trailingCommas);
    if (url) urls.push(url);
    if (trailingCommas) continue;

    let parentheses = 0;
    while (position < value.length) {
      const character = value[position++]!;
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
      else if (character === "," && parentheses === 0) break;
    }
  }
  return urls;
}
