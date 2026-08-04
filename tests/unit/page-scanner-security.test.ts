import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanSession } from "../helpers/fixtures";
import type { FileCandidate } from "@/types/models";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  enqueueCrawlerPages: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  finishSession: vi.fn(),
  listFiles: vi.fn(),
  patchSession: vi.fn(),
  hasAllSitesPermission: vi.fn(),
  putFiles:
    vi.fn<(sessionId: string, candidates: readonly FileCandidate[]) => Promise<FileCandidate[]>>(),
  putPageText: vi.fn()
}));

vi.mock("@/database/db", () => ({
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putFiles: mocks.putFiles,
  putPageText: mocks.putPageText
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/background/crawler-engine", () => ({
  enqueueCrawlerPages: mocks.enqueueCrawlerPages
}));
vi.mock("@/background/session-manager", () => ({
  finishSession: mocks.finishSession,
  patchSession: mocks.patchSession
}));
vi.mock("@/background/permission-manager", () => ({
  hasAllSitesPermission: mocks.hasAllSitesPermission
}));

import { handlePageScanResult } from "@/background/page-scanner";

beforeEach(() => {
  globalThis.chrome = {
    alarms: { clear: vi.fn().mockResolvedValue(true) }
  } as unknown as typeof chrome;
  mocks.getSession.mockResolvedValue(scanSession({ status: "running" }));
  mocks.getSettings.mockResolvedValue({ customExtensions: {}, customMimeTypes: {} });
  mocks.hasAllSitesPermission.mockResolvedValue(false);
  mocks.enqueueCrawlerPages.mockReturnValue(0);
  mocks.putFiles.mockResolvedValue([]);
  mocks.putPageText.mockResolvedValue(undefined);
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

  it("实时嗅探接受同一标签页内跨域 frame 的扫描结果", async () => {
    mocks.getSession.mockResolvedValue(scanSession({ status: "running", mode: "live_monitor" }));
    mocks.hasAllSitesPermission.mockResolvedValue(true);
    mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));

    await expect(
      handlePageScanResult(
        "session-fixture",
        {
          pageUrl: "https://frame.test/",
          title: "frame",
          resources: [
            {
              url: "https://frame.test/media/video.mp4",
              source: "DOM_ATTRIBUTE",
              tagName: "video",
              isExternal: false
            }
          ],
          pages: []
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        true
      )
    ).resolves.toBe(1);
    expect(mocks.putFiles.mock.calls[0]?.[1][0]).toEqual(
      expect.objectContaining({
        sourcePageUrl: "https://example.test/page",
        parentUrl: "https://frame.test/",
        isExternal: true
      })
    );
  });

  it("保留显式资源提示并提升无扩展名结果置信度", async () => {
    mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));

    await handlePageScanResult(
      "session-fixture",
      {
        pageUrl: "https://example.test/page",
        title: "page",
        resources: [
          {
            url: "https://example.test/api/opaque",
            source: "DOM_ATTRIBUTE",
            tagName: "a",
            resourceHint: "resource",
            isExternal: false
          }
        ],
        pages: []
      },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
      false
    );

    expect(mocks.putFiles.mock.calls[0]?.[1][0]).toMatchObject({ confidence: 70 });
  });

  it("已授予完整权限时当前页扫描也接受跨域 frame", async () => {
    mocks.hasAllSitesPermission.mockResolvedValue(true);

    await expect(
      handlePageScanResult(
        "session-fixture",
        { pageUrl: "https://frame.test/", title: "frame", resources: [], pages: [] },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).resolves.toBe(0);
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

  it("递归任务用当前渲染 DOM 的页面链接补充爬虫队列且不虚增已处理页数", async () => {
    const session = scanSession({
      status: "running",
      mode: "recursive_crawl",
      pagesProcessed: 0,
      pagesQueued: 1
    });
    mocks.getSession.mockResolvedValue(session);
    mocks.enqueueCrawlerPages.mockReturnValue(1);
    const pages = [{ url: "https://example.test/spa-route", tagName: "a", noFollow: false }];

    await handlePageScanResult(
      session.id,
      {
        pageUrl: "https://example.test/page",
        title: "SPA",
        resources: [],
        pages
      },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
      false
    );

    expect(mocks.enqueueCrawlerPages).toHaveBeenCalledWith(
      session,
      "https://example.test/page",
      pages
    );
    expect(mocks.patchSession).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ pagesProcessed: 0, pagesQueued: 2 })
    );
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

  it("只在安全校验通过的初次结果中保存正文并广播更新", async () => {
    mocks.putPageText.mockResolvedValue({
      id: "text-1",
      pageUrl: "https://example.test/page",
      title: "page",
      content: "公开正文",
      characterCount: 4,
      capturedAt: 1,
      truncated: false
    });

    await handlePageScanResult(
      "session-fixture",
      {
        pageUrl: "https://example.test/page",
        title: "page",
        resources: [],
        pages: [],
        text: { content: "公开正文", language: "zh-CN", truncated: false }
      },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
      false
    );

    expect(mocks.putPageText).toHaveBeenCalledWith(
      "session-fixture",
      expect.objectContaining({ content: "公开正文", language: "zh-CN" })
    );
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEXT_CAPTURED" })
    );

    mocks.putPageText.mockClear();
    await expect(
      handlePageScanResult(
        "session-fixture",
        {
          pageUrl: "https://other.test/",
          title: "other",
          resources: [],
          pages: [],
          text: { content: "不可信正文", truncated: false }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        false
      )
    ).rejects.toThrow("origin");
    expect(mocks.putPageText).not.toHaveBeenCalled();
  });
});
