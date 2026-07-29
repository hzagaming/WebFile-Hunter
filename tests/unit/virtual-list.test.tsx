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
});
