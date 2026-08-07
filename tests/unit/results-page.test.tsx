import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

    await user.click(screen.getAllByRole("button", { name: "打开来源页" })[0]!);

    expect(screen.getByRole("region", { name: "发现结果" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "打开来源页" })[0]).toBeDisabled();
    finishOpen();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

  it("筛选后保留选择并明确显示隐藏选择，批量操作范围保持一致", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();
    await user.click(screen.getByRole("checkbox", { name: `选择 ${text.filename}` }));
    await user.type(screen.getByRole("searchbox", { name: "搜索结果" }), "manual.pdf");

    expect(screen.getByText("1 项已选（1 项已隐藏）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加入下载" }));

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "QUEUE_DOWNLOADS",
      payload: { candidateIds: [text.id] }
    });
    expect(
      await screen.findByText("未加入任何文件，请检查文件类型、大小与安全设置。")
    ).toBeInTheDocument();
  });

  it("无效正则显示错误且不退化为普通搜索", async () => {
    const user = userEvent.setup();
    renderResults();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索结果" }), {
      target: { value: "[" }
    });
    await user.click(screen.getByRole("checkbox", { name: "正则" }));

    expect(screen.getByRole("alert")).toHaveTextContent("正则表达式无效");
    expect(screen.getByText("当前筛选条件下没有结果")).toBeInTheDocument();
  });

  it("普通搜索会归一化空格与全角字符并匹配完整结果信息", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 2 });
    const image = fileCandidate("summer-cover", {
      canonicalUrl: "https://example.test/assets/cover-file",
      filename: "cover-file",
      extension: "png",
      category: "image",
      mimeType: "image/png",
      sourcePageTitle: "Summer Album"
    });
    const document = fileCandidate("manual", {
      canonicalUrl: "https://example.test/manual.pdf",
      filename: "manual.pdf",
      extension: "pdf",
      category: "document"
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [image, document] })}
        refresh={vi.fn()}
      />
    );

    await user.type(screen.getByRole("searchbox", { name: "搜索结果" }), "  ＰＮＧ   summer  ");

    expect(screen.getByTitle(image.filename)).toBeInTheDocument();
    expect(screen.queryByTitle(document.filename)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("找到 1 项");
  });

  it("扩展名筛选去除开头点号并执行精确匹配", async () => {
    const user = userEvent.setup();
    renderResults();
    await user.click(screen.getByText("更多筛选与排序"));
    const extension = screen.getByRole("textbox", { name: "扩展名" });

    await user.type(extension, ".pd");
    expect(screen.getByText(/当前筛选条件下没有结果/)).toBeInTheDocument();

    await user.clear(extension);
    await user.type(extension, ".pdf");
    expect(screen.getByTitle("manual.pdf")).toBeInTheDocument();
    expect(screen.queryByTitle("notes.txt")).not.toBeInTheDocument();
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

  it("文件详情提供复制文件名、Markdown 与元数据 JSON 操作", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText }
    });
    const { text } = renderResults();
    const trigger = screen.getAllByRole("button", { name: "详情" })[0]!;

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: `文件详情：${text.filename}` });
    expect(document.querySelector(".section-heading")).toHaveAttribute("inert");
    expect(within(dialog).getByText(text.canonicalUrl)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "复制文件名" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenLastCalledWith(text.filename));
    await user.click(within(dialog).getByRole("button", { name: "复制 Markdown" }));
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenLastCalledWith(`[${text.filename}](${text.canonicalUrl})`)
    );
    await user.click(within(dialog).getByRole("button", { name: "复制元数据 JSON" }));
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining(`"id": "${text.id}"`)
      )
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("文件详情打开链接失败时显示错误并保持弹层可用", async () => {
    const user = userEvent.setup();
    mocks.openTab.mockRejectedValueOnce(new Error("浏览器拒绝打开标签页"));
    renderResults();

    await user.click(screen.getAllByRole("button", { name: "详情" })[0]!);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "打开资源" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("浏览器拒绝打开标签页");
    expect(within(dialog).getByRole("button", { name: "关闭文件详情" })).toBeEnabled();
  });

  it("单项打开操作只创建一个标签页", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();

    await user.click(screen.getAllByRole("button", { name: "打开" })[0]!);

    await waitFor(() => expect(mocks.openTab).toHaveBeenCalledTimes(1));
    expect(mocks.openTab).toHaveBeenCalledWith({ url: text.canonicalUrl });
  });

  it("图片可在独立预览层查看并能关闭后返回触发按钮", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 1 });
    const image = fileCandidate("cover", {
      canonicalUrl: "https://example.test/cover.webp",
      filename: "cover.webp",
      extension: "webp",
      category: "image",
      mimeType: "image/webp"
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [image] })}
        refresh={vi.fn()}
      />
    );

    const thumbnail = screen.getByRole("img", { name: `缩略图：${image.filename}` });
    expect(thumbnail).toHaveAttribute("src", image.canonicalUrl);
    expect(thumbnail).toHaveAttribute("loading", "lazy");
    expect(thumbnail).toHaveAttribute("decoding", "async");
    const trigger = screen.getByRole("button", { name: `放大预览：${image.filename}` });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: `图片预览：${image.filename}` });
    const preview = screen.getByRole("img", { name: image.filename });
    expect(dialog).toBeInTheDocument();
    expect(preview).toHaveAttribute("src", image.canonicalUrl);
    expect(preview).toHaveAttribute("referrerpolicy", "no-referrer");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("音频可在独立预览层手动试听且不会自动播放", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 1 });
    const audio = fileCandidate("podcast", {
      canonicalUrl: "https://example.test/podcast.mp3",
      filename: "podcast.mp3",
      extension: "mp3",
      category: "audio",
      mimeType: "audio/mpeg"
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [audio] })}
        refresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "试听" }));

    const player = screen.getByLabelText(`音频播放器：${audio.filename}`);
    expect(screen.getByRole("dialog", { name: `音频试听：${audio.filename}` })).toBeInTheDocument();
    expect(player).toHaveAttribute("src", audio.canonicalUrl);
    expect(player).toHaveAttribute("controls");
    expect(player).toHaveAttribute("preload", "metadata");
    expect(player).not.toHaveAttribute("autoplay");
  });

  it("音频卡片可直接播放、暂停并显示时长和失败状态", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const session = scanSession({ filesDiscovered: 1 });
    const audio = fileCandidate("inline-podcast", {
      canonicalUrl: "https://example.test/inline-podcast.mp3",
      filename: "inline-podcast.mp3",
      extension: "mp3",
      category: "audio",
      mimeType: "audio/mpeg"
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [audio] })}
        refresh={vi.fn()}
      />
    );

    const card = screen.getByTitle(audio.filename).closest("article");
    const media = card?.querySelector("audio");
    expect(media).not.toBeNull();
    if (!media) throw new TypeError("缺少内联音频元素");
    expect(media).toHaveAttribute("aria-hidden", "true");
    expect(media).not.toHaveAttribute("autoplay");
    Object.defineProperty(media, "duration", { configurable: true, value: 65 });
    fireEvent.loadedMetadata(media);
    expect(screen.getByText("1:05")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `播放音频：${audio.filename}` }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(media);
    await user.click(screen.getByRole("button", { name: `暂停音频：${audio.filename}` }));
    expect(pause).toHaveBeenCalled();

    fireEvent.error(media);
    expect(screen.getByText("不可播放")).toBeInTheDocument();
  });

  it("切换卡片音频时会停止仍在加载的上一段音频", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const session = scanSession({ filesDiscovered: 2 });
    const first = fileCandidate("first-audio", {
      canonicalUrl: "https://example.test/first.mp3",
      filename: "first.mp3",
      extension: "mp3",
      category: "audio",
      mimeType: "audio/mpeg"
    });
    const second = fileCandidate("second-audio", {
      canonicalUrl: "https://example.test/second.mp3",
      filename: "second.mp3",
      extension: "mp3",
      category: "audio",
      mimeType: "audio/mpeg"
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [first, second] })}
        refresh={vi.fn()}
      />
    );

    const firstAudio = screen.getByTitle(first.filename).closest("article")?.querySelector("audio");
    if (!firstAudio) throw new TypeError("缺少第一段内联音频");
    await user.click(screen.getByRole("button", { name: `播放音频：${first.filename}` }));
    await user.click(screen.getByRole("button", { name: `播放音频：${second.filename}` }));

    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith();
  });

  it("普通文件不显示媒体预览入口", () => {
    renderResults();

    expect(screen.queryByRole("button", { name: "预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "试听" })).not.toBeInTheDocument();
  });

  it("单项下载只加入并启动对应结果", async () => {
    const user = userEvent.setup();
    const { text } = renderResults();
    mocks.sendMessage.mockImplementation((message: { type: string }) =>
      message.type === "QUEUE_DOWNLOADS"
        ? Promise.resolve([
            {
              id: "download-one",
              candidateId: text.id,
              url: text.canonicalUrl,
              filename: text.filename,
              status: "queued",
              createdAt: 1,
              updatedAt: 1
            }
          ])
        : Promise.resolve(undefined)
    );

    await user.click(screen.getAllByRole("button", { name: "下载" })[0]!);

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(1, {
      type: "QUEUE_DOWNLOADS",
      payload: { candidateIds: [text.id] }
    });
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "DOWNLOAD_ACTION",
      payload: { action: "start", taskId: "download-one" }
    });
    expect(screen.getByRole("status")).toHaveTextContent("已开始下载");
  });

  it("分段流媒体禁止试听、打开和单项下载", () => {
    const session = scanSession({ filesDiscovered: 1 });
    const stream = fileCandidate("stream-audio", {
      canonicalUrl: "https://example.test/live.m3u8",
      filename: "live.m3u8",
      extension: "m3u8",
      category: "audio",
      mimeType: "application/vnd.apple.mpegurl",
      isDownloadable: false,
      warnings: ["segmented_stream"]
    });
    render(
      <ResultsPage
        snapshot={appSnapshot({ activeSession: session, files: [stream] })}
        refresh={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "试听" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下载" })).toBeDisabled();
    expect(document.querySelector("audio")).not.toHaveAttribute("src");
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
