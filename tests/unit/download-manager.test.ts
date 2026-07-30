import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadManager } from "@/background/download-manager";
import { clearDatabase, listDownloads, putDownload, putFiles } from "@/database/db";
import type { DownloadTask, FileCandidate } from "@/types/models";

let nextBrowserId = 100;
const download = vi.fn(() => Promise.resolve(nextBrowserId++));
const cancel = vi.fn(() => Promise.resolve());
const search = vi.fn(() => Promise.resolve([] as chrome.downloads.DownloadItem[]));

function file(id: string, overrides: Partial<FileCandidate> = {}): FileCandidate {
  return {
    id,
    originalUrl: `https://example.com/${id}.pdf`,
    canonicalUrl: `https://example.com/${id}.pdf`,
    filename: `${id}.pdf`,
    extension: "pdf",
    category: "document",
    source: "DOM_ATTRIBUTE",
    sources: ["DOM_ATTRIBUTE"],
    sourcePageUrl: "https://example.com",
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

beforeEach(async () => {
  nextBrowserId = 100;
  download.mockReset().mockImplementation(() => Promise.resolve(nextBrowserId++));
  cancel.mockClear();
  search.mockReset().mockResolvedValue([]);
  globalThis.chrome = {
    downloads: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn() },
      download,
      cancel,
      search,
      open: vi.fn(() => Promise.resolve()),
      show: vi.fn()
    },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) }
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve())
    }
  } as unknown as typeof chrome;
  await clearDatabase();
});

