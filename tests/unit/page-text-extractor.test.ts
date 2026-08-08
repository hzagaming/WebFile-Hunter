import { afterEach, describe, expect, it } from "vitest";
import { extractPageText } from "@/content/page-text-extractor";
import { MAX_PAGE_TEXT_CHARACTERS } from "@/core/page-text-policy";

afterEach(() => {
  document.documentElement.removeAttribute("lang");
  document.body.replaceChildren();
});

describe("extractPageText", () => {
  it("提取可见正文并保留开放 Shadow DOM 文本", () => {
    document.documentElement.lang = "zh-CN";
    document.body.innerHTML = `
      <main><h1>页面标题</h1><p>第一段 <strong>正文</strong></p></main>
    `;
    const host = document.createElement("section");
    host.attachShadow({ mode: "open" }).innerHTML = "<p>Shadow 正文</p>";
    document.body.append(host);

    const result = extractPageText();
    expect(result.content).toMatch(/页面标题[\s\S]*第一段 正文[\s\S]*Shadow 正文/);
    expect(result).toMatchObject({ language: "zh-CN", truncated: false });
  });

  it("排除隐藏内容、脚本样式、模板和用户输入", () => {
    document.body.innerHTML = `
      <p>公开正文</p>
      <p hidden>hidden-secret</p>
      <p aria-hidden="true">aria-secret</p>
      <p style="display:none">display-secret</p>
      <script>script-secret</script>
      <style>.x::before{content:"style-secret"}</style>
      <noscript>noscript-secret</noscript>
      <template>template-secret</template>
      <input value="input-secret">
      <textarea>textarea-secret</textarea>
      <select><option>select-secret</option></select>
      <div contenteditable="true">draft-secret</div>
    `;

    const content = extractPageText().content;
    expect(content).toContain("公开正文");
    for (const secret of [
      "hidden-secret",
      "aria-secret",
      "display-secret",
      "script-secret",
      "style-secret",
      "noscript-secret",
      "template-secret",
      "input-secret",
      "textarea-secret",
      "select-secret",
      "draft-secret"
    ]) {
      expect(content).not.toContain(secret);
    }
  });

  it("正规化空白并在单页上限处安全截断", () => {
    document.body.innerHTML = `<p>  多余   空白\n文本 </p><p>${"字".repeat(
      MAX_PAGE_TEXT_CHARACTERS + 100
    )}</p>`;

    const result = extractPageText();

    expect(result.content).toContain("多余 空白 文本");
    expect(result.content.length).toBeLessThanOrEqual(MAX_PAGE_TEXT_CHARACTERS);
    expect(result.truncated).toBe(true);
  });

  it("折叠 details 只提取摘要，展开后才提取正文", () => {
    document.body.innerHTML = `
      <details><summary>折叠摘要</summary>direct-details-secret<p>closed-details-secret</p></details>
      <details open><summary>展开摘要</summary><p>展开公开正文</p></details>
    `;

    const content = extractPageText().content;
    expect(content).toContain("折叠摘要");
    expect(content).toContain("展开公开正文");
    expect(content).not.toContain("closed-details-secret");
    expect(content).not.toContain("direct-details-secret");
  });
});
