import { discoverScanRoots } from "./scan-roots";

export interface ContentMonitor {
  stop(): void;
}

export function startContentMonitor(onBatch: () => void, durationMs: number): ContentMonitor {
  let debounce: number | undefined;
  const schedule = (): void => {
    if (debounce !== undefined) window.clearTimeout(debounce);
    debounce = window.setTimeout(onBatch, 300);
  };
  const mutationObserver = new MutationObserver(schedule);
  const observedRoots = new Set<Node>();
  const mutationOptions: MutationObserverInit = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "action",
      "href",
      "src",
      "srcset",
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
      "data-src",
      "data-srcset",
      "data-url",
      "data-href",
      "data-download",
      "data-file",
      "data-file-url",
      "data-audio",
      "data-video",
      "data-poster",
      "data-original",
      "data-lazy-src",
      "lazy-src",
      "data-bg",
      "data-background",
      "data-image",
      "data-thumb",
      "style"
    ]
  };
  const syncRoots = (): boolean => {
    let added = false;
    for (const root of discoverScanRoots()) {
      if (observedRoots.has(root)) continue;
      mutationObserver.observe(root, mutationOptions);
      observedRoots.add(root);
      added = true;
    }
    return added;
  };
  syncRoots();
  const rootInterval = window.setInterval(() => {
    if (syncRoots()) schedule();
  }, 2_000);
  const performanceObserver = new PerformanceObserver(schedule);
  performanceObserver.observe({ type: "resource", buffered: true });
  const timeout = window.setTimeout(() => stop(), durationMs);

  const stop = (): void => {
    mutationObserver.disconnect();
    performanceObserver.disconnect();
    window.clearInterval(rootInterval);
    window.clearTimeout(timeout);
    if (debounce !== undefined) window.clearTimeout(debounce);
  };
  return { stop };
}
