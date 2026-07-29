import { saveCheckpoint, type StoredQueueItem } from "@/database/db";
import type { CrawlQueueItem } from "@/types/models";

export async function persistCrawlerCheckpoint(
  sessionId: string,
  queue: readonly CrawlQueueItem[],
  visitedUrls: ReadonlySet<string>
): Promise<void> {
  const savedAt = Date.now();
  const records: StoredQueueItem[] = queue.map((item, order) => ({
    ...item,
    id: `${sessionId}:queue:${order}:${item.url}`,
    sessionId,
    order
  }));
  await saveCheckpoint({ sessionId, savedAt, queue: records, visitedUrls: [...visitedUrls] });
}
