import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceMetadata, SafeFetchOptions } from "@/background/metadata-probe";
import type { ExtensionEvent } from "@/messaging/message-types";
import type { FileCandidate } from "@/types/models";
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
  fetchWithRetries:
    vi.fn<(url: string, init: RequestInit, options: SafeFetchOptions) => Promise<Response>>(),
  probeUrlMetadata: vi.fn(),
  putAppError: vi.fn(),
  putFiles:
    vi.fn<(sessionId: string, candidates: readonly FileCandidate[]) => Promise<FileCandidate[]>>(),
  putPageText: vi.fn(),
  readLimitedText: vi.fn(),
  safeFetch:
    vi.fn<(url: string, init: RequestInit, options: SafeFetchOptions) => Promise<Response>>()
}));

vi.mock("@/database/db", () => ({
  deleteCheckpoint: mocks.deleteCheckpoint,
  getCheckpoint: mocks.getCheckpoint,
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putAppError: mocks.putAppError,
  putFiles: mocks.putFiles,
  putPageText: mocks.putPageText
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
  fetchWithRetries: mocks.fetchWithRetries,
  metadataFromResponse: (url: string, response: Response) => ({
    originalUrl: url,
    finalUrl: response.url || url,
    status: response.status,
    ...(response.headers.get("content-type")
      ? { mimeType: response.headers.get("content-type") ?? undefined }
      : {})
  }),
  probeUrlMetadata: mocks.probeUrlMetadata,
  readLimitedText: mocks.readLimitedText,
  safeFetch: mocks.safeFetch
}));
vi.mock("@/background/session-manager", () => ({
  finishSession: mocks.finishSession,
  patchSession: mocks.patchSession
}));

