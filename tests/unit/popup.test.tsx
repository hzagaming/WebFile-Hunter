import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Popup } from "@/popup/Popup";

vi.mock("@/messaging/message-client", () => ({ sendMessage: vi.fn() }));

beforeEach(() => {
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
  it("非网页标签禁用扫描但仍可打开侧边栏", async () => {
    render(<Popup />);
    expect(await screen.findByText(/仅支持 HTTP 或 HTTPS/)).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "扫描当前页面" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始监听" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开侧边栏" })).toBeEnabled();
    expect(screen.getByText("⌕")).toHaveAttribute("aria-hidden", "true");
  });
});
