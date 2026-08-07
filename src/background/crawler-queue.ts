import type { CrawlQueueItem } from "@/types/models";

export interface CrawlerQueueSnapshot {
  maxDepth: number;
  maxPages: number;
  maxQueryVariantsPerPath: number;
  items: CrawlQueueItem[];
  knownUrls: string[];
  paused: boolean;
  cancelled: boolean;
}

export class CrawlerQueue {
  readonly #items: CrawlQueueItem[];
  readonly #knownUrls: Set<string>;
  readonly #maxDepth: number;
  readonly #maxPages: number;
  readonly #maxQueryVariantsPerPath: number;
  readonly #queryVariantsByPath = new Map<string, number>();
  #paused = false;
  #cancelled = false;

  constructor(
    maxDepth: number,
    maxPages: number,
    items: CrawlQueueItem[] = [],
    knownUrls?: string[],
    maxQueryVariantsPerPath = 5
  ) {
    this.#maxDepth = maxDepth;
    this.#maxPages = maxPages;
    this.#maxQueryVariantsPerPath = maxQueryVariantsPerPath;
    this.#items = [...items];
    this.#knownUrls = new Set(knownUrls ?? items.map((item) => item.url));
    for (const url of this.#knownUrls) this.#countQueryVariant(url);
  }

  get size(): number {
    return this.#items.length;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  enqueue(item: CrawlQueueItem): boolean {
    const queryPath = this.#queryPath(item.url);
    if (
      this.#cancelled ||
      item.depth > this.#maxDepth ||
      this.#knownUrls.size >= this.#maxPages ||
      this.#knownUrls.has(item.url) ||
      (queryPath !== undefined &&
        (this.#queryVariantsByPath.get(queryPath) ?? 0) >= this.#maxQueryVariantsPerPath)
    ) {
      return false;
    }
    this.#knownUrls.add(item.url);
    this.#countQueryVariant(item.url);
    this.#items.push(item);
    return true;
  }

  #queryPath(raw: string): string | undefined {
    try {
      const url = new URL(raw);
      return url.search ? `${url.origin}${url.pathname}` : undefined;
    } catch {
      return undefined;
    }
  }

  #countQueryVariant(raw: string): void {
    const key = this.#queryPath(raw);
    if (key) this.#queryVariantsByPath.set(key, (this.#queryVariantsByPath.get(key) ?? 0) + 1);
  }

  dequeue(): CrawlQueueItem | undefined {
    if (this.#paused || this.#cancelled) return undefined;
    return this.#items.shift();
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    if (!this.#cancelled) this.#paused = false;
  }

  cancel(): void {
    this.#cancelled = true;
    this.#items.length = 0;
  }

  snapshot(): CrawlerQueueSnapshot {
    return {
      maxDepth: this.#maxDepth,
      maxPages: this.#maxPages,
      maxQueryVariantsPerPath: this.#maxQueryVariantsPerPath,
      items: [...this.#items],
      knownUrls: [...this.#knownUrls],
      paused: this.#paused,
      cancelled: this.#cancelled
    };
  }

  static restore(snapshot: CrawlerQueueSnapshot): CrawlerQueue {
    const queue = new CrawlerQueue(
      snapshot.maxDepth,
      snapshot.maxPages,
      snapshot.items,
      snapshot.knownUrls,
      snapshot.maxQueryVariantsPerPath
    );
    queue.#paused = snapshot.paused;
    queue.#cancelled = snapshot.cancelled;
    return queue;
  }
}
