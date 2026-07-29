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
  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "href",
      "src",
      "srcset",
      "data-src",
      "data-url",
      "data-href",
      "data-download",
      "data-file",
      "style"
    ]
  });
  const performanceObserver = new PerformanceObserver(schedule);
  performanceObserver.observe({ type: "resource", buffered: true });
  const timeout = window.setTimeout(() => stop(), durationMs);

  const stop = (): void => {
    mutationObserver.disconnect();
    performanceObserver.disconnect();
    window.clearTimeout(timeout);
    if (debounce !== undefined) window.clearTimeout(debounce);
  };
  return { stop };
}
