import { describe, expect, it } from "vitest";
import { CrawlerQueue } from "@/background/crawler-queue";

describe("CrawlerQueue", () => {
  it("保持 BFS 顺序并去重", () => {
    const queue = new CrawlerQueue(2, 10);
    expect(
      queue.enqueue({ url: "https://e.test/", depth: 0, parentUrl: null, discoveredAt: 1 })
    ).toBe(true);
    expect(
      queue.enqueue({
        url: "https://e.test/a",
        depth: 1,
        parentUrl: "https://e.test/",
        discoveredAt: 2
      })
    ).toBe(true);
    expect(
      queue.enqueue({ url: "https://e.test/", depth: 0, parentUrl: null, discoveredAt: 3 })
    ).toBe(false);
    expect(queue.dequeue()?.url).toBe("https://e.test/");
    expect(queue.dequeue()?.url).toBe("https://e.test/a");
  });

  it("限制深度和页面总数", () => {
    const queue = new CrawlerQueue(1, 2);
    expect(
      queue.enqueue({ url: "https://e.test/", depth: 0, parentUrl: null, discoveredAt: 1 })
    ).toBe(true);
    expect(
      queue.enqueue({ url: "https://e.test/deep", depth: 2, parentUrl: null, discoveredAt: 2 })
    ).toBe(false);
    expect(
      queue.enqueue({ url: "https://e.test/a", depth: 1, parentUrl: null, discoveredAt: 3 })
    ).toBe(true);
    expect(
      queue.enqueue({ url: "https://e.test/b", depth: 1, parentUrl: null, discoveredAt: 4 })
    ).toBe(false);
  });

  it("支持序列化恢复、暂停、继续与取消", () => {
    const queue = new CrawlerQueue(2, 10);
    queue.enqueue({ url: "https://e.test/", depth: 0, parentUrl: null, discoveredAt: 1 });
    queue.pause();
    expect(queue.dequeue()).toBeUndefined();
    queue.resume();
    const snapshot = queue.snapshot();
    const restored = CrawlerQueue.restore(snapshot);
    expect(restored.dequeue()?.url).toBe("https://e.test/");
    restored.cancel();
    expect(restored.size).toBe(0);
    expect(
      restored.enqueue({ url: "https://e.test/a", depth: 1, parentUrl: null, discoveredAt: 2 })
    ).toBe(false);
  });
});