describe("DownloadManager", () => {
  it("用户开始队列后使用 uniquify 并安全清理文件名", async () => {
    await putFiles("session", [file("one", { filename: "../unsafe?.pdf" })]);
    const manager = new DownloadManager();
    const [task] = await manager.queue(["one"]);
    expect(task?.status).toBe("queued");
    expect(download).not.toHaveBeenCalled();

    await manager.action("start");
    expect(download).toHaveBeenCalledWith({
      url: "https://example.com/one.pdf",
      filename: "unsafe_.pdf",
      conflictAction: "uniquify",
      saveAs: false
    });
    expect((await listDownloads())[0]).toMatchObject({
      status: "in_progress",
      browserDownloadId: 100
    });
  });

  it("浏览器拒绝下载时保存明确失败状态", async () => {
    download.mockRejectedValueOnce(new Error("NETWORK_FAILED"));
    await putFiles("session", [file("failed")]);
    const manager = new DownloadManager();
    await manager.queue(["failed"]);
    await manager.action("start");
    expect((await listDownloads())[0]).toMatchObject({ status: "failed", error: "NETWORK_FAILED" });
  });

  it("执行取消并限制默认并发为 2", async () => {
    await putFiles("session", [file("one"), file("two"), file("three")]);
    const manager = new DownloadManager();
    const tasks = await manager.queue(["one", "two", "three"]);
    await manager.action("start");
    expect(download).toHaveBeenCalledTimes(2);

    const active = (await listDownloads()).find((task) => task.browserDownloadId !== undefined);
    expect(active).toBeDefined();
    await manager.action("cancel", active?.id);
    expect(cancel).toHaveBeenCalledWith(active?.browserDownloadId);
    expect((await listDownloads()).find((task) => task.id === active?.id)?.status).toBe(
      "cancelled"
    );
    expect(tasks).toHaveLength(3);
  });

  it("启动中的任务被取消后不会被异步下载结果重新激活", async () => {
    let resolveDownload: ((id: number) => void) | undefined;
    download.mockImplementationOnce(
      () => new Promise<number>((resolve) => (resolveDownload = resolve))
    );
    await putFiles("session", [file("race")]);
    const manager = new DownloadManager();
    const [task] = await manager.queue(["race"]);
    const starting = manager.action("start");
    await vi.waitFor(async () => expect((await listDownloads())[0]?.status).toBe("starting"));

    await manager.action("cancel", task?.id);
    resolveDownload?.(100);
    await starting;

    expect(cancel).toHaveBeenCalledWith(100);
    expect((await listDownloads())[0]?.status).toBe("cancelled");
  });

  it("同一文件只保留一个活动任务，终态后允许重新加入", async () => {
    await putFiles("session", [file("duplicate")]);
    const manager = new DownloadManager();

    const initial = await manager.queue(["duplicate", "duplicate"]);
    expect(initial).toHaveLength(1);
    expect(await manager.queue(["duplicate"])).toEqual([]);

    await manager.action("start");
    expect((await listDownloads())[0]?.status).toBe("in_progress");
    expect(await manager.queue(["duplicate"])).toEqual([]);

    await manager.action("cancel", initial[0]?.id);
    const requeued = await manager.queue(["duplicate"]);
    expect(requeued).toHaveLength(1);
    expect(requeued[0]?.id).not.toBe(initial[0]?.id);
  });

  it("并发加入同一文件时也只创建一个活动任务", async () => {
    await putFiles("session", [file("concurrent")]);
    const manager = new DownloadManager();

    const batches = await Promise.all([
      manager.queue(["concurrent"]),
      manager.queue(["concurrent"])
    ]);

    expect(batches.flat()).toHaveLength(1);
    expect(await listDownloads()).toHaveLength(1);
  });

  it("拒绝重试非终态任务，避免重复启动浏览器下载", async () => {
    await putFiles("session", [file("active-retry")]);
    const manager = new DownloadManager();
    const [task] = await manager.queue(["active-retry"]);
    await manager.action("start");

    await manager.action("retry", task?.id);

    expect(download).toHaveBeenCalledTimes(1);
    expect((await listDownloads())[0]?.status).toBe("in_progress");
  });

  it("同候选已有活动任务时不重新激活旧终态任务", async () => {
    download.mockRejectedValueOnce(new Error("NETWORK_FAILED"));
    await putFiles("session", [file("terminal-retry")]);
    const manager = new DownloadManager();
    const [failedTask] = await manager.queue(["terminal-retry"]);
    await manager.action("start");
    const [replacement] = await manager.queue(["terminal-retry"]);

    await manager.action("retry", failedTask?.id);

    const downloads = await listDownloads();
    expect(downloads.find((task) => task.id === failedTask?.id)?.status).toBe("failed");
    expect(downloads.find((task) => task.id === replacement?.id)?.status).toBe("in_progress");
    expect(
      downloads.filter((task) => ["queued", "starting", "in_progress"].includes(task.status))
    ).toHaveLength(1);
  });

  it("通过 downloads.search 同步真实下载进度", async () => {
    await putFiles("session", [file("progress")]);
    const manager = new DownloadManager();
    await manager.queue(["progress"]);
    await manager.action("start");
    search.mockResolvedValue([
      {
        id: 100,
        state: "in_progress",
        paused: false,
        bytesReceived: 25,
        totalBytes: 100
      } as chrome.downloads.DownloadItem
    ]);

    const [task] = await manager.getSnapshot();

    expect(task).toMatchObject({ status: "in_progress", bytesReceived: 25, totalBytes: 100 });
  });

  it("后台恢复时把失去浏览器 ID 的启动任务标记为失败", async () => {
    const stale: DownloadTask = {
      id: "download-stale",
      candidateId: "file-stale",
      url: "https://example.com/stale.pdf",
      filename: "stale.pdf",
      status: "starting",
      createdAt: 1,
      updatedAt: 1
    };
    await putDownload(stale);
    const manager = new DownloadManager();

    await manager.reconcile();

    const [reconciled] = await listDownloads();
    expect(reconciled?.status).toBe("failed");
    expect(reconciled?.error).toContain("后台");
  });

  it("清除全部数据前取消活动浏览器下载并删除任务", async () => {
    await putFiles("session", [file("clear")]);
    const manager = new DownloadManager();
    await manager.queue(["clear"]);
    await manager.action("start");

    await manager.clearAll();

    expect(cancel).toHaveBeenCalledWith(100);
    expect(await listDownloads()).toEqual([]);
  });

  it("启动中的下载尚无浏览器 ID 时拒绝清空并保留记录", async () => {
    await putDownload({
      id: "download-starting",
      candidateId: "file-starting",
      url: "https://example.com/starting.pdf",
      filename: "starting.pdf",
      status: "starting",
      createdAt: 1,
      updatedAt: 1
    });
    const manager = new DownloadManager();

    await expect(manager.clearAll()).rejects.toThrow("正在启动");
    expect(await listDownloads()).toHaveLength(1);
  });

  it("活动下载取消失败时拒绝清空并保留记录", async () => {
    await putFiles("session", [file("clear-failed")]);
    const manager = new DownloadManager();
    await manager.queue(["clear-failed"]);
    await manager.action("start");
    cancel.mockRejectedValueOnce(new Error("CANCEL_FAILED"));
    search.mockResolvedValueOnce([
      { id: 100, state: "in_progress" } as chrome.downloads.DownloadItem
    ]);

    await expect(manager.clearAll()).rejects.toThrow("CANCEL_FAILED");
    expect(await listDownloads()).toHaveLength(1);
  });

  it("取消失败但浏览器任务已结束时仍可安全清空", async () => {
    await putFiles("session", [file("clear-completed")]);
    const manager = new DownloadManager();
    await manager.queue(["clear-completed"]);
    await manager.action("start");
    cancel.mockRejectedValueOnce(new Error("ALREADY_FINISHED"));
    search.mockResolvedValueOnce([{ id: 100, state: "complete" } as chrome.downloads.DownloadItem]);

    await expect(manager.clearAll()).resolves.toBeUndefined();
    expect(await listDownloads()).toEqual([]);
  });
});
