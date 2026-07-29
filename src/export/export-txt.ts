import type { FileCandidate } from "@/types/models";

export function exportTxt(
  files: readonly FileCandidate[],
  options: { includeFilename?: boolean } = {}
): string {
  return files
    .map((file) => {
      const url = file.finalUrl ?? file.canonicalUrl;
      if (!options.includeFilename) return url;
      return `${file.filename.replace(/[\t\r\n]+/g, " ")}\t${url}`;
    })
    .join("\n");
}
