import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabsContext } from "react-aria-components";
import { Tabs, type TabsProps } from "./Tabs.js";

function BasicTabs(props: Partial<TabsProps> = {}) {
  return (
    <Tabs {...props}>
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
  it("inherits vertical orientation from the native provider when the prop is omitted", () => {
    render(<TabsContext.Provider value={{ orientation: "vertical" }}><BasicTabs /></TabsContext.Provider>);
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    expect(list.parentElement).toHaveClass("flex-row");
    expect(list).toHaveClass("flex-col", "border-s");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveClass("border-s-2");
  });

  it("keeps the default horizontal list, bottom indicator and root classes", () => {
    render(<BasicTabs />);
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("aria-orientation", "horizontal");
    expect(list.parentElement?.className).toBe("flex flex-col gap-md");
    expect(list.className).toBe("flex gap-xs border-b border-line-base");
    expect(screen.getByRole("tab", { name: "Details" }).className).toBe(
      "cursor-default border-b-2 px-md py-sm text-body-s font-body outline-none transition-colors motion-reduce:transition-none disabled:cursor-not-allowed border-accent text-ink-primary",
    );
  });

  it.each(["ltr", "rtl"])("uses a column and start-edge indicators vertically in %s, with native keyboard navigation", async (dir) => {
    const user = userEvent.setup();
    const { rerender } = render(<div dir={dir}><BasicTabs orientation="vertical" /></div>);
    const list = screen.getByRole("tablist");
    const details = screen.getByRole("tab", { name: "Details" });
    const settings = screen.getByRole("tab", { name: "Settings" });
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    expect(list.parentElement).toHaveClass("flex-row");
    expect(list).toHaveClass("flex-col", "border-s", "border-line-base");
    expect(list).not.toHaveClass("border-b");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass("border-s-2");
      expect(tab).not.toHaveClass("border-b-2");
    }
    expect(details).toHaveClass("border-accent", "text-ink-primary");
    expect(settings).toHaveClass("border-transparent");
    details.focus();
    await user.keyboard("{ArrowDown}");
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute("aria-selected", "true");
    expect(settings).toHaveClass("border-accent");
    await user.keyboard("{ArrowUp}");
    expect(details).toHaveFocus();
    rerender(<div dir={dir}><BasicTabs orientation="horizontal" /></div>);
    expect(list).toHaveAttribute("aria-orientation", "horizontal");
    expect(list.className).toBe("flex gap-xs border-b border-line-base");
    expect(details).toHaveClass("border-b-2");
    expect(details).not.toHaveClass("border-s-2");
  });

  it.each([
    ["sm", "px-sm py-xs text-caption"],
    ["md", "px-md py-sm text-body-s"],
    ["lg", "px-lg py-md text-body"],
  ] as const)("size=%s sets every tab's padding and type step", (size, classes) => {
    render(<BasicTabs size={size} />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass(...classes.split(" "));
    }
    const others = ["px-sm py-xs text-caption", "px-md py-sm text-body-s", "px-lg py-md text-body"].filter(set => set !== classes);
    for (const set of others) for (const cls of set.split(" ")) if (!classes.split(" ").includes(cls)) {
      expect(screen.getByRole("tab", { name: "Details" })).not.toHaveClass(cls);
    }
  });

  it("keeps size independent of orientation and keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<BasicTabs size="lg" orientation="vertical" />);
    const details = screen.getByRole("tab", { name: "Details" });
    const settings = screen.getByRole("tab", { name: "Settings" });
    expect(details).toHaveClass("border-s-2", "px-lg", "py-md", "text-body");
    expect(screen.getByRole("tablist")).not.toHaveAttribute("size");
    details.focus();
    await user.keyboard("{ArrowDown}");
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute("aria-selected", "true");
  });

  it("lets a consumer class override the size padding", () => {
    render(
      <Tabs size="sm">
        <Tabs.List aria-label="Sections">
          <Tabs.Tab id="a" className="px-lg">A</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="a">A content.</Tabs.Panel>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab).toHaveClass("px-lg", "py-xs", "text-caption");
    expect(tab).not.toHaveClass("px-sm");
  });

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
