import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import * as atoms from "./index.js";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE } from "../shell/badge-plate.js";

type Props = {
  src: string;
  size: "sm" | "md" | "lg";
  tone?: "auto" | "inverse";
  plate?: "shared" | "self";
  title?: string;
};
// Resolve the addition through the existing public namespace so RED measures
// the missing contract without creating an unresolved source import.
const Logomark = (atoms as unknown as { Logomark: ComponentType<Props> }).Logomark;
const sizes = ["sm", "md", "lg"] as const;
const heights = { sm: 24, md: 36, lg: 48 };

describe("Logomark: decorative glyph and plate", () => {
  it("is exported as a public atom", () => {
    expect(Logomark).toBeTypeOf("function");
  });

  it.each(sizes)("uses the imported geometry and height binding at %s", size => {
    const { container } = render(<Logomark src="/glyph.svg" size={size} plate="shared" />);
    const image = container.querySelector("img")!;
    const plate = image.parentElement!;
    const height = `var(--ui-brandmark-height-${size}, ${heights[size]}px)`;
    expect(plate.style.height).toBe(height);
    expect(plate.style.width).toBe(height);
    expect(plate.style.borderRadius).toBe(`calc(${height} * ${BADGE_RADIUS_SHARE})`);
    expect(image.style.height).toBe(`calc(${height} * ${1 - 2 * BADGE_INSET_SHARE})`);
    expect(image.style.width).toBe(image.style.height);
    expect(image.style.objectFit).toBe("contain");
    expect(plate).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("src", "/glyph.svg");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(sizes)("keeps a self-plated image's natural width at %s", size => {
    const { container } = render(<Logomark src="/self.svg" size={size} plate="self" />);
    const image = container.querySelector("img")!;
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(image);
    expect(image.style.height).toContain(`--ui-brandmark-height-${size}`);
    expect(image.style.width).toBe("auto");
    expect(image).toHaveAttribute("alt", "");
  });

  it("keeps the optional title separate from the decorative accessible name", () => {
    const { container } = render(<Logomark src="/glyph.svg" size="md" title="Decorative identity" />);
    expect(container.querySelector("[title]")).toHaveAttribute("title", "Decorative identity");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(["auto", "inverse"] as const)("uses caller-selected artwork unchanged for %s", tone => {
    const { container } = render(<Logomark src="/caller-mono.svg" size="md" tone={tone} plate="shared" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/caller-mono.svg");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("svg, script, a, button")).toHaveLength(0);
  });

  it("cannot turn a supplied markup string or forced children into DOM", () => {
    const payload = '<svg onload="alert(1)"><script>bad()</script></svg>';
    const forced = { src: payload, size: "md", children: <script>bad()</script>, dangerouslySetInnerHTML: { __html: payload } } as unknown as Props;
    const { container } = render(<Logomark {...forced} />);
    expect(container.querySelector("svg, script")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", payload);
    const html = renderToStaticMarkup(<Logomark {...forced} />);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<script");
  });

  it("owns no copied plate shares or composed atom", () => {
    const source = readFileSync(join(import.meta.dirname, "Logomark.tsx"), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*BADGE_RADIUS_SHARE[^}]*\}\s*from/);
    expect(source).toMatch(/import\s*\{[^}]*BADGE_INSET_SHARE[^}]*\}\s*from/);
    expect(source).not.toMatch(/\b0\.18\b|\b7\s*\/\s*32\b|\b0\.21875\b|\b0\.64\b/);
    expect(source).not.toMatch(/<\s*[A-Z]\w*\b/);
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
