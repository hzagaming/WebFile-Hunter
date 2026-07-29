const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeFilename(input: string, maxLength = 180): string {
  const leaf = input.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  const printable = [...leaf]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
  let name = printable
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (!name) name = `download-${Date.now()}`;
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > maxLength) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 15 ? name.slice(dot) : "";
    name = `${name.slice(0, maxLength - extension.length)}${extension}`;
  }
  return name;
}
