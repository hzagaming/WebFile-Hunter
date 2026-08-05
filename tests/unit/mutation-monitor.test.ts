import { afterEach, describe, expect, it, vi } from "vitest";
import { startContentMonitor } from "@/content/mutation-monitor";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startContentMonitor", () => {
  it("监听全部支持的动态 data 属性", () => {
    const observe = vi.fn<(target: Node, options?: MutationObserverInit) => void>();
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

  it("同时观察已有 template 与开放 Shadow DOM", () => {
    const template = document.createElement("template");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    document.body.append(template, host);
    const observe = vi.fn<(target: Node, options?: MutationObserverInit) => void>();
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

    expect(observe.mock.calls.map(([target]) => target)).toEqual(
      expect.arrayContaining([document.documentElement, template.content, shadow])
    );
    monitor.stop();
  });

  it("发现稍后附加到既有宿主的开放 Shadow Root", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const onBatch = vi.fn();
    const observe = vi.fn<(target: Node, options?: MutationObserverInit) => void>();
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
    const monitor = startContentMonitor(onBatch, 60_000);
    const shadow = host.attachShadow({ mode: "open" });

    vi.advanceTimersByTime(2_300);

    expect(observe.mock.calls.map(([target]) => target)).toContain(shadow);
    expect(onBatch).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("发现运行期间新采用的构造样式表", () => {
    vi.useFakeTimers();
    const shadow = document.createElement("div").attachShadow({ mode: "open" });
    document.body.append(shadow.host);
    Object.defineProperty(shadow, "adoptedStyleSheets", { value: [], writable: true });
    const onBatch = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe = vi.fn();
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
    const monitor = startContentMonitor(onBatch, 60_000);

    shadow.adoptedStyleSheets = [
      {
        cssRules: [{ cssText: '.new { background: url("/new.webp") }' }]
      } as unknown as CSSStyleSheet
    ];
    vi.advanceTimersByTime(2_300);

    expect(onBatch).toHaveBeenCalledTimes(1);
    monitor.stop();
  });
});
