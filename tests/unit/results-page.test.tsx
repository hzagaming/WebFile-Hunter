import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsPage } from "@/sidepanel/pages/ResultsPage";
import { appSnapshot, fileCandidate, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  sendMessage: vi.fn(),
  writeText: vi.fn()
}));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));
vi.mock("@/export/save-export", () => ({ saveExport: vi.fn() }));

beforeEach(() => {
  mocks.sendMessage.mockReset().mockResolvedValue([]);
  mocks.openTab.mockReset().mockResolvedValue(undefined);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { tabs: { create: mocks.openTab } }
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
  it("刷新期间公开忙碌状态并阻止重复操作", async () => {
    const user = userEvent.setup();
    let finishRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        })
    );
    const session = scanSession({ filesDiscovered: 1 });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [fileCandidate("busy")] })}
        refresh={refresh}
      />
    );

    await user.click(screen.getByRole("button", { name: "刷新" }));

    expect(screen.getByRole("region", { name: "发现结果" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "刷新中…" })).toBeDisabled();
    finishRefresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

  it("单项操作期间保持准确按钮文案并禁用重复操作", async () => {
    const user = userEvent.setup();
    let finishOpen!: () => void;
    mocks.openTab.mockReturnValue(
      new Promise<void>((resolve) => {
        finishOpen = resolve;
      })
    );
    renderResults();

    await user.click(screen.getAllByRole("button", { name: "来源页" })[0]!);

    expect(screen.getByRole("region", { name: "发现结果" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "来源页" })[0]).toBeDisabled();
    finishOpen();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

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

  it("默认将低置信度临时资源放入独立的可能资源分类", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 1 });
    const blob = fileCandidate("blob-audio", {
      originalUrl: "blob:https://example.test/temporary-audio",
      canonicalUrl: "blob:https://example.test/temporary-audio",
      filename: "临时浏览器资源",
      category: "unknown",
      confidence: 40,
      isDownloadable: false,
      warnings: ["temporary_blob"]
    });
    delete blob.extension;
    render(
      <ResultsPage
        snapshot={appSnapshot({
          activeSession: session,
          files: [blob]
        })}
        refresh={vi.fn()}
      />
    );

    expect(screen.queryByText("临时浏览器资源，不能直接下载")).not.toBeInTheDocument();
    const possibleButton = screen.getByRole("button", { name: "可能资源" });
    expect(possibleButton).toHaveTextContent("1");
    await user.click(possibleButton);

    expect(screen.getByText("临时浏览器资源，不能直接下载")).toBeInTheDocument();
    expect(screen.getByText("可能资源，请人工确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "元数据" })).toBeDisabled();
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

  it("单项打开操作只创建一个标签页", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();

    await user.click(screen.getAllByRole("button", { name: "打开" })[0]!);

    await waitFor(() => expect(mocks.openTab).toHaveBeenCalledTimes(1));
    expect(mocks.openTab).toHaveBeenCalledWith({ url: text.canonicalUrl });
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

  it("完整权限允许探测已发现的外域资源元数据", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 1 });
    const external = fileCandidate("cdn", {
      canonicalUrl: "https://cdn.test/resource",
      originalUrl: "https://cdn.test/resource",
      isExternal: true,
      requiresPermission: true
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({
          activeSession: session,
          files: [external],
          allSitesAccess: true
        })}
        refresh={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: "元数据" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "PROBE_METADATA",
      payload: { sessionId: session.id, candidateId: external.id }
    });
  });

  it("对应网站权限允许探测外域资源元数据", () => {
    const session = scanSession({ filesDiscovered: 1 });
    const external = fileCandidate("cdn-site", {
      canonicalUrl: "https://cdn.test/resource",
      originalUrl: "https://cdn.test/resource",
      isExternal: true,
      requiresPermission: true
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({
          activeSession: session,
          files: [external],
          grantedOrigins: ["https://cdn.test/*"]
        })}
        refresh={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "元数据" })).toBeEnabled();
  });
});
