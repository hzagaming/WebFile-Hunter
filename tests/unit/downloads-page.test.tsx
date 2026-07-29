import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadsPage } from "@/sidepanel/pages/DownloadsPage";
import { appSnapshot } from "../helpers/fixtures";
import type { DownloadTask } from "@/types/models";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: "download-1",
    candidateId: "file-1",
    url: "https://example.test/manual.pdf",
    filename: "manual.pdf",
    status: "in_progress",
    bytesReceived: 50,
    totalBytes: 100,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

beforeEach(() => mocks.sendMessage.mockReset().mockResolvedValue(undefined));

describe("DownloadsPage", () => {
  it("根据队列状态禁用无效操作并准确说明清理范围", () => {
    render(<DownloadsPage snapshot={appSnapshot()} refresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "开始队列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续队列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清除已完成/已取消" })).toBeDisabled();
  });

  it("下载进度向辅助技术公开百分比", () => {
    render(<DownloadsPage snapshot={appSnapshot({ downloads: [task()] })} refresh={vi.fn()} />);
    expect(screen.getByRole("progressbar", { name: "manual.pdf 下载进度" })).toHaveAttribute(
      "aria-valuenow",
      "50"
    );
  });

  it("操作失败显示错误，后续成功会清除旧错误", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockRejectedValueOnce(new Error("取消失败")).mockResolvedValue(undefined);
    render(<DownloadsPage snapshot={appSnapshot({ downloads: [task()] })} refresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("取消失败");
    await user.click(screen.getByRole("button", { name: "暂停队列" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
