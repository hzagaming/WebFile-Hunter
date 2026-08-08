import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScannerPage } from "@/sidepanel/pages/ScannerPage";
import { appSnapshot, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  sendMessage: vi.fn()
}));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));

beforeEach(() => {
  mocks.sendMessage.mockReset().mockResolvedValue(undefined);
  mocks.requestPermission.mockReset().mockResolvedValue(true);
  vi.stubGlobal("chrome", {
    permissions: { request: mocks.requestPermission }
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
});

describe("ScannerPage", () => {
  it("在非 HTTP 页面禁用扫描并显示原因", () => {
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: { id: 1, url: "edge://settings/", title: "设置", origin: "null" }
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /扫描当前页面/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("仅支持 HTTP 或 HTTPS");
  });

  it("实时监听说明使用用户设置的时长", () => {
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 1,
            url: "https://example.test/",
            title: "Example",
            origin: "https://example.test"
          },
          settings: { ...appSnapshot().settings, monitorDurationSeconds: 180 }
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );
    expect(screen.getByText(/180 秒/)).toBeInTheDocument();
  });

  it("递归入口明确说明 Sitemap 与当前 SPA DOM 补种", () => {
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 9,
            url: "https://example.test/page",
            title: "Example",
            origin: "https://example.test"
          }
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /同域递归扫描/ })).toHaveTextContent("Sitemap");
    expect(screen.getByRole("button", { name: /同域递归扫描/ })).toHaveTextContent("SPA");
  });

  it("递归设置公开样式表抓取上限", async () => {
    const user = userEvent.setup();
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 9,
            url: "https://example.test/page",
            title: "Example",
            origin: "https://example.test"
          }
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /同域递归扫描/ }));
    expect(screen.getByLabelText("样式表抓取上限")).toHaveValue(100);
  });

  it("从侧栏扫描当前页时先请求当前站点权限", async () => {
    const user = userEvent.setup();
    const created = scanSession({ id: "created-session", status: "running" });
    mocks.sendMessage.mockResolvedValue(created);
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 9,
            url: "https://media.example.test/watch",
            title: "Media",
            origin: "https://media.example.test"
          }
        })}
        refresh={refresh}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /扫描当前页面/ }));

    expect(mocks.requestPermission).toHaveBeenCalledWith({
      origins: ["https://media.example.test/*"]
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "SCAN_CURRENT_PAGE",
      payload: { tabId: 9 }
    });
    expect(refresh).toHaveBeenCalledWith("created-session");
  });

  it("实时嗅探请求 HTTP 与 HTTPS 全站权限以覆盖第三方资源", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockResolvedValue(scanSession({ id: "live-session", mode: "live_monitor" }));
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 9,
            url: "https://media.example.test/watch",
            title: "Media",
            origin: "https://media.example.test"
          }
        })}
        refresh={vi.fn().mockResolvedValue(undefined)}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /开始完整嗅探/ }));

    expect(mocks.requestPermission).toHaveBeenCalledWith({
      origins: ["http://*/*", "https://*/*"]
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "START_LIVE_MONITOR",
      payload: { tabId: 9, origin: "https://media.example.test" }
    });
  });

  it("控制请求进行中时禁用任务按钮以阻止重复操作", async () => {
    const user = userEvent.setup();
    let resolveRequest: (() => void) | undefined;
    mocks.sendMessage.mockImplementation(
      () =>
        new Promise<void>((resolvePromise) => {
          resolveRequest = resolvePromise;
        })
    );
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeSession: scanSession({ mode: "recursive_crawl", status: "running" })
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeDisabled();
    resolveRequest?.();
  });

  it("启动任务期间提供静音且可访问的实时状态反馈", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((session: ReturnType<typeof scanSession>) => void) | undefined;
    mocks.sendMessage.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          resolveRequest = resolvePromise;
        })
    );
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeTab: {
            id: 9,
            url: "https://example.test/page",
            title: "Example",
            origin: "https://example.test"
          }
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /扫描当前页面/ }));

    const feedback = screen.getByText("正在启动当前页扫描…");
    expect(feedback).toHaveAttribute("role", "status");
    expect(feedback.closest("section")).toHaveAttribute("aria-busy", "true");
    resolveRequest?.(scanSession({ id: "working-session" }));
  });

  it("停止进行中任务前确认", async () => {
    const user = userEvent.setup();
    vi.mocked(confirm).mockReturnValue(false);
    const session = scanSession({ status: "running" });
    render(
      <ScannerPage
        snapshot={appSnapshot({ activeSession: session })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "停止任务" }));
    expect(confirm).toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("递归任务显示当前处理 URL 和真实请求速率", () => {
    render(
      <ScannerPage
        snapshot={appSnapshot({
          activeSession: scanSession({
            mode: "recursive_crawl",
            status: "running",
            currentUrl: "https://example.test/page-2",
            requestsPerMinute: 7
          })
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    expect(screen.getByText("正在处理：https://example.test/page-2")).toBeInTheDocument();
    expect(screen.getByText("请求速率：7 次/分钟")).toBeInTheDocument();
  });
});
