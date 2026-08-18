import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Popup } from "@/popup/Popup";
import { I18nProvider } from "@/i18n";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));

beforeEach(() => {
  mocks.sendMessage.mockReset().mockResolvedValue(scanSession({ status: "running" }));
  vi.spyOn(window, "close").mockImplementation(() => undefined);
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      tabs: { query: vi.fn(() => Promise.resolve([{ id: 1, url: "edge://settings/" }])) },
      sidePanel: { open: vi.fn(() => Promise.resolve()) },
      permissions: { request: vi.fn(() => Promise.resolve(true)) }
    }
  });
});

describe("Popup", () => {
  it("英文语言下本地化 Popup 操作", async () => {
    render(
      <I18nProvider preference="en">
        <Popup />
      </I18nProvider>
    );
    expect(await screen.findByRole("button", { name: "Scan current page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open side panel" })).toBeEnabled();
  });

  it("非网页标签禁用扫描但仍可打开侧边栏", async () => {
    render(<Popup />);
    expect(await screen.findByText(/仅支持 HTTP 或 HTTPS/)).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "扫描当前页面" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "完整实时嗅探" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开侧边栏" })).toBeEnabled();
    expect(screen.getByText("⌕")).toHaveAttribute("aria-hidden", "true");
  });

  it("快速扫描也先获得当前站点权限", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve(true));
    const open = vi.fn(() => Promise.resolve());
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        tabs: {
          query: vi.fn(() => Promise.resolve([{ id: 7, url: "https://media.example.test/watch" }]))
        },
        sidePanel: { open },
        permissions: { request }
      }
    });
    render(<Popup />);

    await user.click(await screen.findByRole("button", { name: "扫描当前页面" }));

    expect(request).toHaveBeenCalledWith({ origins: ["https://media.example.test/*"] });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "SCAN_CURRENT_PAGE",
      payload: { tabId: 7 }
    });
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]!);
    expect(mocks.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      open.mock.invocationCallOrder[0]!
    );
  });

  it("实时嗅探请求全站权限并保持当前标签页隔离", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        tabs: {
          query: vi.fn(() => Promise.resolve([{ id: 7, url: "https://media.example.test/watch" }]))
        },
        sidePanel: { open: vi.fn(() => Promise.resolve()) },
        permissions: { request }
      }
    });
    render(<Popup />);

    await user.click(await screen.findByRole("button", { name: "完整实时嗅探" }));

    expect(request).toHaveBeenCalledWith({ origins: ["http://*/*", "https://*/*"] });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "START_LIVE_MONITOR",
      payload: { tabId: 7, origin: "https://media.example.test" }
    });
  });
});
