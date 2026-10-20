import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as blocks from "./index.js";
import { contrastRatio } from "../tokens/color.js";
import { TOKENS } from "../tokens/tokens.js";

const ResizablePane = (blocks as any).ResizablePane ?? (() => null);
const props = { min: 100, max: 300, defaultValue: 180, step: 20, label: "Tools", handleLabel: "Resize tools" };

describe("ResizablePane", () => {
  it("uses the on-inverse focus outline against its inverse raised Panel", () => {
    const { rerender } = render(<ResizablePane {...props} ground="inverse">Content</ResizablePane>);
    expect(screen.getByRole("region", { name: "Tools" })).toHaveClass("bg-surface-inverse-raised");
    expect(screen.getByRole("separator")).toHaveClass("focus-visible:outline-accent-on-inverse");
    rerender(<ResizablePane {...props} ground="base">Content</ResizablePane>);
    expect(screen.getByRole("separator")).not.toHaveClass("focus-visible:outline-accent-on-inverse");
    expect(screen.getByRole("separator")).toHaveClass("focus-visible:outline-accent");
  });

  it("ships the inverse focus utility with a passing neutral-token contrast", () => {
    // Source/compiled CSS and analytical token proof, not browser painting or brand qualification.
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    const selector = String.raw`.focus-visible\:outline-accent-on-inverse:focus-visible`;
    const ordinary = String.raw`.focus-visible\:outline-accent:focus-visible`;
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(css.indexOf(ordinary));
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain(`outline-color: var(--color-accent-on-inverse, ${TOKENS["--color-accent-on-inverse"]!.value})`);
    const ground = TOKENS["--color-surface-inverse-raised"]!.value;
    expect(contrastRatio(TOKENS["--color-accent"]!.value, ground)).toBeLessThan(3);
    expect(contrastRatio(TOKENS["--color-accent-on-inverse"]!.value, ground)).toBeGreaterThanOrEqual(3);
  });

  it("composes a real Panel and named handle with uncontrolled bounded state", async () => {
    expect((blocks as any).ResizablePane).toBeTypeOf("function");
    const changed = vi.fn();
    render(<ResizablePane {...props} onChange={changed}>Content</ResizablePane>);
    const panel = screen.getByRole("region", { name: "Tools" });
    const handle = screen.getByRole("separator", { name: "Resize tools" });
    expect(panel).toHaveAttribute("data-panel");
    expect(handle).toHaveAttribute("aria-controls", panel.id);
    expect(panel.style.inlineSize).toBe("180px");
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(panel.style.inlineSize).toBe("200px");
    expect(changed).toHaveBeenLastCalledWith(200);
    await userEvent.keyboard("{Enter}");
    expect(panel.style.inlineSize).toBe("180px");
  });

  it("respects controlled values, clamps supplied dimensions and resets to the default", async () => {
    const changed = vi.fn();
    const { rerender } = render(<ResizablePane {...props} value={500} onChange={changed}>Content</ResizablePane>);
    const panel = screen.getByRole("region", { name: "Tools" });
    expect(panel.style.inlineSize).toBe("300px");
    const handle = screen.getByRole("separator");
    handle.focus();
    await userEvent.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith(180);
    expect(panel.style.inlineSize).toBe("300px");
    rerender(<ResizablePane {...props} value={160} onChange={changed}>Content</ResizablePane>);
    expect(panel.style.inlineSize).toBe("160px");
  });

  it("round-trips a host-owned width through keyboard and pointer changes", async () => {
    const reported: number[] = [];
    function Host() {
      const [width, setWidth] = useState(240);
      return <ResizablePane {...props} defaultValue={180} value={width} onChange={(next: number) => { reported.push(next); setWidth(next); }}>Content</ResizablePane>;
    }
    render(<Host />);
    const panel = screen.getByRole("region", { name: "Tools" });
    const handle = screen.getByRole("separator", { name: "Resize tools" });
    expect(panel.style.inlineSize).toBe("240px");
    expect(handle).toHaveAttribute("aria-valuenow", "240");
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(panel.style.inlineSize).toBe("220px");
    expect(handle).toHaveAttribute("aria-valuenow", "220");
    await userEvent.keyboard("{Home}");
    expect(panel.style.inlineSize).toBe("100px");
    await userEvent.keyboard("{Enter}");
    expect(panel.style.inlineSize).toBe("180px");
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 90 });
    expect(panel.style.inlineSize).toBe("220px");
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(panel.style.inlineSize).toBe("180px");
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 50 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 500 });
    expect(panel.style.inlineSize).toBe("300px");
    expect(reported).toEqual([220, 100, 180, 220, 180, 300]);
    vi.unstubAllGlobals();
  });

  it("keeps a controlled value fixed when the host declines a change", async () => {
    const changed = vi.fn();
    render(<ResizablePane {...props} value={200} onChange={changed}>Content</ResizablePane>);
    const panel = screen.getByRole("region", { name: "Tools" });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(changed.mock.calls).toEqual([[220], [220]]);
    expect(panel.style.inlineSize).toBe("200px");
  });

  it("resizes a horizontal separator on the block axis without consulting storage", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unexpected storage read"); });
    try {
      render(<ResizablePane {...props} orientation="horizontal">Content</ResizablePane>);
      const panel = screen.getByRole("region", { name: "Tools" });
      expect(panel.style.blockSize).toBe("180px");
      screen.getByRole("separator").focus();
      await userEvent.keyboard("{End}");
      expect(panel.style.blockSize).toBe("300px");
      expect(read).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });

  it("renders and hydrates uncontrolled state without a recoverable mismatch", async () => {
    const tree = <ResizablePane {...props}>Content</ResizablePane>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recover }); });
    expect(container.querySelector("[role=separator]")).toHaveAttribute("aria-valuenow", "180");
    expect(recover).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    container.remove();
  });
});

