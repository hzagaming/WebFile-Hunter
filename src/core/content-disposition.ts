export function parseContentDispositionFilename(header?: string): string | undefined {
  if (!header) return undefined;
  const encodedMatches = [...header.matchAll(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/gi)];
  const encoded = encodedMatches.at(-1)?.[1]?.trim().replace(/^"|"$/g, "");
  if (encoded) {
    const value = encoded.replace(/^[^']*'[^']*'/, "");
    try {
      return decodeURIComponent(value);
    } catch {
      // 损坏的 filename* 不应覆盖仍可用的 filename。
    }
  }
  const plainMatches = [...header.matchAll(/(?:^|;)\s*filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]+)/gi)];
  const plain = plainMatches.at(-1)?.[1]?.trim();
  if (!plain) return undefined;
  if (plain.startsWith('"') && plain.endsWith('"')) {
    return plain.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return plain;
}
