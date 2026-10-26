import { act, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as components from "./index.js";

const ResizeHandle = (components as any).ResizeHandle ?? (() => null);
const bounds = { min: 50, max: 200, resetValue: 100, label: "Resize panel" };

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options);
      this.pointerId = options.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => vi.unstubAllGlobals());

function setup(extra: Record<string, unknown> = {}) {
  const changed = vi.fn();
  function Controlled() {
    const [value, setValue] = useState(100);
    return <ResizeHandle {...bounds} value={value} step={10} {...extra} onChange={(next: number) => { changed(next); setValue(next); }} />;
  }
  render(<Controlled />);
  const handle = screen.getByRole("separator", { name: "Resize panel" });
  const capture = vi.fn(), release = vi.fn();
  Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release, hasPointerCapture: () => true });
  return { handle, changed, capture, release };
}

describe("ResizeHandle", () => {
  it("exports a named interactive Component", () => expect((components as any).ResizeHandle).toBeTypeOf("function"));

  it("names a focusable separator with its axis, bounded values and a 44px token target", () => {
    const { handle } = setup({ "aria-controls": "panel" });
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    expect(handle).toHaveAttribute("aria-valuemin", "50");
    expect(handle).toHaveAttribute("aria-valuemax", "200");
    expect(handle).toHaveAttribute("aria-controls", "panel");
    expect(handle.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
    expect(handle.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
  });

  it.each(["ltr", "rtl"])("steps, bounds and resets with a vertical separator in %s", async dir => {
    const { handle } = setup({ dir });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", dir === "rtl" ? "90" : "110");
    await userEvent.keyboard("{End}");
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    await userEvent.keyboard("{Home}");
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    await userEvent.keyboard("{Enter}");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
  });

  it("uses vertical arrows for a horizontal separator without reversing them in RTL", async () => {
    const { handle } = setup({ orientation: "horizontal", dir: "rtl" });
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(handle).toHaveAttribute("aria-valuenow", "110");
    await userEvent.keyboard("{ArrowUp}");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
  });

  it.each(["ltr", "rtl"])("captures, clamps and commits pointer movement in %s", dir => {
    const { handle, capture, release } = setup({ dir });
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 100, button: 0 });
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 120 });
    expect(handle).toHaveAttribute("aria-valuenow", dir === "rtl" ? "80" : "120");
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 1000 });
    expect(handle).toHaveAttribute("aria-valuenow", dir === "rtl" ? "50" : "200");
    fireEvent.pointerUp(handle, { pointerId: 7 });
    expect(release).toHaveBeenCalledWith(7);
  });

  it("uses pointer Y for horizontal separators without RTL reversal", () => {
    const { handle } = setup({ orientation: "horizontal", dir: "rtl" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000, clientY: 10, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 3000, clientY: 40 });
    expect(handle).toHaveAttribute("aria-valuenow", "130");
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it.each(["pointerCancel", "lostPointerCapture", "Escape"])("restores drag start on %s", cancellation => {
    const { handle, changed } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    expect(handle).toHaveAttribute("aria-valuenow", "170");
    if (cancellation === "Escape") fireEvent.keyDown(handle, { key: "Escape" });
    else (fireEvent as any)[cancellation](handle, { pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    expect(changed).toHaveBeenLastCalledWith(100);
  });

  it("inherits RTL from its ancestor and ignores a second pointer during a drag", async () => {
    const changed = vi.fn();
    render(<div dir="rtl"><ResizeHandle {...bounds} value={100} onChange={changed} /></div>);
    const handle = screen.getByRole("separator");
    Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(changed).toHaveBeenLastCalledWith(99);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 500, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 600 });
    expect(changed).toHaveBeenLastCalledWith(99);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120 });
    expect(changed).toHaveBeenLastCalledWith(80);
  });

  it("clamps supplied values and rejects non-finite or invalid numeric contracts", () => {
    const { unmount } = render(<ResizeHandle {...bounds} value={500} onChange={vi.fn()} />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "200");
    unmount();
    for (const bad of [{ min: 201 }, { value: NaN }, { max: Infinity }, { resetValue: NaN }, { step: 0 }, { label: null }]) {
      expect(() => render(<ResizeHandle {...bounds} value={100} onChange={vi.fn()} {...bad} />)).toThrow(/ResizeHandle:/);
    }
  });

  it("keeps the visible resize edge token-bound and preserves native forced-color adjustment", () => {
    const { handle } = setup();
    const edge = handle.querySelector("span")!;
    expect(edge.style.borderWidth).toBe("var(--ui-border-hairline, 1px)");
    expect(edge.className).toContain("self-stretch");
    expect(handle.className).not.toMatch(/transition|animate|forced-color-adjust-none/);
  });

  it("keeps native focus-visible styling available when pointer focus becomes keyboard input", () => {
    const { handle } = setup();
    vi.spyOn(handle, "matches").mockReturnValue(false);
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    // jsdom does not implement browser input-modality painting; pin the native CSS contract.
    expect(handle).toHaveClass("focus-visible:outline-solid", "focus-visible:outline-2", "focus-visible:outline-accent");
    expect(handle).not.toHaveClass("outline-none");
    expect(handle.style.boxShadow).toBe("");
  });

  it("renders and hydrates its semantics without a recoverable mismatch", async () => {
    const tree = <ResizeHandle {...bounds} value={100} onChange={vi.fn()} />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recover }); });
    expect(container.querySelector("[role=separator]")).toHaveAttribute("aria-valuenow", "100");
    expect(recover).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    container.remove();
  });
});

