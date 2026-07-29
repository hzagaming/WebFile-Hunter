export async function saveExport(
  content: string,
  extension: string,
  mimeType: string,
  filenameBase = "webfile-hunter"
): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const safeBase = filenameBase.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  try {
    await chrome.downloads.download({
      url,
      filename: `${safeBase || "webfile-hunter"}-${new Date().toISOString().slice(0, 10)}.${extension}`,
      saveAs: true,
      conflictAction: "uniquify"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
