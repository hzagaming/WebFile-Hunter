import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "@/sidepanel/pages/HistoryPage";
import { appSnapshot, scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  saveExport: vi.fn(),
  sendMessage: vi.fn()
}));

vi.mock("@/messaging/message-client", () => ({ sendMessage: mocks.sendMessage }));
vi.mock("@/export/save-export", () => ({ saveExport: mocks.saveExport }));

beforeEach(() => {
  mocks.saveExport.mockResolvedValue(undefined);
  mocks.sendMessage.mockReset();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
});

describe("HistoryPage", () => {
  it("只允许暂停的递归任务继续，运行中的任务不显示继续按钮", () => {
    render(
      <HistoryPage
        snapshot={appSnapshot({
          sessions: [
            scanSession({ id: "running", mode: "recursive_crawl", status: "running" }),
            scanSession({ id: "paused", mode: "recursive_crawl", status: "paused" })
          ]
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );
    expect(screen.getAllByRole("button", { name: "继续任务" })).toHaveLength(1);
  });

  it("删除运行中任务前说明会停止任务并等待确认", async () => {
    const user = userEvent.setup();
    vi.mocked(confirm).mockReturnValue(false);
    render(
      <HistoryPage
        snapshot={appSnapshot({
          sessions: [scanSession({ mode: "live_monitor", status: "running" })]
        })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("先停止"));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("成功导出使用成功反馈而不是错误样式", async () => {
    const user = userEvent.setup();
    const session = scanSession({ filesDiscovered: 1 });
    const snapshot = appSnapshot({ sessions: [session], activeSession: session });
    mocks.sendMessage.mockResolvedValue(snapshot);
    render(<HistoryPage snapshot={snapshot} refresh={vi.fn()} openResults={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "导出" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("已导出");
    expect(notice).toHaveClass("notice-success");
    expect(notice).not.toHaveClass("notice-error");
  });

  it("删除失败时显示错误反馈", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockRejectedValue(new Error("数据库写入失败"));
    render(
      <HistoryPage
        snapshot={appSnapshot({ sessions: [scanSession()] })}
        refresh={vi.fn()}
        openResults={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("数据库写入失败"));
  });
});
