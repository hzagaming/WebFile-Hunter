import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, finishSession } from "@/background/session-manager";
import { clearDatabase } from "@/database/db";

let sessionStorage: Record<string, unknown>;

beforeEach(async () => {
  sessionStorage = {};
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: {
      session: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: sessionStorage[key] })),
        set: vi.fn((value: Record<string, unknown>) => {
          Object.assign(sessionStorage, value);
          return Promise.resolve();
        })
      }
    }
  } as unknown as typeof chrome;
  await clearDatabase();
});

describe("session manager", () => {
  it("拒绝同一标签页同 Origin 叠加运行任务", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    await createSession(tab, "live_monitor");

    await expect(createSession(tab, "current_page")).rejects.toThrow("已有进行中的任务");
  });

  it("旧任务结束时不会清除较新任务的活动映射", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    const old = await createSession(tab, "current_page");
    sessionStorage.activeSessionByTab = { "7": "session-newer" };

    await finishSession(old.id, "completed");

    expect(sessionStorage.activeSessionByTab).toEqual({ "7": "session-newer" });
  });
});
