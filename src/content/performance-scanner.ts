export function scanPerformanceEntries(): string[] {
  return [...new Set(performance.getEntriesByType("resource").map((entry) => entry.name))];
}
