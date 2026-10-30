// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticContent } from "../components/index.js";
import { PageFrame, type PageFrameProps } from "./PageFrame.js";

afterEach(cleanup);

function fixture(): PageFrameProps {
  return {
    manifest: {
      id: "project",
      breadcrumbs: [{ id: "root", label: "Projects", href: "/projects" }, { id: "current", label: "Planning" }],
      actions: [
        { id: "show-notes", label: "Show notes", icon: <SemanticContent as="span">N</SemanticContent>, module: { sectionId: "notes", label: "Notes", children: <p>Notes body</p> } },
        { id: "show-history", label: "Show history", icon: <SemanticContent as="span">H</SemanticContent>, module: { sectionId: "history", label: "History", children: <p>History body</p> } },
      ],
    },
    breadcrumbLabel: "Page trail", actionsLabel: "Page sections", modulesLabel: "Open page sections",
    children: <p>Page stage</p>,
  };
}

it("renders only the manifest breadcrumb and icon actions in its header", () => {
  const { container } = render(<PageFrame {...fixture()} />);
  const header = container.querySelector<HTMLElement>("[data-page-frame-header]")!;
  expect(within(header).getByRole("navigation", { name: "Page trail" })).toBeInTheDocument();
  expect(within(header).getByText("Planning")).toHaveAttribute("aria-current", "page");
  expect(within(header).getAllByRole("button")).toHaveLength(2);
  for (const label of ["Show notes", "Show history"]) {
    const button = within(header).getByRole("button", { name: label });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.textContent).not.toContain(label);
  }
  expect(within(header).queryByRole("heading")).toBeNull();
  expect(within(header).queryByRole("tab")).toBeNull();
  expect(screen.getByRole("main")).toHaveTextContent("Page stage");
  expect(container.querySelector("[data-page-frame-modules]")).toBeNull();
});

it("opens manifest modules in one column and closes only the action's own section", async () => {
  const user = userEvent.setup(), onOpenModuleIdsChange = vi.fn();
  const { container } = render(<PageFrame {...fixture()} onOpenModuleIdsChange={onOpenModuleIdsChange} />);
  const notes = screen.getByRole("button", { name: "Show notes" }), history = screen.getByRole("button", { name: "Show history" });
  await user.click(notes);
  expect(notes).toHaveAttribute("aria-pressed", "true");
  expect(document.getElementById(notes.getAttribute("aria-controls")!)).toHaveTextContent("Notes body");
  await user.click(history);
  expect(container.querySelectorAll("[data-page-frame-modules]")).toHaveLength(1);
  const column = screen.getByRole("complementary", { name: "Open page sections" });
  expect(column).toHaveTextContent("Notes body");
  expect(column).toHaveTextContent("History body");
  expect(screen.getByRole("main").parentElement).toBe(column.parentElement);
  await user.click(notes);
  expect(screen.queryByText("Notes body")).toBeNull();
  expect(history).toHaveAttribute("aria-pressed", "true");
  expect(onOpenModuleIdsChange).toHaveBeenLastCalledWith(["history"]);
  await user.click(history);
  expect(container.querySelector("[data-page-frame-modules]")).toBeNull();
});

it("collapses each module body independently while keeping both actions pressed", async () => {
  const user = userEvent.setup();
  render(<PageFrame {...fixture()} defaultOpenModuleIds={["notes", "history"]} />);
  await user.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Show notes" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Show history" })).toHaveAttribute("aria-pressed", "true");
});

it("uses the manifest as the only action list and drops stale modules after navigation", async () => {
  const user = userEvent.setup(), props = fixture();
  const { rerender } = render(<PageFrame {...props} navigationKey="first" />);
  await user.click(screen.getByRole("button", { name: "Show notes" }));
  rerender(<PageFrame {...props} navigationKey="second" manifest={{ ...props.manifest, actions: [props.manifest.actions[1]!] }} />);
  expect(screen.queryByRole("button", { name: "Show notes" })).toBeNull();
  expect(screen.getByRole("button", { name: "Show history" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("reports controlled module changes without changing host-owned state", async () => {
  const user = userEvent.setup(), onOpenModuleIdsChange = vi.fn();
  render(<PageFrame {...fixture()} openModuleIds={["notes"]} onOpenModuleIdsChange={onOpenModuleIdsChange} />);
  await user.click(screen.getByRole("button", { name: "Show history" }));
  expect(onOpenModuleIdsChange).toHaveBeenCalledWith(["notes", "history"]);
  expect(screen.getByRole("button", { name: "Show history" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByText("History body")).toBeNull();
});

it("takes initial section visibility from the producer manifest's defaultOpen flags", () => {
  const props = fixture();
  props.manifest = { ...props.manifest, actions: props.manifest.actions.map((action, index) => ({ ...action, defaultOpen: index === 1 })) };
  render(<PageFrame {...props} />);
  expect(screen.getByRole("button", { name: "Show notes" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Show history" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("History body")).toBeInTheDocument();
  expect(screen.queryByText("Notes body")).toBeNull();
});

it("bridges breadcrumb navigation to the host route port", async () => {
  const user = userEvent.setup(), onNavigate = vi.fn();
  render(<PageFrame {...fixture()} onNavigate={onNavigate} />);
  await user.click(screen.getByRole("link", { name: "Projects" }));
  expect(onNavigate).toHaveBeenCalledWith("/projects");
});

it("rejects actions that share a module slot", () => {
  const props = fixture();
  props.manifest = { ...props.manifest, actions: props.manifest.actions.map(action => ({ ...action, module: { ...action.module, sectionId: "shared" } })) };
  expect(() => render(<PageFrame {...props} />)).toThrow(/unique, nonempty manifest identifiers/);
});
