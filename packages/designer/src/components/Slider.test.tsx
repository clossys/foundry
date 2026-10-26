import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider.js";

const part = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)];

describe("Slider", () => {
  it("names a single thumb by its label, shows the value and moves with the keyboard", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    render(<Slider label="Volume" defaultValue={40} step={10} onChange={changed} />);
    const thumb = screen.getByRole("slider", { name: "Volume" });
    // Each thumb is a native range input: value, bounds and value text come from the peer.
    expect(thumb).toHaveAttribute("type", "range");
    expect((thumb as HTMLInputElement).value).toBe("40");
    expect(thumb).toHaveAttribute("min", "0");
    expect(thumb).toHaveAttribute("max", "100");
    expect(thumb).toHaveAttribute("aria-valuetext", "40");
    expect(screen.getByRole("status")).toHaveTextContent("40");
    await user.tab();
    expect(thumb).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(changed).toHaveBeenLastCalledWith(50);
    await user.keyboard("{End}");
    expect(changed).toHaveBeenLastCalledWith(100);
    await user.keyboard("{Home}");
    expect(changed).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole("status")).toHaveTextContent("0");
  });

  it("hides the value output on request but keeps the value announced", () => {
    render(<Slider label="Volume" defaultValue={40} showValue={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "40");
  });

  it("renders a range as two distinctly named thumbs with a fill between them", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    const { container } = render(<Slider label="Price" defaultValue={[20, 80]} thumbLabels={["Minimum", "Maximum"]} onChange={changed} />);
    const [low, high] = screen.getAllByRole("slider");
    expect(low).toHaveAccessibleName("Minimum Price");
    expect(high).toHaveAccessibleName("Maximum Price");
    expect(screen.getByRole("status").textContent).toMatch(/20.*80/);
    const [fill] = part(container, "slider-fill");
    expect(fill!.style.insetInlineStart).toBe("20%");
    expect(fill!.style.width).toBe("60%");
    await user.tab();
    expect(low).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(changed).toHaveBeenLastCalledWith([21, 80]);
    await user.tab();
    expect(high).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(changed).toHaveBeenLastCalledWith([21, 79]);
  });

  it("refuses a range without one non-empty thumb label per value", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Slider label="Price" defaultValue={[20, 80]} />)).toThrow(TypeError);
    expect(() => render(<Slider label="Price" defaultValue={[20, 80]} thumbLabels={["Minimum", " "]} />)).toThrow(TypeError);
    expect(() => render(<Slider label="Price" value={[20, 80]} thumbLabels={["Minimum"]} />)).toThrow(TypeError);
    quiet.mockRestore();
  });

  it("lays out vertically with vertical semantics and keys", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    const { container } = render(<Slider label="Level" orientation="vertical" defaultValue={50} onChange={changed} />);
    const thumb = screen.getByRole("slider", { name: "Level" });
    expect(thumb).toHaveAttribute("aria-orientation", "vertical");
    expect(container.firstElementChild).toHaveAttribute("data-orientation", "vertical");
    expect(part(container, "slider-track")[0]).toHaveClass("slider-track-vertical", "tap-target");
    expect(part(container, "slider-rail")[0]).toHaveClass("slider-rail-vertical");
    expect(part(container, "slider-thumb")[0]).toHaveClass("slider-thumb-vertical");
    expect(part(container, "slider-thumb")[0]).not.toHaveClass("top-1/2");
    await user.tab();
    await user.keyboard("{ArrowUp}");
    expect(changed).toHaveBeenLastCalledWith(51);
  });

  it("disables every thumb, ignores keys and dims through the state-opacity utility", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    const { container } = render(<Slider label="Price" isDisabled defaultValue={[20, 80]} thumbLabels={["Minimum", "Maximum"]} onChange={changed} />);
    for (const thumb of screen.getAllByRole("slider")) expect(thumb).toBeDisabled();
    expect(container.firstElementChild).toHaveClass("control-disabled");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(changed).not.toHaveBeenCalled();
  });

  it("is not dimmed while enabled", () => {
    const { container } = render(<Slider label="Volume" defaultValue={10} />);
    expect(container.firstElementChild).not.toHaveClass("control-disabled");
  });

  it("forwards its ref to the root and merges a caller class", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<Slider ref={ref} label="Volume" defaultValue={10} className="mt-md" />);
    expect(ref.current).toBe(container.firstElementChild);
    expect(ref.current).toContainElement(screen.getByRole("slider"));
    expect(ref.current).toHaveClass("mt-md", "flex", "flex-col");
  });

  it("binds every part to named token utilities with no inline style of its own", () => {
    const { container } = render(<Slider label="Volume" defaultValue={30} />);
    const [track] = part(container, "slider-track"), [rail] = part(container, "slider-rail"), [fill] = part(container, "slider-fill"), [thumb] = part(container, "slider-thumb");
    expect(track).toHaveClass("control-h-md", "w-full", "items-center");
    expect(rail).toHaveClass("slider-rail", "rounded-pill", "bg-surface-sunken", "overflow-hidden");
    expect(fill).toHaveClass("bg-action", "rounded-pill");
    expect(thumb).toHaveClass("slider-thumb", "rounded-pill", "border", "border-action", "bg-surface-raised", "focus-ring", "top-1/2", "motion-reduce:transition-none");
    for (const element of [container.firstElementChild as HTMLElement, rail!]) expect(element.getAttribute("style")).toBeNull();
    // The only inline declarations are the peer's own track, fill and thumb geometry.
    const declared = (element: HTMLElement) => Object.keys(element.style).filter(key => /^\d+$/.test(key)).map(key => element.style[Number(key)]).sort();
    expect(declared(track!)).toEqual(["position"]);
    expect(declared(thumb!)).toEqual(["left", "position", "transform"]);
    expect(Object.keys(fill!.style).filter(key => /^\d+$/.test(key)).map(key => fill!.style[Number(key)]).sort()).toEqual(["height", "inset-inline-start", "position", "width"]);
    const classes = [...container.querySelectorAll<HTMLElement>("*")].flatMap(element => [...element.classList]);
    expect(classes.filter(name => name.startsWith("[") || name.startsWith("-") || name.includes("(") || /\[.*\]./.test(name))).toEqual([]);
    expect(classes.some(name => name.startsWith("react-aria-"))).toBe(false);
  });

  it("defines each slider utility as a token read, never a literal", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "theme-keys.css"), "utf8");
    const utility = (name: string) => new RegExp(`@utility ${name} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(utility("control-disabled")).toMatch(/opacity:\s*var\(--ui-alpha-disabled\b/);
    expect(utility("slider-rail")).toMatch(/block-size:\s*var\(--spacing-xs\b/);
    expect(utility("slider-rail-vertical")).toMatch(/inline-size:\s*var\(--spacing-xs\b/);
    expect(utility("slider-track-vertical")).toMatch(/min-block-size:\s*var\(--spacing-6xl\b/);
    // Symmetric centre on the cross axis: it pairs with the peer's physical translate(-50%, -50%), so it holds in either direction.
    expect(utility("slider-thumb-vertical")).toMatch(/^\s*left:\s*50%;\s*$/);
    expect(utility("slider-thumb")).toMatch(/inline-size:\s*var\(--ui-control-mark\b[^;]*;\s*block-size:\s*var\(--ui-control-mark\b/);
  });

  it("marks keyboard focus on the thumb for the shared focus ring", async () => {
    const user = userEvent.setup();
    const { container } = render(<Slider label="Volume" defaultValue={30} />);
    await user.tab();
    expect(part(container, "slider-thumb")[0]).toHaveAttribute("data-focus-visible", "true");
  });
});
