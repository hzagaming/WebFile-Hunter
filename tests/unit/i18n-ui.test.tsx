import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { DownloadsPage } from "@/sidepanel/pages/DownloadsPage";
import { HistoryPage } from "@/sidepanel/pages/HistoryPage";
import { ResultsPage } from "@/sidepanel/pages/ResultsPage";
import { ScannerPage } from "@/sidepanel/pages/ScannerPage";
import { SettingsPage } from "@/sidepanel/pages/SettingsPage";
import { TextPage } from "@/sidepanel/pages/TextPage";
import { appSnapshot } from "../helpers/fixtures";

describe("localized pages", () => {
  it("六个侧栏页面均渲染英文主界面", () => {
    const snapshot = appSnapshot();
    const refresh = vi.fn(() => Promise.resolve());
    render(
      <I18nProvider preference="en">
        <ScannerPage snapshot={snapshot} refresh={refresh} openResults={vi.fn()} />
        <ResultsPage snapshot={snapshot} refresh={refresh} />
        <TextPage snapshot={snapshot} refresh={refresh} />
        <DownloadsPage snapshot={snapshot} refresh={refresh} />
        <HistoryPage snapshot={snapshot} refresh={refresh} openResults={vi.fn()} />
        <SettingsPage snapshot={snapshot} refresh={refresh} />
      </I18nProvider>
    );

    expect(screen.getByRole("heading", { name: "Start scanning" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Discovered results/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page text" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Download queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scan history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings", level: 2 })).toBeInTheDocument();
  });
});
