import { classifyFile, type ClassificationInput } from "./file-classifier";
import { normalizeUrl } from "./url-normalizer";
import { createId } from "@/utils/id";
import type { AppSettings, DiscoverySource, FileCandidate } from "@/types/models";
import type { NormalizedUrl } from "./url-normalizer";

export interface CandidateInput extends Omit<ClassificationInput, "url"> {
  url: string;
  source: DiscoverySource;
  sourcePageUrl: string;
  sourcePageTitle?: string;
  parentUrl?: string;
  tabId?: number;
  requestId?: string;
  finalUrl?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
}

function normalizeCandidateUrl(raw: string, baseUrl?: string): NormalizedUrl {
  const originalUrl = raw.trim();
  const parsed = baseUrl === undefined ? new URL(originalUrl) : new URL(originalUrl, baseUrl);
  if (parsed.protocol !== "blob:") return normalizeUrl(originalUrl, baseUrl);
  parsed.hash = "";
  return { originalUrl, canonicalUrl: parsed.href, warnings: [] };
}

export function createFileCandidate(input: CandidateInput): FileCandidate {
  const normalized = normalizeCandidateUrl(input.url, input.sourcePageUrl);
  const classified = classifyFile(input);
  const now = Date.now();
  const sourceOrigin = new URL(input.sourcePageUrl).origin;
  const candidateOrigin = new URL(normalized.canonicalUrl).origin;
  return {
    id: createId("file"),
    originalUrl: normalized.originalUrl,
    canonicalUrl: normalized.canonicalUrl,
    ...(input.finalUrl ? { finalUrl: normalizeCandidateUrl(input.finalUrl).canonicalUrl } : {}),
    filename: classified.filename,
    ...(classified.extension ? { extension: classified.extension } : {}),
    category: classified.category,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.contentLength !== undefined ? { contentLength: input.contentLength } : {}),
    ...(input.contentDisposition ? { contentDisposition: input.contentDisposition } : {}),
    ...(input.etag ? { etag: input.etag } : {}),
    ...(input.lastModified ? { lastModified: input.lastModified } : {}),
    ...(input.acceptRanges ? { acceptRanges: input.acceptRanges } : {}),
    source: input.source,
    sources: [input.source],
    sourcePageUrl: input.sourcePageUrl,
    ...(input.sourcePageTitle ? { sourcePageTitle: input.sourcePageTitle } : {}),
    ...(input.parentUrl ? { parentUrl: input.parentUrl } : {}),
    ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    confidence: classified.confidence,
    discoveredAt: now,
    updatedAt: now,
    isExternal: candidateOrigin !== sourceOrigin,
    isDownloadable: classified.isDownloadable,
    requiresPermission: candidateOrigin !== sourceOrigin,
    metadataStatus: input.mimeType ? "complete" : "not_requested",
    warnings: [...new Set([...normalized.warnings, ...classified.warnings])]
  };
}

export function shouldIncludeCandidate(
  candidate: FileCandidate,
  settings: Pick<AppSettings, "scanImages">
): boolean {
  return settings.scanImages || candidate.category !== "image";
}