describe("ResizablePane start edge", () => {
  it("keeps default end markup and focus order identical to explicit end", () => {
    const view = render(<ResizablePane {...props}>Content</ResizablePane>);
    const original = view.container.innerHTML;
    view.rerender(<ResizablePane {...props} handleEdge="end">Content</ResizablePane>);
    expect(view.container.innerHTML).toBe(original);
    const panel = screen.getByRole("region", { name: "Tools" });
    const handle = screen.getByRole("separator");
    expect(panel.querySelector('[data-panel-region="content"]')!.textContent).toContain("Content");
    expect(handle.compareDocumentPosition(screen.getByText("Content")) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0);
  });

  it.each(["ltr", "rtl"].flatMap(dir => ["vertical", "horizontal"].map(orientation => ({ dir, orientation }))))(
    "places the start handle before content and reports actual $orientation size in $dir", async ({ dir, orientation }) => {
      function Host() {
        const [size, setSize] = useState(180);
        return <div dir={dir}><ResizablePane {...props} orientation={orientation} handleEdge="start" value={size} onChange={setSize}>
          <input aria-label="Inspector data" defaultValue="Retained" />
        </ResizablePane></div>;
      }
      render(<Host />);
      const panel = screen.getByRole("region", { name: "Tools" });
      const handle = screen.getByRole("separator", { name: "Resize tools" });
      const input = screen.getByRole("textbox");
      expect(handle.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(handle).toHaveAttribute("aria-controls", panel.id);
      expect(handle).toHaveAttribute("tabindex", "0");
      const size = () => orientation === "vertical" ? panel.style.inlineSize : panel.style.blockSize;
      expect(size()).toBe("180px");
      handle.focus();
      const grow = orientation === "horizontal" ? "ArrowUp" : dir === "ltr" ? "ArrowLeft" : "ArrowRight";
      await userEvent.keyboard(`{${grow}}`);
      expect(size()).toBe("200px");
      expect(handle).toHaveAttribute("aria-valuenow", "200");
      await userEvent.keyboard("{Home}");
      expect(size()).toBe("100px");
      await userEvent.keyboard("{End}");
      expect(size()).toBe("300px");
      await userEvent.keyboard("{Enter}");
      expect(size()).toBe("180px");
      class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
      }
      vi.stubGlobal("PointerEvent", TestPointerEvent);
      const capture = vi.fn(), release = vi.fn();
      Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release, hasPointerCapture: () => true });
      const leading = orientation === "horizontal" || dir === "ltr" ? -1 : 1;
      const coordinates = (offset: number) => orientation === "vertical" ? { clientX: 100 + offset } : { clientY: 100 + offset };
      fireEvent.pointerDown(handle, { pointerId: 3, button: 0, ...coordinates(0) });
      fireEvent.pointerMove(handle, { pointerId: 3, ...coordinates(leading * 40) });
      expect(size()).toBe("220px");
      expect(handle).toHaveAttribute("aria-valuenow", "220");
      fireEvent.pointerMove(handle, { pointerId: 3, ...coordinates(leading * 1000) });
      expect(size()).toBe("300px");
      fireEvent.pointerMove(handle, { pointerId: 3, ...coordinates(-leading * 1000) });
      expect(size()).toBe("100px");
      fireEvent.keyDown(handle, { key: "Escape" });
      expect(size()).toBe("180px");
      expect(capture).toHaveBeenCalledWith(3);
      expect(release).toHaveBeenCalledWith(3);
      expect(input).toHaveValue("Retained");
    },
  );

  it("does not overwrite a controlled size when the host declines a start-edge change", async () => {
    const changed = vi.fn();
    render(<ResizablePane {...props} handleEdge="start" value={200} onChange={changed}>Content</ResizablePane>);
    const handle = screen.getByRole("separator");
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(changed).toHaveBeenLastCalledWith(220);
    expect(screen.getByRole("region").style.inlineSize).toBe("200px");
    expect(handle).toHaveAttribute("aria-valuenow", "200");
  });
});
