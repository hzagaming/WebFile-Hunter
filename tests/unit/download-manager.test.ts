import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadManager } from "@/background/download-manager";
import { clearDatabase, listDownloads, putFiles } from "@/database/db";
import type { FileCandidate } from "@/types/models";

let nextBrowserId = 100;
const download = vi.fn(() => Promise.resolve(nextBrowserId++));
const cancel = vi.fn(() => Promise.resolve());

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
  globalThis.chrome = {
    downloads: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn() },
      download,
      cancel,
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
});
