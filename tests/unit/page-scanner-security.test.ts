import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  finishSession: vi.fn(),
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
vi.mock("@/background/session-manager", () => ({
  finishSession: mocks.finishSession,
  patchSession: mocks.patchSession
}));

import { handlePageScanResult } from "@/background/page-scanner";

beforeEach(() => {
  globalThis.chrome = {
    alarms: { clear: vi.fn().mockResolvedValue(true) }
  } as unknown as typeof chrome;
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

  it("收到当前页结果后立即完成任务，不依赖后台定时器", async () => {
    await handlePageScanResult(
      "session-fixture",
      { pageUrl: "https://example.test/page", title: "page", resources: [], pages: [] },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
      false
    );

    expect(mocks.finishSession).toHaveBeenCalledWith("session-fixture", "completed");
    expect(chrome.alarms.clear).toHaveBeenCalledWith("scan:session-fixture");
  });

  it("当前页任务完成后仍接受其他 frame 的迟到结果", async () => {
    mocks.getSession.mockResolvedValue(
      scanSession({ status: "completed", completedAt: Date.now() - 1_000 })
    );

    await expect(
      handlePageScanResult(
        "session-fixture",
        { pageUrl: "https://example.test/frame", title: "frame", resources: [], pages: [] },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).resolves.toBe(0);
    expect(mocks.putFiles).toHaveBeenCalled();
    expect(mocks.finishSession).not.toHaveBeenCalled();
  });

  it("拒绝超过 frame 收集窗口的旧当前页结果", async () => {
    mocks.getSession.mockResolvedValue(
      scanSession({ status: "completed", completedAt: Date.now() - 60_000 })
    );

    await expect(
      handlePageScanResult(
        "session-fixture",
        { pageUrl: "https://example.test/frame", title: "frame", resources: [], pages: [] },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).rejects.toThrow("已经停止");
    expect(mocks.putFiles).not.toHaveBeenCalled();
  });

  it("系统时钟回拨时不接受未来终态的 frame 结果", async () => {
    mocks.getSession.mockResolvedValue(
      scanSession({ status: "completed", completedAt: Date.now() + 1_000 })
    );

    await expect(
      handlePageScanResult(
        "session-fixture",
        { pageUrl: "https://example.test/frame", title: "frame", resources: [], pages: [] },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).rejects.toThrow("已经停止");
  });
});
