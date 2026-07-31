import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceMetadata, SafeFetchOptions } from "@/background/metadata-probe";
import type { ExtensionEvent } from "@/messaging/message-types";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn<(event: ExtensionEvent) => void>(),
  deleteCheckpoint: vi.fn(),
  finishSession: vi.fn(),
  getCheckpoint: vi.fn(),
  getSession: vi.fn(),
  hasOriginPermission: vi.fn(),
  listFiles: vi.fn(),
  patchSession: vi.fn(),
  persistCrawlerCheckpoint: vi.fn(),
  probeUrlMetadata: vi.fn(),
  putAppError: vi.fn(),
  putFiles: vi.fn(),
  readLimitedText: vi.fn(),
  safeFetch: vi.fn()
}));

vi.mock("@/database/db", () => ({
  deleteCheckpoint: mocks.deleteCheckpoint,
  getCheckpoint: mocks.getCheckpoint,
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putAppError: mocks.putAppError,
  putFiles: mocks.putFiles
}));
vi.mock("@/database/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ customExtensions: {}, customMimeTypes: {} })
}));
vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/background/checkpoint-manager", () => ({
  persistCrawlerCheckpoint: mocks.persistCrawlerCheckpoint
}));
vi.mock("@/background/permission-manager", () => ({
  hasOriginPermission: mocks.hasOriginPermission
}));
vi.mock("@/background/metadata-probe", () => ({
  probeUrlMetadata: mocks.probeUrlMetadata,
  readLimitedText: mocks.readLimitedText,
  safeFetch: mocks.safeFetch
}));
vi.mock("@/background/session-manager", () => ({
  finishSession: mocks.finishSession,
  patchSession: mocks.patchSession
}));

import { pauseCrawler, resumeCrawler, startCrawler } from "@/background/crawler-engine";

const recursive = scanSession({
  id: "session-recursive",
  mode: "recursive_crawl",
  status: "paused",
  config: { ...scanSession().config, respectRobots: false }
});
delete recursive.completedAt;
const checkpoint = {
  sessionId: recursive.id,
  savedAt: 1,
  queue: [],
  visitedUrls: []
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(recursive);
  mocks.getCheckpoint.mockResolvedValue(checkpoint);
  mocks.hasOriginPermission.mockResolvedValue(true);
  mocks.listFiles.mockResolvedValue([]);
  mocks.probeUrlMetadata.mockImplementation(
    (url: string, options: SafeFetchOptions): Promise<ResourceMetadata> => {
      options.onRequestStart?.(url);
      return Promise.resolve({
        originalUrl: url,
        finalUrl: url,
        status: 200,
        mimeType: "text/html"
      });
    }
  );
  mocks.safeFetch.mockImplementation(
    (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
      options.onRequestStart?.(url);
      return Promise.resolve(new Response("<title>完成</title>", { status: 200 }));
    }
  );
  mocks.readLimitedText.mockResolvedValue("<title>完成</title>");
  mocks.patchSession.mockImplementation((_id, patch) =>
    Promise.resolve({ ...recursive, ...patch })
  );
  mocks.persistCrawlerCheckpoint.mockResolvedValue(undefined);
});

describe("crawler engine lifecycle", () => {
  it("顶层执行失败时通过统一终态清理任务映射", async () => {
    mocks.persistCrawlerCheckpoint.mockRejectedValueOnce(new Error("CHECKPOINT_FAILED"));

    startCrawler({ ...recursive, status: "running" });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "failed")
    );
    expect(mocks.patchSession).toHaveBeenCalledWith(recursive.id, {
      errorMessage: "CHECKPOINT_FAILED"
    });
  });

  it("只允许暂停状态的递归任务恢复", async () => {
    mocks.getSession.mockResolvedValue({ ...recursive, status: "running" });

    await expect(resumeCrawler(recursive.id)).rejects.toThrow("暂停");
    expect(mocks.patchSession).not.toHaveBeenCalled();
  });

  it("暂停时检查点保存失败会结束任务并清理映射", async () => {
    let releaseRun: (() => void) | undefined;
    mocks.persistCrawlerCheckpoint
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseRun = resolve)))
      .mockRejectedValueOnce(new Error("PAUSE_CHECKPOINT_FAILED"));
    mocks.getSession.mockResolvedValue({ ...recursive, status: "running" });
    startCrawler({ ...recursive, status: "running" });
    await vi.waitFor(() => expect(mocks.persistCrawlerCheckpoint).toHaveBeenCalledTimes(1));

    await expect(pauseCrawler(recursive.id)).rejects.toThrow("PAUSE_CHECKPOINT_FAILED");
    expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "failed");
    expect(mocks.patchSession).toHaveBeenCalledWith(recursive.id, {
      errorMessage: "PAUSE_CHECKPOINT_FAILED"
    });
    releaseRun?.();
  });

  it("拒绝并发恢复同一递归任务", async () => {
    const releases: Array<() => void> = [];
    mocks.persistCrawlerCheckpoint.mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve))
    );

    const results = await Promise.allSettled([
      resumeCrawler(recursive.id),
      resumeCrawler(recursive.id)
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    releases.forEach((release) => release());
    await vi.waitFor(() => expect(mocks.finishSession).toHaveBeenCalled());
  });

  it("记录当前请求 URL 和最近一分钟真实请求数", async () => {
    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );

    expect(mocks.patchSession).toHaveBeenCalledWith(
      recursive.id,
      expect.objectContaining({
        currentUrl: "https://example.test/start",
        requestsPerMinute: 2
      })
    );
    expect(
      mocks.broadcast.mock.calls.some(
        ([event]) =>
          event.type === "SCAN_PROGRESS" &&
          event.payload.sessionId === recursive.id &&
          event.payload.currentUrl === "https://example.test/start" &&
          event.payload.requestsPerMinute === 1
      )
    ).toBe(true);
  });

  it("保存进度前淘汰一分钟外的请求记录", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        now += 60_001;
        return Promise.resolve(new Response("<title>完成</title>", { status: 200 }));
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, minDelayMs: 0 }
    });

    for (let attempt = 0; attempt < 20 && !mocks.finishSession.mock.calls.length; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }
    expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed");

    expect(mocks.patchSession).toHaveBeenCalledWith(
      recursive.id,
      expect.objectContaining({ requestsPerMinute: 0 })
    );
  });
});
