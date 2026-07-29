import { describe, expect, it } from "vitest";
import { shouldKeepPageResource } from "@/background/page-scanner";
import type { RawResource } from "@/types/scanner";

function resource(tagName: string): RawResource {
  return {
    url: "https://example.test/assets/resource",
    source: "DOM_ATTRIBUTE",
    tagName,
    isExternal: false
  };
}

describe("shouldKeepPageResource", () => {
  it.each(["script", "link", "embed", "object"])("保留 <%s> 的未知后缀资源", (tagName) => {
    expect(shouldKeepPageResource(resource(tagName))).toBe(true);
  });

  it("不把普通未知链接误判为文件", () => {
    expect(shouldKeepPageResource(resource("a"))).toBe(false);
  });
});
