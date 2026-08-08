import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VirtualList } from "@/sidepanel/components/VirtualList";

describe("VirtualList", () => {
  it("公开列表语义、项目位置并支持键盘滚动", () => {
    render(
      <VirtualList
        items={["一", "二", "三"]}
        itemHeight={40}
        height={80}
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    );
    const region = screen.getByRole("region", { name: "扫描结果列表" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-posinset", "2");
    fireEvent.keyDown(region, { key: "End" });
    expect(region.scrollTop).toBe(40);
  });

  it("筛选结果缩小时限制旧滚动位置，避免出现空白列表", () => {
    const many = Array.from({ length: 20 }, (_, index) => `项目 ${index + 1}`);
    const { rerender } = render(
      <VirtualList
        items={many}
        itemHeight={40}
        height={80}
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    );
    const region = screen.getByRole("region", { name: "扫描结果列表" });
    region.scrollTop = 600;
    fireEvent.scroll(region);

    rerender(
      <VirtualList
        items={["唯一结果"]}
        itemHeight={40}
        height={80}
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    );

    expect(screen.getByText("唯一结果")).toBeInTheDocument();
  });

  it("键盘滚动保留底部操作栏所需的尾部空间", () => {
    render(
      <VirtualList
        items={["一", "二", "三"]}
        itemHeight={40}
        height={80}
        endPadding={24}
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    );
    const region = screen.getByRole("region", { name: "扫描结果列表" });

    fireEvent.keyDown(region, { key: "End" });

    expect(region.scrollTop).toBe(64);
  });

  it("子控件处理方向键时不触发列表滚动", () => {
    render(
      <VirtualList
        items={["一", "二", "三"]}
        itemHeight={40}
        height={80}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">{item}</button>}
      />
    );
    const region = screen.getByRole("region", { name: "扫描结果列表" });

    fireEvent.keyDown(screen.getByRole("button", { name: "一" }), { key: "ArrowDown" });

    expect(region.scrollTop).toBe(0);
  });
});
