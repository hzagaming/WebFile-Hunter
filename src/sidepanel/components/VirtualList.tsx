import { useMemo, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react";

interface Props<T> {
  items: readonly T[];
  itemHeight: number;
  height: number;
  endPadding?: number;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  endPadding = 0,
  getKey,
  renderItem
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 4;
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const naturalStart = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const start = Math.min(Math.max(0, items.length - visibleCount), naturalStart);
  const end = Math.min(items.length, start + visibleCount);
  const visible = useMemo(() => items.slice(start, end), [end, items, start]);

  const onScroll = (event: UIEvent<HTMLDivElement>): void =>
    setScrollTop(event.currentTarget.scrollTop);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const maxScroll = Math.max(0, items.length * itemHeight + endPadding - height);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? maxScroll
          : event.key === "PageDown"
            ? Math.min(maxScroll, event.currentTarget.scrollTop + height)
            : event.key === "PageUp"
              ? Math.max(0, event.currentTarget.scrollTop - height)
              : event.key === "ArrowDown"
                ? Math.min(maxScroll, event.currentTarget.scrollTop + itemHeight)
                : event.key === "ArrowUp"
                  ? Math.max(0, event.currentTarget.scrollTop - itemHeight)
                  : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.currentTarget.scrollTop = next;
    setScrollTop(next);
  };
  return (
    <div
      className="virtual-list"
      style={{ height }}
      role="region"
      aria-label="扫描结果列表"
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div
        role="list"
        style={{ height: items.length * itemHeight + endPadding, position: "relative" }}
      >
        <div style={{ position: "absolute", insetInline: 0, top: start * itemHeight }}>
          {visible.map((item, index) => (
            <div
              key={getKey(item)}
              role="listitem"
              aria-posinset={start + index + 1}
              aria-setsize={items.length}
              style={{ height: itemHeight }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
