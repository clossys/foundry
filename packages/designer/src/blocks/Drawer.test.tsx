import { act, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../atoms/Button.js";
import * as blocks from "./index.js";

const Drawer = (blocks as any).Drawer ?? (() => null);
const supplied = { heading: "Workspace tools", closeLabel: "Close tools", trigger: <Button>Open tools</Button> };
let wide: { matches: boolean; listeners: Set<(event: { matches: boolean }) => void> };

beforeEach(() => {
  wide = { matches: false, listeners: new Set() };
  vi.stubGlobal("matchMedia", vi.fn((media: string) => {
    const state = media === "(min-width: 768px)" ? wide : { matches: false, listeners: new Set() };
    return { media, get matches() { return state.matches; }, onchange: null,
      addEventListener: (_: string, callback: any) => state.listeners.add(callback),
      removeEventListener: (_: string, callback: any) => state.listeners.delete(callback),
      addListener: (callback: any) => state.listeners.add(callback),
      removeListener: (callback: any) => state.listeners.delete(callback), dispatchEvent: () => true };
  }));
});
afterEach(() => vi.unstubAllGlobals());

function heldHost() {
  const changed = vi.fn();
  function Held({ navigationKey = "first" }: { navigationKey?: string }) {
    const [requested, setRequested] = useState(false);
    return <Drawer {...supplied} isOpen={requested} navigationKey={navigationKey} onOpenChange={(next: boolean) => { changed(next); if (next) setRequested(true); }}><a href="#destination">Destination</a></Drawer>;
  }
  return { Held, changed };
}

describe("Drawer", () => {
  it.each(["Enter", " "])("gives the default close control a native-chrome-free 44px presentation and keyboard focus on %s", async key => {
    render(<Drawer {...supplied}>Content</Drawer>);
    const trigger = screen.getByRole("button", { name: "Open tools" });
    await userEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "Close tools" });
    expect(close).toHaveClass("icon-control-md", "border-0", "bg-transparent", "p-0", "focus-visible:outline-solid", "focus-visible:outline-2", "focus-visible:outline-accent");
    expect(close).toHaveAccessibleName("Close tools");
    const glyph = close.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(close).not.toHaveTextContent("×");
    expect(close.textContent?.trim()).toBe("");
    await userEvent.tab();
    expect(close).toHaveFocus();
    expect(close.style.boxShadow).toContain("--ui-ring-focus");
    await userEvent.keyboard(key === "Enter" ? "{Enter}" : " ");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps closed content absent and outside the tab order", () => {
    expect((blocks as any).Drawer).toBeTypeOf("function");
    render(<Drawer {...supplied}><button>Inside drawer</button></Drawer>);
    expect(screen.queryByText("Inside drawer")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["start", "end", "bottom"])("composes a named Panel at the %s edge without adding animation", async placement => {
    render(<Drawer {...supplied} placement={placement} footer="Footer">Content</Drawer>);
    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    const dialog = await screen.findByRole("dialog", { name: "Workspace tools" });
    const panel = dialog.querySelector("[data-panel]")!;
    expect(panel).toHaveAttribute("data-drawer-placement", placement);
    expect(panel.querySelector('[data-panel-region="footer"]')).toHaveTextContent("Footer");
    expect(dialog.parentElement?.style.width).toBe(placement === "bottom" ? "100%" : "var(--ui-layout-drawer-w, min(20rem, 85vw))");
    if (placement === "bottom") {
      expect(dialog.parentElement?.style.height).toBe("85vh");
      expect(dialog.parentElement?.style.maxHeight).toBe("85vh");
      expect(dialog.className).toContain("max-h-[85vh]");
      expect(panel.querySelector('[data-panel-region="content"]')?.className).toContain("overflow-auto");
    }
    expect(dialog.parentElement?.className).not.toMatch(/transition|animate|forced-color-adjust-none/);
  });

  it("retains logical start placement in an RTL document", async () => {
    const previous = document.documentElement.dir;
    document.documentElement.dir = "rtl";
    try {
      render(<Drawer {...supplied} placement="start">Content</Drawer>);
      await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog.parentElement?.parentElement?.className).toContain("justify-start");
      expect(dialog.parentElement?.parentElement?.className).not.toMatch(/(?:^| )left-|(?:^| )right-/);
    } finally { document.documentElement.dir = previous; }
  });

  it.each(["Escape", "outside", "close"])("actually dismisses on %s while the controlled host retains open=true", async how => {
    const { Held, changed } = heldHost();
    render(<Held />);
    const trigger = screen.getByRole("button", { name: "Open tools" });
    const overflow = document.documentElement.style.overflow;
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.documentElement.style.overflow).toBe("hidden");
    if (how === "Escape") await userEvent.keyboard("{Escape}");
    else if (how === "close") await userEvent.click(screen.getByRole("button", { name: "Close tools" }));
    else await userEvent.click(dialog.parentElement!.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.documentElement.style.overflow).toBe(overflow);
    expect(changed).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it.each(["route", "breakpoint"])("releases the overlay, lock and focus on %s change with a held controlled value", async reason => {
    const { Held } = heldHost();
    const view = render(<Held />);
    const trigger = screen.getByRole("button", { name: "Open tools" });
    const overflow = document.documentElement.style.overflow;
    await userEvent.click(trigger);
    await screen.findByRole("dialog");
    expect(document.documentElement.style.overflow).toBe("hidden");
    if (reason === "route") view.rerender(<Held navigationKey="second" />);
    else await act(async () => { wide.matches = true; for (const notify of wide.listeners) notify({ matches: true }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.documentElement.style.overflow).toBe(overflow);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("releases scroll lock and breakpoint listeners on unmount", async () => {
    const view = render(<Drawer {...supplied}>Content</Drawer>);
    const overflow = document.documentElement.style.overflow;
    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    await screen.findByRole("dialog");
    expect(wide.listeners.size).toBeGreaterThan(0);
    view.unmount();
    expect(document.documentElement.style.overflow).toBe(overflow);
    expect(wide.listeners.size).toBe(0);
  });

  it("does not retain a trigger request made while the wide query matches", async () => {
    wide.matches = true;
    const changed = vi.fn();
    render(<Drawer {...supplied} onOpenChange={changed}>Content</Drawer>);
    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    expect(changed).not.toHaveBeenCalledWith(true);
    await act(async () => { wide.matches = false; for (const notify of wide.listeners) notify({ matches: false }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not arm a late controlled request while already wide or loop a held callback", async () => {
    wide.matches = true;
    const changed = vi.fn();
    const view = render(<Drawer {...supplied} isOpen={false} onOpenChange={changed}>Content</Drawer>);
    view.rerender(<Drawer {...supplied} isOpen onOpenChange={changed}>Content</Drawer>);
    view.rerender(<Drawer {...supplied} isOpen onOpenChange={changed}>Content</Drawer>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { wide.matches = false; for (const notify of wide.listeners) notify({ matches: false }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalledWith(true);
    expect(changed).toHaveBeenCalledTimes(1);
    view.rerender(<Drawer {...supplied} isOpen={false} onOpenChange={changed}>Content</Drawer>);
    view.rerender(<Drawer {...supplied} isOpen onOpenChange={changed}>Content</Drawer>);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes on in-panel navigation and allows an explicit trigger reopen after local dismissal", async () => {
    const { Held } = heldHost();
    render(<Held />);
    const trigger = screen.getByRole("button", { name: "Open tools" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("link", { name: "Destination" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens as a sheet while the wide query matches and keeps focus containment, Escape and focus return", async () => {
    wide.matches = true;
    const changed = vi.fn();
    render(<Drawer {...supplied} wide="sheet" placement="end" onOpenChange={changed}><button>First tool</button><button>Last tool</button></Drawer>);
    const trigger = screen.getByRole("button", { name: "Open tools" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Workspace tools" });
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(dialog.querySelector("[data-panel]")).toHaveAttribute("data-drawer-wide", "sheet");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let index = 0; index < 4; index += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(dialog.parentElement?.className).not.toMatch(/transition|animate/);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(changed).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps an open sheet across a breakpoint change into the wide layout without a media listener", async () => {
    function SheetHost() {
      const [open, setOpen] = useState(false);
      return <Drawer {...supplied} wide="sheet" isOpen={open} onOpenChange={setOpen}>Content</Drawer>;
    }
    render(<SheetHost />);
    expect(wide.listeners.size).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Open tools" }));
    await screen.findByRole("dialog");
    await act(async () => { wide.matches = true; for (const notify of wide.listeners) notify({ matches: true }); });
    expect(screen.getByRole("dialog", { name: "Workspace tools" })).toBeInTheDocument();
  });

  it("honours a controlled sheet request made while wide and still dismisses on route change", async () => {
    wide.matches = true;
    const changed = vi.fn();
    const view = render(<Drawer {...supplied} wide="sheet" isOpen navigationKey="first" onOpenChange={changed}>Content</Drawer>);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    view.rerender(<Drawer {...supplied} wide="sheet" isOpen navigationKey="second" onOpenChange={changed}>Content</Drawer>);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it("returns to wide-layout dismissal when the host switches the sheet back to the default", async () => {
    wide.matches = true;
    const view = render(<Drawer {...supplied} wide="sheet" defaultOpen>Content</Drawer>);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    view.rerender(<Drawer {...supplied} wide="dismiss" defaultOpen>Content</Drawer>);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(wide.listeners.size).toBeGreaterThan(0);
  });

  it("renders and hydrates its closed trigger without a recoverable mismatch", async () => {
    const tree = <Drawer {...supplied}>Content</Drawer>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recover }); });
    expect(container.querySelector("button")).toHaveTextContent("Open tools");
    expect(recover).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    container.remove();
  });
});
