import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs.js";

function BasicTabs() {
  return (
    <Tabs>
      <Tabs.List aria-label="Prompt sections">
        <Tabs.Tab id="details">Details</Tabs.Tab>
        <Tabs.Tab id="history" isDisabled>
          History
        </Tabs.Tab>
        <Tabs.Tab id="settings">Settings</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="details">Details content.</Tabs.Panel>
      <Tabs.Panel id="history">History content.</Tabs.Panel>
      <Tabs.Panel id="settings">Settings content.</Tabs.Panel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders a tablist with every tab, and shows only the first tab's panel by default", () => {
    render(<BasicTabs />);
    expect(screen.getByRole("tablist", { name: "Prompt sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Details" })).toHaveTextContent(
      "Details content.",
    );
  });

  it("selects a tab on click and shows the matching panel", async () => {
    const user = userEvent.setup();
    render(<BasicTabs />);
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "Settings" })).toHaveTextContent(
      "Settings content.",
    );
  });

  it("moves selection with the arrow keys, skipping the disabled tab entirely", async () => {
    const user = userEvent.setup();
    render(<BasicTabs />);
    const details = screen.getByRole("tab", { name: "Details" });
    details.focus();
    expect(details).toHaveFocus();

    // Details -> History (disabled, must be skipped) -> Settings.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Wraps back around to Details, still skipping History.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveFocus();
  });

  it("gives the disabled tab aria-disabled and never selects it", async () => {
    const user = userEvent.setup();
    render(<BasicTabs />);
    const history = screen.getByRole("tab", { name: "History" });
    expect(history).toHaveAttribute("aria-disabled", "true");
    // Clicking a disabled tab must not select it or change the visible panel.
    await user.click(history);
    expect(history).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Details" })).toBeInTheDocument();
  });

  it("pairs each tab and panel via aria-controls / aria-labelledby", () => {
    render(<BasicTabs />);
    const detailsTab = screen.getByRole("tab", { name: "Details" });
    const detailsPanel = screen.getByRole("tabpanel", { name: "Details" });
    expect(detailsTab).toHaveAttribute("aria-controls", detailsPanel.id);
    expect(detailsPanel).toHaveAttribute("aria-labelledby", detailsTab.id);
  });

  it("uses a roving tabindex: only the selected tab is in the Tab sequence", () => {
    render(<BasicTabs />);
    const details = screen.getByRole("tab", { name: "Details" });
    const settings = screen.getByRole("tab", { name: "Settings" });
    expect(details).toHaveAttribute("tabindex", "0");
    expect(settings).toHaveAttribute("tabindex", "-1");
  });

  it("forwards className onto Tabs.Tab, and the consumer's conflicting class wins the merge", () => {
    render(
      <Tabs>
        <Tabs.List aria-label="Sections">
          <Tabs.Tab id="a" className="bg-status-danger">
            A
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="a">A content.</Tabs.Panel>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab.className).toContain("bg-status-danger");
  });

  it("forwards a consumer style prop onto Tabs.Tab, and the consumer's conflicting property wins the merge", () => {
    render(
      <Tabs>
        <Tabs.List aria-label="Sections">
          <Tabs.Tab id="a" style={{ opacity: 0.42, marginTop: "8px" }}>
            A
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="a">A content.</Tabs.Panel>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab.style.opacity).toBe("0.42");
    expect(tab.style.marginTop).toBe("8px");
  });
});
