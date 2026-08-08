import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "@/background/message-router";
import type { DownloadManager } from "@/background/download-manager";
import type { MessageResponse } from "@/messaging/message-types";
import type { FileCandidate } from "@/types/models";
import { fileCandidate, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  getFile: vi.fn(),
  getSettings: vi.fn(),
  getSession: vi.fn(),
  hasOriginPermission: vi.fn(),
  listFiles: vi.fn(),
  probeUrlMetadata: vi.fn(),
  putFiles:
    vi.fn<(sessionId: string, candidates: readonly FileCandidate[]) => Promise<FileCandidate[]>>()
}));

vi.mock("@/database/db", () => ({
  getFile: mocks.getFile,
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putFiles: mocks.putFiles
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/background/metadata-probe", () => ({ probeUrlMetadata: mocks.probeUrlMetadata }));
vi.mock("@/background/permission-manager", () => ({
  hasOriginPermission: mocks.hasOriginPermission
}));

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
) => boolean;

let runtimeListener: RuntimeListener | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  runtimeListener = undefined;
  const candidate = fileCandidate("cdn", {
    canonicalUrl: "https://cdn.test/resource",
    originalUrl: "https://cdn.test/resource",
    sourcePageUrl: "https://example.test/page",
    isExternal: true,
    requiresPermission: true
  });
  mocks.getSession.mockResolvedValue(scanSession({ origin: "https://example.test" }));
  mocks.getFile.mockResolvedValue(candidate);
  mocks.listFiles.mockResolvedValue([candidate]);
  mocks.hasOriginPermission.mockResolvedValue(true);
  mocks.getSettings.mockResolvedValue({
    scan: scanSession().config,
    customExtensions: { meshx: "model" },
    customMimeTypes: {},
    scanStylesheets: true,
    scanImages: true,
    showLowConfidence: false,
    monitorDurationSeconds: 60,
    downloadConcurrency: 2,
    askWhereToSave: false,
    groupByDomain: false,
    groupByCategory: false,
    maxDownloadBytes: 1024,
    confirmBeforeDownload: true,
    skipUnknownDownloads: true,
    exportFormat: "csv",
    retentionDays: 30
  });
  mocks.probeUrlMetadata.mockResolvedValue({
    finalUrl: candidate.canonicalUrl,
    mimeType: "application/pdf"
  });
  mocks.putFiles.mockResolvedValue([candidate]);
  globalThis.chrome = {
    runtime: {
      id: "extension-id",
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        })
      },
      sendMessage: vi.fn().mockResolvedValue(undefined)
    }
  } as unknown as typeof chrome;
});

describe("MessageRouter metadata probe", () => {
  it("完整权限允许探测已发现的第三方资源且重定向仍限定在资源 origin", async () => {
    new MessageRouter({} as DownloadManager);
    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        {
          type: "PROBE_METADATA",
          payload: { sessionId: "session-fixture", candidateId: "file-cdn" }
        },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(mocks.hasOriginPermission).toHaveBeenCalledWith("https://cdn.test/resource");
    expect(mocks.probeUrlMetadata).toHaveBeenCalledWith(
      "https://cdn.test/resource",
      expect.objectContaining({ origin: "https://cdn.test" })
    );
  });

  it("探测时保留自定义分类并广播 pending 与 complete 状态", async () => {
    const candidate = fileCandidate("custom", {
      canonicalUrl: "https://cdn.test/scene.meshx",
      originalUrl: "https://cdn.test/scene.meshx",
      filename: "scene.meshx",
      extension: "meshx",
      category: "model",
      isExternal: true,
      requiresPermission: true
    });
    mocks.getFile.mockResolvedValue(candidate);
    mocks.listFiles.mockResolvedValue([candidate]);
    mocks.probeUrlMetadata.mockResolvedValue({
      originalUrl: candidate.canonicalUrl,
      finalUrl: candidate.canonicalUrl,
      status: 200,
      mimeType: "application/octet-stream"
    });
    mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));
    new MessageRouter({} as DownloadManager);

    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        {
          type: "PROBE_METADATA",
          payload: { sessionId: "session-fixture", candidateId: candidate.id }
        },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(true);
    const persisted = mocks.putFiles.mock.calls.flatMap(([, candidates]) => candidates);
    expect(persisted).toContainEqual(expect.objectContaining({ metadataStatus: "pending" }));
    expect(persisted).toContainEqual(
      expect.objectContaining({ category: "model", metadataStatus: "complete" })
    );
    expect(mocks.broadcast).toHaveBeenCalledTimes(2);
  });

  it("探测失败时持久化并广播 failed 状态", async () => {
    mocks.probeUrlMetadata.mockRejectedValue(new Error("PROBE_FAILED"));
    mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));
    new MessageRouter({} as DownloadManager);

    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        {
          type: "PROBE_METADATA",
          payload: { sessionId: "session-fixture", candidateId: "file-cdn" }
        },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(false);
    expect(mocks.putFiles.mock.calls.flatMap(([, candidates]) => candidates)).toContainEqual(
      expect.objectContaining({ metadataStatus: "failed" })
    );
    expect(mocks.broadcast).toHaveBeenCalledTimes(2);
  });
});
