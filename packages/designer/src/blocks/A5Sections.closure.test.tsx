// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StatGroup } from "./StatGroup.js";
import { NoticeList } from "./NoticeList.js";
import { ResourceList } from "./ResourceList.js";
import { AppFrame } from "../frames/AppFrame.js";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";

const stats = [{ id: "users", label: "Active users", value: "2,481" }, { id: "revenue", label: "Revenue", value: "$48.2k" }, { id: "conversion", label: "Conversion", value: "3.4%" }, { id: "churn", label: "Churn", value: "1.1%" }];
const records = [{ id: "record", textValue: "Report", title: "Report", actions: [{ id: "open", label: "Open", onAction() {} }, { id: "copy", label: "Copy", onAction() {} }] }];
const sections = <><StatGroup items={stats} aria-label="Metrics" /><NoticeList label="Notices" notices={[{ id: "ready", message: "Ready to review" }]} /><ResourceList aria-label="Resources" items={records} actionsLabel={name => "Actions for " + name} emptyState={{ title: "No records" }} /></>;
const copy = (children: React.ReactNode) => <ShellCopyProvider resolver={shellCopyFixtureResolver}>{children}</ShellCopyProvider>;

afterEach(() => vi.unstubAllGlobals());

it("F3 applies one content gutter binding across stats, notices and records", () => {
  const { container } = render(copy(sections));
  const roots = [...container.querySelectorAll<HTMLElement>("[data-ds-leaf]")].filter(node => ["sections.stats", "sections.notices", "sections.resource-list"].includes(node.dataset.dsLeaf!));
  expect(roots).toHaveLength(3);
  for (const root of roots) expect(root.style.paddingInline).toBe("var(--spacing-lg)");
});

it("F9 expresses the shared gutter logically in RTL", () => {
  const { container } = render(<div dir="rtl">{copy(sections)}</div>);
  for (const root of container.querySelectorAll<HTMLElement>("[data-ds-leaf]")) {
    expect(root.style.paddingInline).toBe("var(--spacing-lg)");
    expect(root.style.paddingLeft).toBe("");
    expect(root.style.paddingRight).toBe("");
  }
});

it("F4 F5 keeps narrow stats in a compact two-column layout", () => {
  render(<StatGroup items={stats} aria-label="Metrics" />);
  const list = screen.getByRole("list", { name: "Metrics" });
  expect(list).toHaveClass("grid-cols-2");
  expect(list).not.toHaveClass("grid-cols-1");
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
});

it("F7 keeps one borderless trailing action presentation at every breakpoint", () => {
  render(<ResourceList aria-label="Resources" items={records} actionsLabel={name => "Actions for " + name} emptyState={{ title: "No records" }} />);
  for (const name of ["Open", "Copy"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveClass("border-0", "bg-transparent");
    expect(button.closest(".hidden")).toBeNull();
    expect(button.querySelector("svg")).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "Actions for Report" })).toBeNull();
});

it("F10 shows theme before destinations from a visible named footer trigger", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
  render(<AppFrame copyResolver={shellCopyFixtureResolver} brand={{ markSrc: "/mark.svg" }} account={{ signedOutLabel: "Account", sections: [{ id: "destinations", entries: [{ id: "docs", kind: "link", label: "Docs", href: "#docs" }] }] }} navigation={{ tree: [] }} commands={{ triggerLabel: "Commands", heading: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "No commands", groups: [] }}><p>Content</p></AppFrame>);
  const trigger = screen.getByRole("button", { name: "Account" });
  expect(trigger).toBeVisible();
  await userEvent.click(trigger);
  const theme = screen.getByRole("group", { name: "Theme" });
  const docs = screen.getByRole("menuitem", { name: "Docs" });
  expect(theme.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger).toBeVisible();
});
