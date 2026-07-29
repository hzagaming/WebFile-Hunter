import type { FileCandidate } from "@/types/models";

function richerText(
  preferred: string | undefined,
  fallback: string | undefined
): string | undefined {
  return preferred && preferred.length >= (fallback?.length ?? 0) ? preferred : fallback;
}

export function mergeCandidates(existing: FileCandidate, incoming: FileCandidate): FileCandidate {
  const high = incoming.confidence > existing.confidence ? incoming : existing;
  const low = high === incoming ? existing : incoming;
  const finalUrl = incoming.finalUrl ?? existing.finalUrl;
  const mimeType = incoming.mimeType ?? existing.mimeType;
  const contentLength = incoming.contentLength ?? existing.contentLength;
  const contentDisposition = richerText(incoming.contentDisposition, existing.contentDisposition);
  const etag = incoming.etag ?? existing.etag;
  const lastModified = incoming.lastModified ?? existing.lastModified;
  const acceptRanges = incoming.acceptRanges ?? existing.acceptRanges;
  return {
    ...low,
    ...high,
    id: existing.id,
    originalUrl: existing.originalUrl,
    canonicalUrl: existing.canonicalUrl,
    ...(finalUrl ? { finalUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(contentLength !== undefined ? { contentLength } : {}),
    ...(contentDisposition ? { contentDisposition } : {}),
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(acceptRanges ? { acceptRanges } : {}),
    sources: [...new Set([...existing.sources, ...incoming.sources])],
    discoveredAt: Math.min(existing.discoveredAt, incoming.discoveredAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    warnings: [...new Set([...existing.warnings, ...incoming.warnings])],
    metadataStatus:
      existing.metadataStatus === "complete" || incoming.metadataStatus === "complete"
        ? "complete"
        : incoming.metadataStatus
  };
}

export function deduplicateCandidates(files: readonly FileCandidate[]): FileCandidate[] {
  const byUrl = new Map<string, FileCandidate>();
  const byRequest = new Map<string, string>();
  for (const file of files) {
    const requestMatch = file.requestId ? byRequest.get(file.requestId) : undefined;
    const key = requestMatch ?? file.finalUrl ?? file.canonicalUrl;
    const existing = byUrl.get(key) ?? byUrl.get(file.canonicalUrl);
    const merged = existing ? mergeCandidates(existing, file) : file;
    byUrl.set(existing ? (existing.finalUrl ?? existing.canonicalUrl) : key, merged);
    if (file.requestId) byRequest.set(file.requestId, key);
  }
  return [...new Set(byUrl.values())];
}
