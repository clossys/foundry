import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createIcon } from "./createIcon.js";

// A tiny synthetic icon (not one of the 32 shipped icons) — exercising
// `createIcon` directly, the way a consumer's own extension would, rather
// than only ever exercising it indirectly through the shipped icons.
const SquareIcon = createIcon("SquareIcon", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
] as const);

describe("createIcon", () => {
  it("renders an <svg> with the given path data as children", () => {
    render(<SquareIcon decorative />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    const rect = svg?.querySelector("rect");
    expect(rect).toHaveAttribute("x", "3");
    expect(rect).toHaveAttribute("width", "18");
  });

  it("strokes with currentColor and fills with none — never a hardcoded color", () => {
    render(<SquareIcon decorative />);
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("sizes via a token CSS variable, never a raw pixel value, and defaults to md", () => {
    render(<SquareIcon decorative />);
    const svg = document.querySelector("svg");
    expect(svg?.style.width).toBe("var(--spacing-xl, 24px)");
    expect(svg?.style.height).toBe("var(--spacing-xl, 24px)");
  });

  it("maps size=sm and size=lg to their own distinct spacing tokens", () => {
    const { rerender } = render(<SquareIcon decorative size="sm" />);
    let svg = document.querySelector("svg");
    expect(svg?.style.width).toBe("var(--spacing-lg, 16px)");

    rerender(<SquareIcon decorative size="lg" />);
    svg = document.querySelector("svg");
    expect(svg?.style.width).toBe("var(--spacing-2xl, 32px)");
  });

  it("is decorative (aria-hidden, no accessible name) when decorative is true", () => {
    render(<SquareIcon decorative />);
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-label");
  });

  it("carries an accessible name (role=img + aria-label) when label is given", () => {
    render(<SquareIcon label="A square" />);
    const svg = screen.getByRole("img", { name: "A square" });
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("forwards a ref to the underlying <svg>", () => {
    let node: SVGSVGElement | null = null;
    render(
      <SquareIcon
        decorative
        ref={(el) => {
          node = el;
        }}
      />,
    );
    expect(node).not.toBeNull();
    expect((node as unknown as SVGSVGElement)?.tagName).toBe("svg");
  });

  it("forwards className and other rest props onto the <svg>", () => {
    render(<SquareIcon decorative className="my-icon" data-testid="probe" />);
    const svg = screen.getByTestId("probe");
    expect(svg).toHaveClass("my-icon");
  });

  it("sets a stable displayName from the name passed to createIcon", () => {
    expect(SquareIcon.displayName).toBe("SquareIcon");
  });

  it("shrinks to 0 in a flex layout by default (an icon never grows to fill space)", () => {
    render(<SquareIcon decorative />);
    const svg = document.querySelector("svg");
    expect(svg?.style.flexShrink).toBe("0");
  });
});
