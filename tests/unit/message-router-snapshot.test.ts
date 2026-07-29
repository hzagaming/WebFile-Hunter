import { describe, expect, it } from "vitest";
import { selectSnapshotSession } from "@/background/message-router";
import { scanSession } from "../helpers/fixtures";

describe("selectSnapshotSession", () => {
  const activeTab = {
    id: 7,
    url: "https://current.test/page",
    title: "Current",
    origin: "https://current.test"
  };

  it("没有映射时只回退到当前标签页同 Origin 的最近任务", () => {
    const other = scanSession({ id: "other", tabId: 9, origin: "https://other.test" });
    const current = scanSession({
      id: "current",
      tabId: 7,
      origin: "https://current.test"
    });

    expect(selectSnapshotSession([other, current], activeTab)).toBe(current);
    expect(selectSnapshotSession([other], activeTab)).toBeUndefined();
  });

  it("历史页显式会话选择不受当前标签页限制", () => {
    const history = scanSession({ id: "history", tabId: 9, origin: "https://history.test" });

    expect(selectSnapshotSession([history], activeTab, "history")).toBe(history);
  });
});
