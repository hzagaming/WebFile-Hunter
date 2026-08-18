import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, resolveLanguage, translate, useI18n } from "@/i18n";

function Probe() {
  const { known, language, t } = useI18n();
  return (
    <span>{`${language}:${t("已复制 {count} 项。", { count: 3 })}:${known("页面请求失败（HTTP 503）。")}`}</span>
  );
}

describe("i18n", () => {
  it("自动语言只将中文浏览器语言映射为简体中文", () => {
    expect(resolveLanguage("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "fr-FR")).toBe("en");
  });

  it("支持类型化文案插值并保留未知占位值", () => {
    expect(translate("en", "已复制 {count} 项。", { count: 3 })).toBe("Copied 3 items.");
    expect(translate("zh-CN", "已复制 {count} 项。", { count: 3 })).toBe("已复制 3 项。");
  });

  it("Provider 向组件提供指定语言", () => {
    render(
      <I18nProvider preference="en">
        <Probe />
      </I18nProvider>
    );
    expect(
      screen.getByText("en:Copied 3 items.:The page request failed (HTTP 503).")
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });
});
