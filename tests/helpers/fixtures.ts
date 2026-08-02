import { DEFAULT_SETTINGS } from "@/utils/defaults";
import type { AppSnapshot } from "@/messaging/message-types";
import type { FileCandidate, ScanSession } from "@/types/models";

export function scanSession(overrides: Partial<ScanSession> = {}): ScanSession {
  return {
    id: "session-fixture",
    mode: "current_page",
    status: "completed",
    tabId: 1,
    startUrl: "https://example.test/page",
    origin: "https://example.test",
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
    pagesQueued: 0,
    pagesProcessed: 1,
    filesDiscovered: 0,
    errors: 0,
    config: DEFAULT_SETTINGS.scan,
    ...overrides
  };
}

export function fileCandidate(id: string, overrides: Partial<FileCandidate> = {}): FileCandidate {
  return {
    id,
    originalUrl: `https://example.test/${id}.txt`,
    canonicalUrl: `https://example.test/${id}.txt`,
    filename: `${id}.txt`,
    extension: "txt",
    category: "text",
    source: "DOM_ATTRIBUTE",
    sources: ["DOM_ATTRIBUTE"],
    sourcePageUrl: "https://example.test/page",
    confidence: 85,
    discoveredAt: 1,
    updatedAt: 1,
    isExternal: false,
    isDownloadable: true,
    requiresPermission: false,
    metadataStatus: "not_requested",
    warnings: [],
    ...overrides
  };
}

export function appSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    sessions: [],
    files: [],
    downloads: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    allSitesAccess: false,
    grantedOrigins: [],
    incompleteSessions: [],
    ...overrides
  };
}
