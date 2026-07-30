import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsPage } from "@/sidepanel/pages/ResultsPage";
import { appSnapshot, fileCandidate, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(), writeText: vi.fn() }));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));
vi.mock("@/export/save-export", () => ({ saveExport: vi.fn() }));

beforeEach(() => {
  mocks.sendMessage.mockReset().mockResolvedValue([]);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { tabs: { create: vi.fn().mockResolvedValue(undefined) } }
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText }
  });
});

function renderResults() {
  const session = scanSession({ filesDiscovered: 2 });
  const text = fileCandidate("notes");
  const pdf = fileCandidate("manual", {
    canonicalUrl: "https://example.test/manual.pdf",
    filename: "manual.pdf",
    extension: "pdf",
    category: "document"
  });
  const snapshot = appSnapshot({
    activeSession: session,
    sessions: [session],
    files: [text, pdf],
    settings: { ...appSnapshot().settings, confirmBeforeDownload: false }
  });
  render(<ResultsPage snapshot={snapshot} refresh={vi.fn()} />);
  return { text, pdf };
}

describe("ResultsPage", () => {
  it("筛选后保留选择并明确显示隐藏选择，批量操作范围保持一致", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();
    await user.click(screen.getByRole("checkbox", { name: `选择 ${text.filename}` }));
    await user.type(screen.getByRole("textbox", { name: "搜索文件名或 URL" }), "manual.pdf");

    expect(screen.getByText("1 项已选（1 项已隐藏）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加入下载" }));

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "QUEUE_DOWNLOADS",
      payload: { candidateIds: [text.id] }
    });
    expect(await screen.findByRole("status")).toHaveTextContent("未加入任何文件");
  });

  it("无效正则显示错误且不退化为普通搜索", async () => {
    const user = userEvent.setup();
    renderResults();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索文件名或 URL" }), {
      target: { value: "[" }
    });
    await user.click(screen.getByRole("checkbox", { name: "正则" }));

    expect(screen.getByRole("alert")).toHaveTextContent("正则表达式无效");
    expect(screen.getByText("当前筛选条件下没有结果")).toBeInTheDocument();
  });

  it("删除结果前确认，取消时不发送删除消息", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();
    vi.mocked(confirm).mockReturnValue(false);
    await user.click(screen.getByRole("checkbox", { name: `选择 ${text.filename}` }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("删除 1 项"));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("后端跳过部分下载时报告实际加入数量", async () => {
    const user = userEvent.setup();
    const { text, pdf } = renderResults();
    mocks.sendMessage.mockResolvedValue([{ id: "download-1" }]);
    await user.click(screen.getByRole("checkbox", { name: `选择 ${text.filename}` }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${pdf.filename}` }));
    await user.click(screen.getByRole("button", { name: "加入下载" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已加入 1 项，另有 1 项被安全规则跳过")
    );
  });

  it("分类状态和来源警告使用可访问的中文产品文案", () => {
    const session = scanSession({ filesDiscovered: 1 });
    render(
      <ResultsPage
        snapshot={appSnapshot({
          activeSession: session,
          files: [
            fileCandidate("stream", {
              source: "NETWORK_HEADER",
              sources: ["NETWORK_HEADER"],
              warnings: ["segmented_stream"]
            })
          ]
        })}
        refresh={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("响应头")).not.toHaveLength(0);
    expect(screen.getByText("分段流媒体，不能作为普通文件下载")).toBeInTheDocument();
    expect(screen.queryByText("NETWORK_HEADER")).not.toBeInTheDocument();
  });

  it("单项复制失败时显示明确错误反馈", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText }
    });
    mocks.writeText.mockRejectedValueOnce(new Error("剪贴板不可用"));
    renderResults();

    await user.click(screen.getAllByRole("button", { name: "复制" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("剪贴板不可用");
  });

  it("窗口高度变化时同步调整虚拟结果列表高度", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    renderResults();
    const list = screen.getByRole("region", { name: "扫描结果列表" });
    expect(list).toHaveStyle({ height: "410px" });

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fireEvent(window, new Event("resize"));

    expect(list).toHaveStyle({ height: "610px" });
  });
});
