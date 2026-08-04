import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearDatabase,
  clearHistoryData,
  deleteSessionData,
  listPageTexts,
  putPageText
} from "@/database/db";
import { MAX_PAGE_TEXT_CHARACTERS, MAX_SESSION_TEXT_CHARACTERS } from "@/core/page-text-policy";

afterEach(clearDatabase);

function text(pageUrl: string, content: string) {
  return {
    pageUrl,
    title: "页面",
    content,
    capturedAt: Date.now(),
    truncated: false
  };
}

describe("page text database", () => {
  it("按任务与页面地址覆盖正文而不是重复写入", async () => {
    await putPageText("session-text", text("https://example.test/a", "旧正文"));
    await putPageText("session-text", text("https://example.test/a", "新正文"));

    expect(await listPageTexts("session-text")).toEqual([
      expect.objectContaining({ content: "新正文", characterCount: 3 })
    ]);
  });

  it("限制单页与单任务正文体积并标记截断", async () => {
    const first = await putPageText(
      "session-limit",
      text("https://example.test/first", "甲".repeat(MAX_PAGE_TEXT_CHARACTERS + 10))
    );
    expect(first).toMatchObject({
      characterCount: MAX_PAGE_TEXT_CHARACTERS,
      truncated: true
    });

    for (
      let index = 1;
      index < MAX_SESSION_TEXT_CHARACTERS / MAX_PAGE_TEXT_CHARACTERS;
      index += 1
    ) {
      await putPageText(
        "session-limit",
        text(`https://example.test/${index}`, "乙".repeat(MAX_PAGE_TEXT_CHARACTERS))
      );
    }
    await expect(
      putPageText("session-limit", text("https://example.test/overflow", "不应保存"))
    ).resolves.toBeUndefined();
  });

  it("删除任务或清空历史时同步删除正文", async () => {
    await putPageText("session-delete", text("https://example.test/a", "正文"));
    await deleteSessionData("session-delete");
    expect(await listPageTexts("session-delete")).toEqual([]);

    await putPageText("session-clear", text("https://example.test/b", "正文"));
    await clearHistoryData();
    expect(await listPageTexts("session-clear")).toEqual([]);
  });
});