describe("ResizeHandle start edge", () => {
  it("keeps the default end edge DOM identical to explicit end", () => {
    const changed = vi.fn();
    const view = render(<ResizeHandle {...bounds} value={100} onChange={changed} />);
    const original = view.container.innerHTML;
    view.rerender(<ResizeHandle {...bounds} value={100} onChange={changed} edge="end" />);
    expect(view.container.innerHTML).toBe(original);
  });

  it.each(["ltr", "rtl"])("tracks leading-edge pointer and keyboard growth, bounds and reset in %s", async dir => {
    const { handle, capture, release } = setup({ edge: "start", dir });
    const leading = dir === "ltr" ? -1 : 1;
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 100, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100 + leading * 40 });
    expect(handle).toHaveAttribute("aria-valuenow", "140");
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100 + leading * 1000 });
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100 - leading * 1000 });
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerUp(handle, { pointerId: 9 });
    expect(capture).toHaveBeenCalledWith(9);
    expect(release).toHaveBeenCalledWith(9);
    handle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(dir === "ltr" ? "{ArrowLeft}" : "{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "110");
    await userEvent.keyboard(dir === "ltr" ? "{ArrowRight}" : "{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    await userEvent.keyboard("{Home}");
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    await userEvent.keyboard("{End}");
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    await userEvent.keyboard("{Enter}");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
  });

  it.each(["ltr", "rtl"].flatMap(dir => ["Escape", "pointerCancel", "lostPointerCapture"].map(cancel => ({ dir, cancel }))))(
    "cancels a leading-edge drag on $cancel in $dir", ({ dir, cancel }) => {
      const { handle, release } = setup({ edge: "start", dir });
      fireEvent.pointerDown(handle, { pointerId: 4, clientX: 100, button: 0 });
      fireEvent.pointerMove(handle, { pointerId: 4, clientX: dir === "ltr" ? 60 : 140 });
      expect(handle).toHaveAttribute("aria-valuenow", "140");
      if (cancel === "Escape") fireEvent.keyDown(handle, { key: "Escape" });
      else if (cancel === "pointerCancel") fireEvent.pointerCancel(handle, { pointerId: 4 });
      else fireEvent.lostPointerCapture(handle, { pointerId: 4 });
      expect(handle).toHaveAttribute("aria-valuenow", "100");
      expect(release).toHaveBeenCalledWith(4);
    },
  );

  it.each(["ltr", "rtl"])("resizes from the block start without RTL reversal in %s", async dir => {
    const { handle } = setup({ edge: "start", orientation: "horizontal", dir });
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 60 });
    expect(handle).toHaveAttribute("aria-valuenow", "140");
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: -1000 });
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 1000 });
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(handle).toHaveAttribute("aria-valuenow", "110");
    await userEvent.keyboard("{ArrowDown}");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("rejects an unsupported handle edge", () => {
    expect(() => render(<ResizeHandle {...bounds} value={100} edge="middle" onChange={vi.fn()} />)).toThrow(TypeError);
  });
});
