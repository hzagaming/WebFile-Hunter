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
