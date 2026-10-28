import { act, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/Dialog.js";
import { Button } from "../components/Button.js";
import { X } from "../icons/X.js";
import * as blocks from "./index.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";




const CommandMenu = withShellCopy((blocks as any).CommandMenu ?? (() => null));
const useCommandMenuShortcut = (blocks as any).useCommandMenuShortcut ?? (() => {});
const alpha = vi.fn();
const bravo = vi.fn();
const gamma = vi.fn();
const disabled = vi.fn();
const groups = [
  { id: "manage", label: "Manage", items: [
    { id: "alpha", label: "Alpha", onAction: alpha },
    { id: "disabled", label: "Unavailable", onAction: disabled, disabled: true },
    { id: "bravo", label: "Bravo", description: "Open drafts", shortcutHint: "B", icon: X, onAction: bravo },
  ] },
  { id: "more", label: "More", items: [{ id: "gamma", label: "Gamma", onAction: gamma }] },
];
const copy = { heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No matching commands" };

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function Host({ items = groups, query: initialQuery = "", filter, shortcut = false, dir, resultCountMessage }: any = {}) {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  useCommandMenuShortcut({ onOpen: () => setOpen(true), enabled: shortcut });
  return <>
    <button onClick={() => setOpen(true)}>Open commands</button><button>Outside</button>
    <CommandMenu {...copy} groups={items} isOpen={isOpen} onOpenChange={setOpen}
      query={query} onQueryChange={setQuery} filter={filter} dir={dir} resultCountMessage={resultCountMessage} />
  </>;
}
async function open(props = {}) {
  const view = render(<Host {...props} />);
  const opener = screen.getByRole("button", { name: "Open commands" });
  await userEvent.click(opener);
  const input = await screen.findByRole("combobox", { name: "Search commands" });
  return { ...view, input, opener };
}
function modKey(extra: KeyboardEventInit = {}) {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true, ...extra });
  act(() => { window.dispatchEvent(event); });
  return event;
}

