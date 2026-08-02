import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "@/sidepanel/pages/SettingsPage";
import { DEFAULT_SETTINGS } from "@/utils/defaults";
import type { AppSettings } from "@/types/models";
import { appSnapshot } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));

beforeEach(() => {
  mocks.sendMessage.mockImplementation((message: { type: string }) =>
    Promise.resolve(message.type === "GET_GRANTED_ORIGINS" ? [] : undefined)
  );
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
});

describe("SettingsPage", () => {
  it("保存前归一化所有设置页数字范围", async () => {
    const user = userEvent.setup();
    render(<SettingsPage snapshot={appSnapshot()} refresh={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("实时监听秒数"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("下载并发"), { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText("历史保留天数"), { target: { value: "99999" } });
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        type: "SAVE_SETTINGS",
        payload: {
          settings: expect.objectContaining({
            monitorDurationSeconds: 10,
            downloadConcurrency: 6,
            retentionDays: 3650
          }) as AppSettings
        }
      })
    );
    expect(screen.getByRole("status")).toHaveTextContent("设置已保存");
  });

  it("保存失败时显示可访问错误且不会成为未处理拒绝", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockImplementation((message: { type: string }) =>
      message.type === "GET_GRANTED_ORIGINS"
        ? Promise.resolve([])
        : Promise.reject(new Error("设置写入失败"))
    );
    render(<SettingsPage snapshot={appSnapshot()} refresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("设置写入失败");
  });

  it("撤销网站权限前明确提示会停止对应任务", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockImplementation((message: { type: string }) =>
      Promise.resolve(
        message.type === "GET_GRANTED_ORIGINS" ? ["https://example.test/*"] : undefined
      )
    );
    vi.mocked(confirm).mockReturnValue(false);
    render(<SettingsPage snapshot={appSnapshot()} refresh={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "撤销" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("停止"));
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "REVOKE_ORIGIN" })
    );
  });

  it("将全站权限聚合为完整嗅探状态并支持一键撤销", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockImplementation((message: { type: string }) =>
      Promise.resolve(message.type === "GET_GRANTED_ORIGINS" ? ["http://*/*", "https://*/*"] : true)
    );
    render(<SettingsPage snapshot={appSnapshot()} refresh={vi.fn()} />);

    expect(await screen.findByText("完整跨域嗅探已启用")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销完整权限" }));

    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: "REVOKE_ALL_SITES" });
    expect(await screen.findByRole("status")).toHaveTextContent("完整嗅探权限已撤销");
  });

  it("清除全部数据后恢复界面默认设置", async () => {
    const user = userEvent.setup();
    render(<SettingsPage snapshot={appSnapshot()} refresh={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("实时监听秒数"), { target: { value: "120" } });
    await user.click(screen.getByRole("button", { name: "清除全部本地数据" }));
    await waitFor(() =>
      expect(screen.getByLabelText("实时监听秒数")).toHaveValue(
        DEFAULT_SETTINGS.monitorDurationSeconds
      )
    );
  });

  it("上下文快照刷新时保留尚未保存的设置草稿", () => {
    const initial = appSnapshot();
    const { rerender } = render(<SettingsPage snapshot={initial} refresh={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("最大深度"), { target: { value: "4" } });

    rerender(
      <SettingsPage
        snapshot={appSnapshot({ settings: structuredClone(initial.settings) })}
        refresh={vi.fn()}
      />
    );

    expect(screen.getByLabelText("最大深度")).toHaveValue(4);
  });
});
