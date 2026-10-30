import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionFrame } from "./SectionFrame.js";

describe("SectionFrame transparent ground", () => {
  it("paints no surface and sets no ink, so the band takes both from where it sits", () => {
    const { container } = render(<div className="bg-surface-inverse text-ink-on-inverse"><SectionFrame ground="transparent">Content</SectionFrame></div>);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).not.toMatch(/\bbg-/);
    expect(section.className).not.toMatch(/\btext-ink-/);
    expect(section).toHaveClass("py-lg");
  });

  it("differs from the base ground, which keeps the base ink", () => {
    const base = renderToStaticMarkup(<SectionFrame ground="base">Content</SectionFrame>);
    expect(base).toBe(renderToStaticMarkup(<SectionFrame>Content</SectionFrame>));
    expect(base).toContain("text-ink-primary");
    expect(renderToStaticMarkup(<SectionFrame ground="transparent">Content</SectionFrame>)).not.toBe(base);
  });
});
