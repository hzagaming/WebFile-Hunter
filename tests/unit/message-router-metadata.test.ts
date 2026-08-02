import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "@/background/message-router";
import type { DownloadManager } from "@/background/download-manager";
import type { MessageResponse } from "@/messaging/message-types";
import { fileCandidate, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  getSession: vi.fn(),
  hasOriginPermission: vi.fn(),
  listFiles: vi.fn(),
  probeUrlMetadata: vi.fn(),
  putFiles: vi.fn()
}));

vi.mock("@/database/db", () => ({
  getFile: mocks.getFile,
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putFiles: mocks.putFiles
}));
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
});