import {
  enqueueCrawlerPages,
  pauseCrawler,
  resumeCrawler,
  startCrawler
} from "@/background/crawler-engine";

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
  mocks.putFiles.mockResolvedValue([]);
  mocks.putPageText.mockResolvedValue(undefined);
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
  mocks.fetchWithRetries.mockImplementation((url, init, options) =>
    mocks.safeFetch(url, init, options)
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

  it("把当前 DOM 中的同源安全页面加入正在运行的队列", async () => {
    let releaseCheckpoint: (() => void) | undefined;
    mocks.persistCrawlerCheckpoint.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseCheckpoint = resolve))
    );
    const running = {
      ...recursive,
      status: "running" as const,
      startUrl: "https://example.test/start"
    };
    startCrawler(running);
    await vi.waitFor(() => expect(mocks.persistCrawlerCheckpoint).toHaveBeenCalledTimes(1));

    const added = enqueueCrawlerPages(running, running.startUrl, [
      { url: "https://example.test/spa-route", tagName: "a", noFollow: false },
      { url: "https://outside.test/page", tagName: "a", noFollow: false },
      { url: "https://example.test/logout", tagName: "a", noFollow: false }
    ]);

    expect(added).toBe(1);
    releaseCheckpoint?.();
    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(
      "https://example.test/spa-route"
    );
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
        requestsPerMinute: 1
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

  it("抓取 HTML 页面直接使用 GET，不依赖容易被拦截的 HEAD", async () => {
    mocks.probeUrlMetadata.mockRejectedValue(new Error("HEAD_BLOCKED"));
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(
          new Response("<title>直接抓取</title>", {
            status: 200,
            headers: { "Content-Type": "text/html" }
          })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.probeUrlMetadata).not.toHaveBeenCalled();
    expect(mocks.safeFetch).toHaveBeenCalledWith(
      "https://example.test/start",
      { method: "GET" },
      expect.any(Object)
    );
  });

  it("保存递归 HTML 页面的正文并广播文本更新", async () => {
    mocks.readLimitedText.mockResolvedValue("<title>递归页</title><main>递归公开正文</main>");
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(
          new Response("<title>递归页</title><main>递归公开正文</main>", {
            status: 200,
            headers: { "Content-Type": "text/html" }
          })
        );
      }
    );
    mocks.putPageText.mockResolvedValue({
      id: "text-recursive",
      pageUrl: "https://example.test/start",
      title: "递归页",
      content: "递归公开正文",
      characterCount: 6,
      capturedAt: 1,
      truncated: false
    });

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.putPageText).toHaveBeenCalledWith(
      recursive.id,
      expect.objectContaining({ pageUrl: "https://example.test/start", content: "递归公开正文" })
    );
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEXT_CAPTURED" })
    );
  });

  it("从 robots.txt 的 Sitemap 补充页面种子", async () => {
    const startUrl = "https://example.test/start";
    const hiddenUrl = "https://example.test/hidden";
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(
            new Response("User-agent: *\nSitemap: /sitemap.xml", { status: 200 })
          );
        }
        if (url.endsWith("/sitemap.xml")) {
          return Promise.resolve(
            new Response(`<urlset><url><loc>${hiddenUrl}</loc></url></urlset>`, { status: 200 })
          );
        }
        return Promise.resolve(
          new Response("<title>页面</title>", {
            status: 200,
            headers: { "Content-Type": "text/html" }
          })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl,
      config: { ...recursive.config, respectRobots: true, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(hiddenUrl);
    expect(mocks.fetchWithRetries).toHaveBeenCalledWith(
      "https://example.test/robots.txt",
      { method: "GET" },
      expect.any(Object)
    );
    expect(mocks.fetchWithRetries).toHaveBeenCalledWith(
      "https://example.test/sitemap.xml",
      { method: "GET" },
      expect.any(Object)
    );
    expect(mocks.patchSession).toHaveBeenCalledWith(
      recursive.id,
      expect.objectContaining({ pagesProcessed: 2 })
    );
  });

  it("robots 未声明时尝试公开根 Sitemap 并加入页面", async () => {
    const fallbackUrl = "https://example.test/fallback-page";
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("", { status: 200 }));
        if (url.endsWith("/sitemap.xml")) {
          return Promise.resolve(
            new Response(`<urlset><url><loc>${fallbackUrl}</loc></url></urlset>`, {
              status: 200,
              headers: { "Content-Type": "application/xml" }
            })
          );
        }
        if (url.endsWith("/sitemap_index.xml")) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        return Promise.resolve(
          new Response("<title>公开 Sitemap 页面</title>", {
            status: 200,
            headers: { "Content-Type": "text/html" }
          })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, respectRobots: true, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(fallbackUrl);
    expect(mocks.fetchWithRetries).toHaveBeenCalledWith(
      "https://example.test/sitemap.xml",
      { method: "GET" },
      expect.any(Object)
    );
  });

  it("根 Sitemap XML 不存在时继续尝试标准 gzip 入口", async () => {
    const compressedPage = "https://example.test/compressed-page";
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("", { status: 200 }));
        if (url.endsWith("/sitemap.xml.gz")) {
          return Promise.resolve(
            new Response(`<urlset><url><loc>${compressedPage}</loc></url></urlset>`, {
              status: 200,
              headers: { "Content-Encoding": "gzip", "Content-Type": "application/xml" }
            })
          );
        }
        if (url === compressedPage) {
          return Promise.resolve(
            new Response("<title>压缩 Sitemap 页面</title>", {
              status: 200,
              headers: { "Content-Type": "text/html" }
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, respectRobots: true, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(compressedPage);
    expect(mocks.fetchWithRetries).toHaveBeenCalledWith(
      "https://example.test/sitemap.xml.gz",
      { method: "GET" },
      expect.any(Object)
    );
  });

  it("根 Sitemap 回退仍遵守 robots 禁止规则", async () => {
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(
          url.endsWith("/robots.txt")
            ? new Response("User-agent: *\nDisallow: /sitemap.xml\nDisallow: /sitemap_index.xml", {
                status: 200
              })
            : new Response("<title>公开页面</title>", {
                status: 200,
                headers: { "Content-Type": "text/html" }
              })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, respectRobots: true, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).not.toEqual(
      expect.arrayContaining([
        "https://example.test/sitemap.xml",
        "https://example.test/sitemap_index.xml"
      ])
    );
  });

  it("从 HTML 响应 Link 头记录资源并继续 next 页面", async () => {
    const nextUrl = "https://example.test/header-next";
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(
          new Response(`<title>${url === nextUrl ? "Next" : "Start"}</title>`, {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              ...(url === nextUrl
                ? {}
                : {
                    Link: '</assets/header.pdf>; rel=preload; type="application/pdf", </header-next>; rel=next'
                  })
            }
          })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, maxDepth: 2, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(nextUrl);
    expect(mocks.putFiles.mock.calls.flatMap(([, candidates]) => candidates)).toContainEqual(
      expect.objectContaining({
        canonicalUrl: "https://example.test/assets/header.pdf",
        source: "NETWORK_HEADER"
      })
    );
  });

  it("从 HTTP Refresh 响应头继续安全的同源页面", async () => {
    const refreshedUrl = "https://example.test/refreshed";
    mocks.readLimitedText.mockImplementation((response: Response) => response.text());
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(
          new Response(`<title>${url === refreshedUrl ? "Refreshed" : "Start"}</title>`, {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              ...(url === refreshedUrl ? {} : { Refresh: "0; url=/refreshed" })
            }
          })
        );
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, maxDepth: 2, minDelayMs: 0 }
    });

    await vi.waitFor(() =>
      expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "completed")
    );
    expect(mocks.safeFetch.mock.calls.map(([url]) => url)).toContain(refreshedUrl);
  });

  it("所有页面都抓取失败时返回失败终态而非空完成", async () => {
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(new Response(null, { status: 403 }));
      }
    );

    startCrawler({
      ...recursive,
      status: "running",
      startUrl: "https://example.test/start",
      config: { ...recursive.config, minDelayMs: 0 }
    });

    await vi.waitFor(() => expect(mocks.finishSession).toHaveBeenCalled());
    expect(mocks.finishSession).toHaveBeenCalledWith(recursive.id, "failed");
    expect(mocks.finishSession).not.toHaveBeenCalledWith(recursive.id, "completed");
  });

  it("恢复任务会保留暂停前已经成功处理的页面", async () => {
    const resumed = {
      ...recursive,
      status: "paused" as const,
      pagesProcessed: 1,
      errors: 0,
      config: { ...recursive.config, minDelayMs: 0 }
    };
    mocks.getSession.mockResolvedValue(resumed);
    mocks.getCheckpoint.mockResolvedValue({
      sessionId: resumed.id,
      savedAt: 1,
      queue: [
        {
          id: "queued-page",
          sessionId: resumed.id,
          order: 0,
          url: "https://example.test/remaining",
          depth: 1,
          parentUrl: resumed.startUrl,
          discoveredAt: 1
        }
      ],
      visitedUrls: [resumed.startUrl]
    });
    mocks.patchSession.mockImplementation((_id, patch) =>
      Promise.resolve({ ...resumed, ...patch })
    );
    mocks.safeFetch.mockImplementation(
      (url: string, _init: RequestInit, options: SafeFetchOptions): Promise<Response> => {
        options.onRequestStart?.(url);
        return Promise.resolve(new Response(null, { status: 403 }));
      }
    );

    await resumeCrawler(resumed.id);

    await vi.waitFor(() => expect(mocks.finishSession).toHaveBeenCalled());
    expect(mocks.finishSession).toHaveBeenCalledWith(resumed.id, "completed");
    expect(mocks.finishSession).not.toHaveBeenCalledWith(resumed.id, "failed");
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