describe("CommandMenu", () => {
  it("exports the real Material and opt-in shortcut helper", () => {
    expect((blocks as any).CommandMenu).toBeTypeOf("function");
    expect((blocks as any).useCommandMenuShortcut).toBeTypeOf("function");
  });

  it("renders nothing while closed and installs no shortcut without host opt-in", () => {
    const view = render(<CommandMenu {...copy} groups={groups} isOpen={false} onOpenChange={vi.fn()} query="" onQueryChange={vi.fn()} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(modKey().defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses search, traps both Tab directions and returns to the external opener on Escape with a query", async () => {
    const { input, opener } = await open();
    const dialog = screen.getByRole("dialog", { name: "Commands" });
    await waitFor(() => expect(input).toHaveFocus());
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      await userEvent.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.click(input);
    await userEvent.type(input, "draft");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(opener).toHaveFocus();
  });

  it("puts the combobox relationships on the actual input and announces the visible count", async () => {
    const { input } = await open();
    expect(input.tagName).toBe("INPUT");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(screen.queryByText(copy.emptyMessage)).not.toBeInTheDocument();
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveAccessibleName("Alpha");
    expect(screen.getByRole("status")).toHaveTextContent(/^4 results$/);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await userEvent.type(input, "BRAV");
    expect(screen.getByRole("status")).toHaveTextContent(/^1 results$/);
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveAccessibleName("Bravo");
  });

  it("uses the host result-count message for localized filtered and empty announcements", async () => {
    const resultCountMessage = vi.fn((count: number) => `Correspondances : ${count}`);
    const { input } = await open({ resultCountMessage });
    expect(screen.getByRole("status")).toHaveTextContent(/^Correspondances : 4$/);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await userEvent.type(input, "brav");
    expect(screen.getByRole("status")).toHaveTextContent(/^Correspondances : 1$/);
    await userEvent.clear(input);
    await userEvent.type(input, "no match");
    expect(screen.getByRole("status")).toHaveTextContent(/^Correspondances : 0$/);
    expect(resultCountMessage).toHaveBeenLastCalledWith(0);
  });

  it("preserves unique group-label associations alongside host item IDs", async () => {
    await open({ items: [
      { id: "option-alpha", label: "Manage", items: [{ id: "0", label: "Alpha", onAction: alpha }] },
      { id: "0", label: "More", items: [{ id: "option-alpha", label: "Bravo", onAction: bravo }] },
    ] });
    for (const label of ["Manage", "More"]) {
      const group = screen.getByRole("group", { name: label });
      const heading = document.getElementById(group.getAttribute("aria-labelledby")!);
      expect(group).toContainElement(heading);
      expect(heading).toHaveTextContent(label);
    }
    const ids = Array.from(screen.getByRole("listbox").querySelectorAll("[id]"), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("wraps arrows across groups, skips disabled items and activates the current result", async () => {
    const { input } = await open();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveAccessibleName("Bravo");
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("aria-selected", option.id === input.getAttribute("aria-activedescendant") ? "true" : "false");
    }
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveAccessibleName("Gamma");
    await userEvent.keyboard("{Enter}");
    expect(gamma).toHaveBeenCalledOnce();
    expect(alpha).not.toHaveBeenCalled();
    expect(bravo).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter after filtering runs the filtered item rather than the original first item", async () => {
    const { input } = await open();
    await userEvent.type(input, "brav");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(bravo).toHaveBeenCalledOnce();
    expect(alpha).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps composing Enter in search and Enter on close from running a command", async () => {
    const { input } = await open();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(alpha).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    screen.getByRole("button", { name: copy.closeLabel }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(alpha).not.toHaveBeenCalled();
  });

  it("reveals the active row without moving search focus, including filtering with a stable active ID", async () => {
    const { input } = await open();
    const revealAlpha = vi.fn();
    const revealBravo = vi.fn();
    Object.defineProperty(screen.getByRole("option", { name: "Alpha" }), "scrollIntoView", { value: revealAlpha, configurable: true });
    Object.defineProperty(screen.getByRole("option", { name: "Bravo" }), "scrollIntoView", { value: revealBravo, configurable: true });
    await userEvent.keyboard("{ArrowDown}");
    expect(revealBravo).toHaveBeenCalled();
    expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(revealAlpha).toHaveBeenCalled();
    revealAlpha.mockClear();
    await userEvent.type(input, "al");
    expect(revealAlpha).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest", behavior: "instant" }));
    expect(input).toHaveFocus();
  });

  it("supports host filtering and renders supplied descriptions and shortcut hints", async () => {
    await open({ query: "drafts", filter: (item: any, query: string) => item.description?.includes(query) });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Bravo" })).toHaveTextContent("Open drafts");
    expect(screen.getByRole("option", { name: "Bravo" })).toHaveTextContent("B");
  });

  it("never activates disabled options by pointer or Enter, and pointer activation closes", async () => {
    const { input } = await open();
    const unavailable = screen.getByRole("option", { name: "Unavailable" });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(unavailable);
    expect(disabled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.type(input, "Unavailable");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    await userEvent.keyboard("{Enter}");
    expect(disabled).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("option", { name: "Bravo" }));
    expect(bravo).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["pointer", "Enter"])("preserves the supplied native href on %s activation", async how => {
    const { input } = await open({ items: [{ id: "links", label: "Links", items: [{ id: "destination", label: "Destination", href: "#command-target" }] }] });
    const destination = screen.getByRole("option", { name: "Destination" });
    expect(destination.tagName).toBe("A");
    expect(destination).toHaveAttribute("href", "#command-target");
    const click = vi.fn();
    destination.addEventListener("click", click);
    if (how === "Enter") { await userEvent.click(input); await userEvent.keyboard("{Enter}"); }
    else await userEvent.click(destination);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows only the host empty-results message without an invented option", async () => {
    await open({ items: [] });
    expect(screen.getByText("No matching commands")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("0");
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close commands" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses logical layout in RTL and adds no motion or forced-color suppression", async () => {
    await open({ dir: "rtl" });
    const content = screen.getByRole("listbox").closest('[dir="rtl"]')!;
    expect(content).toBeInTheDocument();
    expect(content.className).not.toMatch(/animate-|transition-/);
    expect(content.outerHTML).not.toMatch(/forced-color-adjust-none|\b(?:left|right)-/);
    for (const node of content.querySelectorAll("[class]")) {
      const classes = node.getAttribute("class") ?? "";
      if (classes.includes("transition-")) expect(classes).toContain("motion-reduce:transition-none");
    }
    expect(screen.getByRole("option", { name: "Alpha" }).className).toContain("forced-colors:border-current");
  });

  it.each(["MacIntel", "Linux x86_64"])("handles only platform Mod+K on %s, ignores its own modal, then reopens after Escape", async platform => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    render(<Host shortcut />);
    const opener = screen.getByRole("button", { name: "Open commands" });
    opener.focus();
    expect(modKey().defaultPrevented).toBe(true);
    await screen.findByRole("combobox");
    expect(modKey().defaultPrevented).toBe(false);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(modKey().defaultPrevented).toBe(true);
    await screen.findByRole("combobox");
  });

  it("does not open over another existing modal", async () => {
    render(<><Host shortcut /><Dialog trigger={<Button>Other modal</Button>}><Dialog.Heading>Other</Dialog.Heading><Button>Stay here</Button></Dialog></>);
    await userEvent.click(screen.getByRole("button", { name: "Other modal" }));
    await screen.findByRole("dialog", { name: "Other" });
    expect(modKey().defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Commands" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("cleans up its listener and preserves defaults for nonhandled keys and disabled opt-in", () => {
    const onOpen = vi.fn();
    function Shortcut({ enabled = true }) { useCommandMenuShortcut({ onOpen, enabled }); return null; }
    const view = render(<Shortcut />);
    for (const extra of [{ key: "x" }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }, { ctrlKey: false, metaKey: false }, { ctrlKey: true, metaKey: true }]) {
      expect(modKey(extra).defaultPrevented).toBe(false);
    }
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const prevented = new KeyboardEvent("keydown", { key: "k", ctrlKey: !apple, metaKey: apple, cancelable: true });
    prevented.preventDefault();
    fireEvent(window, prevented);
    expect(onOpen).not.toHaveBeenCalled();
    expect(modKey().defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    onOpen.mockClear();
    view.rerender(<Shortcut enabled={false} />);
    expect(modKey().defaultPrevented).toBe(false);
    view.unmount();
    expect(modKey().defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes its enabled listener immediately on unmount", () => {
    const onOpen = vi.fn();
    function Shortcut() { useCommandMenuShortcut({ onOpen }); return null; }
    const view = render(<Shortcut />);
    expect(modKey().defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    onOpen.mockClear();
    view.unmount();
    expect(modKey().defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores autofill keydown events whose key is undefined without throwing or opening", () => {
    const onOpen = vi.fn(), errors: unknown[] = [];
    function Shortcut() { useCommandMenuShortcut({ onOpen }); return null; }
    const view = render(<Shortcut />);
    const capture = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener("error", capture);
    try {
      const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const event = new KeyboardEvent("keydown", { ctrlKey: !apple, metaKey: apple, cancelable: true });
      Object.defineProperty(event, "key", { value: undefined });
      expect(() => act(() => { window.dispatchEvent(event); })).not.toThrow();
      expect(errors).toEqual([]);
      expect(onOpen).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally { window.removeEventListener("error", capture); view.unmount(); }
  });

  it.each(["dialog", "alertdialog", "native-open"])("declines a visible %s surface", role => {
    const onOpen = vi.fn();
    function Shortcut() { useCommandMenuShortcut({ onOpen }); return null; }
    render(<Shortcut />);
    const modal = document.createElement(role === "native-open" ? "dialog" : "div");
    if (role === "native-open") modal.setAttribute("open", "");
    else modal.setAttribute("role", role);
    document.body.append(modal);
    try { expect(modKey().defaultPrevented).toBe(false); expect(onOpen).not.toHaveBeenCalled(); }
    finally { modal.remove(); }
  });

  it.each(["native-closed", "hidden", "aria-hidden", "display-none"])("does not let a %s surface block the opted-in shortcut", hidden => {
    const onOpen = vi.fn();
    function Shortcut() { useCommandMenuShortcut({ onOpen }); return null; }
    render(<Shortcut />);
    const wrapper = document.createElement("div");
    const modal = document.createElement(hidden === "native-closed" ? "dialog" : "div");
    modal.setAttribute("role", "dialog");
    if (hidden === "hidden") wrapper.hidden = true;
    if (hidden === "aria-hidden") wrapper.setAttribute("aria-hidden", "true");
    if (hidden === "display-none") wrapper.style.display = "none";
    wrapper.append(modal);
    document.body.append(wrapper);
    try { expect(modKey().defaultPrevented).toBe(true); expect(onOpen).toHaveBeenCalledOnce(); }
    finally { wrapper.remove(); }
  });
});

describe("CommandMenu visual pass (VF-1 shell-12/13)", () => {
  it("marks the active option with the accent tint and an inline-start accent edge, never an underline", async () => {
    const { input } = await open();
    await userEvent.keyboard("{ArrowDown}");
    const active = screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")!;
    expect(active).toHaveClass("bg-accent-tint", "border-s-accent", "no-underline");
    expect(active).not.toHaveClass("underline");
    const rest = screen.getAllByRole("option").filter((option) => option !== active);
    for (const option of rest) expect(option).toHaveClass("border-s-transparent", "no-underline");
    expect(input).toHaveClass("outline-hidden");
  });

  it("draws the search field's token ring whenever it holds focus, not only on keyboard focus", async () => {
    const { input } = await open();
    expect(input).toHaveFocus();
    expect(input.style.boxShadow).toContain("--color-accent");
  });
});
