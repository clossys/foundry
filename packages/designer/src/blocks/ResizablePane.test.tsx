import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
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
