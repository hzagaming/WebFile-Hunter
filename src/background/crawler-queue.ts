import type { CrawlQueueItem } from "@/types/models";

export interface CrawlerQueueSnapshot {
  maxDepth: number;
  maxPages: number;
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
  #paused = false;
  #cancelled = false;

  constructor(
    maxDepth: number,
    maxPages: number,
    items: CrawlQueueItem[] = [],
    knownUrls?: string[]
  ) {
    this.#maxDepth = maxDepth;
    this.#maxPages = maxPages;
    this.#items = [...items];
    this.#knownUrls = new Set(knownUrls ?? items.map((item) => item.url));
  }

  get size(): number {
    return this.#items.length;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  enqueue(item: CrawlQueueItem): boolean {
    if (
      this.#cancelled ||
      item.depth > this.#maxDepth ||
      this.#knownUrls.size >= this.#maxPages ||
      this.#knownUrls.has(item.url)
    ) {
      return false;
    }
    this.#knownUrls.add(item.url);
    this.#items.push(item);
    return true;
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
      snapshot.knownUrls
    );
    queue.#paused = snapshot.paused;
    queue.#cancelled = snapshot.cancelled;
    return queue;
  }
}
