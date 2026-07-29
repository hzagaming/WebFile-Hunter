import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  listFiles: vi.fn(),
  patchSession: vi.fn(),
  putFiles: vi.fn()
}));

vi.mock("@/database/db", () => ({
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putFiles: mocks.putFiles
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/background/session-manager", () => ({ patchSession: mocks.patchSession }));

import { handlePageScanResult } from "@/background/page-scanner";

beforeEach(() => {
  mocks.getSession.mockResolvedValue(scanSession({ status: "running" }));
  mocks.getSettings.mockResolvedValue({ customExtensions: {}, customMimeTypes: {} });
  mocks.putFiles.mockResolvedValue([]);
  mocks.listFiles.mockResolvedValue([]);
});

describe("handlePageScanResult security", () => {
  it("拒绝来自同一标签页但不同 origin 的页面扫描结果", async () => {
    await expect(
      handlePageScanResult(
        "session-fixture",
        { pageUrl: "https://other.test/", title: "other", resources: [], pages: [] },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).rejects.toThrow("origin");
    expect(mocks.putFiles).not.toHaveBeenCalled();
  });
});
