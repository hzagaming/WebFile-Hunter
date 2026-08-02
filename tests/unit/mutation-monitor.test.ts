import { afterEach, describe, expect, it, vi } from "vitest";
import { startContentMonitor } from "@/content/mutation-monitor";

afterEach(() => vi.unstubAllGlobals());

describe("startContentMonitor", () => {
  it("监听全部支持的动态 data 属性", () => {
    const observe = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe = observe;
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );

    const monitor = startContentMonitor(vi.fn(), 60_000);
    const options = observe.mock.calls[0]?.[1] as MutationObserverInit;

    expect(options.attributeFilter).toEqual(
      expect.arrayContaining([
        "action",
        "content",
        "download",
        "itemprop",
        "method",
        "name",
        "poster",
        "property",
        "rel",
        "type",
        "xlink:href",
        "data-audio",
        "data-video",
        "data-poster",
        "data-original",
        "lazy-src"
      ])
    );
    monitor.stop();
  });
});
