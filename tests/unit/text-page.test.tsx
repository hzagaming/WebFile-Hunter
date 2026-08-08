import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextPage } from "@/sidepanel/pages/TextPage";
import { appSnapshot } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({ saveExport: vi.fn() }));
vi.mock("@/export/save-export", () => ({ saveExport: mocks.saveExport }));

const documents = [
  {
    id: "text-a",
    pageUrl: "https://example.test/a",
    title: "第一页面",
    content: "公开正文 alpha <script>alert(1)</script>",
    characterCount: 41,
    capturedAt: 1,
    truncated: false
  },
  {
    id: "text-b",
    pageUrl: "https://example.test/frame",
    title: "内嵌页面",
    content: "第二份 beta beta",
    characterCount: 12,
    capturedAt: 2,
    truncated: true
  }
];

beforeEach(() => {
  mocks.saveExport.mockReset().mockResolvedValue(undefined);
});

describe("TextPage", () => {
  it("显示独立空状态和隐私边界", () => {
    render(<TextPage snapshot={appSnapshot()} />);
    expect(screen.getByRole("heading", { name: "网页文字" })).toBeInTheDocument();
    expect(screen.getByText(/不会读取输入框、密码/)).toBeInTheDocument();
    expect(screen.getByText("当前任务还没有可提取的网页文字。")).toBeInTheDocument();
  });

  it("切换文档、搜索计数并始终按纯文本渲染", async () => {
    const user = userEvent.setup();
    const { container } = render(<TextPage snapshot={appSnapshot({ textDocuments: documents })} />);
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();

    await user.selectOptions(screen.getByLabelText("选择网页"), "text-b");
    await user.type(screen.getByRole("searchbox", { name: "搜索当前文字" }), "beta");

    expect(screen.getByText("2 处匹配")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已截断");
  });

  it("复制当前、复制全部和导出 TXT 都有明确反馈", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<TextPage snapshot={appSnapshot({ textDocuments: documents })} />);

    await user.click(screen.getByRole("button", { name: "复制当前" }));
    expect(writeText).toHaveBeenCalledWith(documents[0]?.content);
    expect(await screen.findByRole("status")).toHaveTextContent("已复制当前网页文字");

    await user.click(screen.getByRole("button", { name: "复制全部" }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("第二份"));

    await user.click(screen.getByRole("button", { name: "导出 TXT" }));
    await waitFor(() => expect(mocks.saveExport).toHaveBeenCalled());
  });

  it("非 HTTP 页面不显示无法执行的重新提取入口", () => {
    render(
      <TextPage
        snapshot={appSnapshot({
          activeTab: { id: 1, url: "edge://settings/", title: "设置", origin: "null" }
        })}
        refresh={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /重新扫描|重新提取/ })).not.toBeInTheDocument();
  });
});
