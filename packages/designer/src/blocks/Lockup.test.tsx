import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as blocks from "./index.js";

type Props = {
  src: string;
  wordmark: string;
  size: "sm" | "md" | "lg";
  tone?: "auto" | "inverse";
  plate?: "shared" | "self";
  clearSpace?: boolean;
  className?: string;
};
const Lockup = (blocks as unknown as { Lockup: ComponentType<Props> }).Lockup;
const sizes = ["sm", "md", "lg"] as const;
const heights = { sm: 24, md: 36, lg: 48 };
const gaps = { sm: 4, md: 6, lg: 8 };

describe("Lockup: mark and live wordmark regions", () => {
  it("is exported as a public block", () => {
    expect(Lockup).toBeTypeOf("function");
  });

  it.each(sizes)("puts the mark before vertically centered live text at %s", size => {
    const { container } = render(<Lockup src="/glyph.svg" wordmark="Example Studio" size={size} />);
    const root = container.firstElementChild as HTMLElement;
    const image = root.querySelector("img")!;
    const wordmark = screen.getByText("Example Studio");
    expect(image.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wordmark.tagName).toBe("SPAN");
    expect(wordmark).toHaveClass("font-display", "leading-none");
    expect(root).toHaveClass("inline-flex", "items-center");
    expect(root.style.gap).toBe(`var(--ui-brandmark-gap-${size}, ${gaps[size]}px)`);
    expect(image.style.height).toBe(`var(--ui-brandmark-height-${size}, ${heights[size]}px)`);
    expect(wordmark.style.fontSize).toContain(`--ui-brandmark-height-${size}`);
    expect(image).toHaveAttribute("alt", "");
    expect(root.textContent).toBe("Example Studio");
  });

  it.each(sizes)("enforces optional clear space equal to 0.2 times the mark height at %s", size => {
    const { container, rerender } = render(<Lockup src="/glyph.svg" wordmark="Example" size={size} clearSpace />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.padding).toBe(`calc(var(--ui-brandmark-height-${size}, ${heights[size]}px) * 0.2)`);
    rerender(<Lockup src="/glyph.svg" wordmark="Example" size={size} />);
    expect(root.style.padding).toBe("");
  });

  it.each(["auto", "inverse"] as const)("keeps the wordmark outside the plate and paints %s ink", tone => {
    const { container } = render(<Lockup src="/glyph.svg" wordmark="Example" size="md" plate="shared" tone={tone} />);
    const root = container.firstElementChild as HTMLElement;
    const image = root.querySelector("img")!;
    const wordmark = screen.getByText("Example");
    expect(image.parentElement).not.toContainElement(wordmark);
    expect(root).toHaveClass(tone === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("renders authored wordmark markup as text", () => {
    const wordmark = "<svg><script>bad()</script></svg>";
    const { container } = render(<Lockup src="/glyph.svg" wordmark={wordmark} size="md" />);
    expect(container.querySelector("svg, script")).toBeNull();
    expect(container.textContent).toBe(wordmark);
  });

  it("retains layout and ink when a consumer adds a class", () => {
    const { container } = render(<Lockup src="/glyph.svg" wordmark="Example" size="md" className="consumer-class" />);
    expect(container.firstElementChild).toHaveClass("inline-flex", "items-center", "text-ink-primary", "consumer-class");
  });

  it("composes Logomark through the permitted block-to-atom direction", () => {
    const source = readFileSync(join(import.meta.dirname, "Lockup.tsx"), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*Logomark[^}]*\}\s*from\s*["']\.\.\/atoms\//);
    expect(source).toMatch(/<Logomark\b/);
    expect(source).not.toMatch(/(?:import|export)[^;]*["'][^"']*\/shell\//);
  });
});
