import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens/tokens.js";

const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const css = readFileSync(join(styles, "theme-keys.css"), "utf8");
const tabletMedia = `@media (width >= ${TOKENS["--breakpoint-tablet"]!.value})`;

function block(text: string, opening: string): string {
  const start = text.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${opening}`);
}

describe("nav disclosure utilities", () => {
  it("below tablet only an expanded panel shows as a sheet under the header", () => {
    const panel = block(css, "@utility nav-disclosure-panel {");
    const mobile = panel.slice(0, panel.indexOf("@media"));
    expect(mobile).toContain("display: none;");
    expect(mobile).toContain("position: absolute;");
    expect(mobile).toContain("inset-block-start: 100%;");
    expect(mobile).toContain("inset-inline: 0;");
    expect(mobile).toMatch(/&\[data-expanded\] \{\s*display: flex;/);
  });

  it("from tablet the panel is an inline row and the toggle hides", () => {
    const panel = block(css, "@utility nav-disclosure-panel {");
    const toggle = block(css, "@utility nav-disclosure-toggle {");
    const desktop = block(panel, tabletMedia);
    expect(desktop).toContain("display: flex;");
    expect(desktop).toContain("position: static;");
    expect(desktop).toContain("flex-direction: row;");
    expect(block(toggle, tabletMedia)).toContain("display: none;");
  });

  it("under scripting none the panel shows inline and the toggle hides", () => {
    const panel = block(css, "@utility nav-disclosure-panel {");
    const toggle = block(css, "@utility nav-disclosure-toggle {");
    const fallback = block(panel, "@media (scripting: none)");
    expect(fallback).toContain("display: flex;");
    expect(fallback).toContain("position: static;");
    expect(fallback).toContain("flex-direction: row;");
    expect(block(toggle, "@media (scripting: none)")).toContain("display: none;");
  });

  it("uses tokens only and no transition or animation", () => {
    const panel = block(css, "@utility nav-disclosure-panel {");
    const toggle = block(css, "@utility nav-disclosure-toggle {");
    expect(panel).toContain("var(--color-overlay-surface,");
    expect(panel).toContain("var(--color-ink-primary,");
    expect(panel).toContain("var(--color-overlay-border,");
    expect(panel).toContain("var(--ui-width-page-padding-x,");
    expect(panel).toContain("var(--spacing-md,");
    expect(panel + toggle).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|(?:transition|animation|duration|delay)[\w-]*\s*:/i);
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    expect(compiled).toContain(".nav-disclosure-panel");
    expect(compiled).toContain(".nav-disclosure-toggle");
    expect(compiled).toContain("@media (scripting: none)");
  });

  it("the compiled toggle's hiding rules outrank its inline-flex button look", () => {
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    for (const media of [tabletMedia, "@media (scripting: none)"]) {
      // A same-element attribute raises specificity above .inline-flex,
      // which Tailwind places later than this custom display utility.
      const rules = [...compiled.matchAll(new RegExp(`${media.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`, "g"))]
        .map(match => block(compiled.slice(match.index), media));
      const toggle = rules.find(rule => rule.includes(".nav-disclosure-toggle"));
      expect(toggle, media).toBeDefined();
      expect(toggle).toMatch(/\.nav-disclosure-toggle\[aria-expanded\]\s*\{\s*display: none;/);
    }
  });
});

describe("header motion and content geometry", () => {
  it("animates actual bars and default-label pseudo bars with reversible token transforms", () => {
    const bars = block(css, "@utility nav-disclosure-icon {");
    const header = block(css, "@utility site-header-contract {");
    for (const text of [bars, header]) {
      expect(text).toContain("transition: transform var(--ui-duration-default, 240ms) var(--ease-default, cubic-bezier(.2, 0, 0, 1));");
      expect(text).toContain("rotate(45deg)");
      expect(text).toContain("rotate(-45deg)");
    }
  });
  it("disables both bar transitions under reduced motion", () => {
    for (const opening of ["@utility nav-disclosure-icon {", "@utility site-header-contract {"]) {
      expect(block(block(css, opening), "@media (prefers-reduced-motion: reduce)")).toContain("transition: none;");
    }
  });
  it("stretches mobile panels, lists and rows with inline-start labels", () => {
    const mobile = block(css, "@utility site-header-mobile {");
    expect(mobile).toContain("align-items: stretch;");
    expect(mobile).toContain("inline-size: 100%;");
    expect(mobile).toContain("text-align: start;");
    expect(mobile).toContain("justify-content: start;");
  });
  it("starts the first section background under overlay chrome and clears content inside it", () => {
    const frame = block(css, "[data-frame-root] {");
    expect(frame).not.toMatch(/&:has\(> header\[data-placement="overlay"\]\) \{ padding-block-start:/);
    expect(frame).toContain('> main > section:first-of-type');
    expect(frame).toContain("padding-block-start: var(--site-header-clearance");
    expect(frame).toContain("scroll-margin-block-start: var(--site-header-clearance");
  });
  it("shares square centered menu and primary mobile targets", () => {
    const mobile = block(css, "@utility site-header-mobile {");
    expect(mobile).toContain('.nav-disclosure-toggle, & .site-header-actions > [data-header-primary]');
    expect(mobile).toContain("inline-size: var(--ui-layout-tap-target, 44px);");
    expect(mobile).toContain("block-size: var(--ui-layout-tap-target, 44px);");
    expect(mobile).toContain("justify-content: center;");
  });
  it("uses deliberate current and hover paint without persistent underlines", () => {
    const header = block(css, "@utility site-header-contract {");
    expect(header).not.toContain("text-decoration-line: underline");
    expect(header).toContain('a[aria-current="page"]');
    expect(header).toContain("background-color:");
    expect(header).toContain(":focus-visible");
  });
});

it("propagates absolute section ground to header ink and brand independently of document theme", () => {
  const overlay = block(css, "@utility site-header-overlay {");
  expect(block(overlay, '&[data-section-ground="light"]')).toContain("--site-header-ground-ink: var(--color-neutral-900");
  expect(block(overlay, '&[data-section-ground="dark"]')).toContain("--site-header-ground-ink: var(--color-neutral-50");
  const grounded = block(overlay, "&[data-section-ground] {");
  expect(grounded).toContain("color: var(--site-header-ground-ink, var(--color-neutral-900, oklch(0.2178 0 0)));");
  expect(grounded).toContain(".site-header-brand > a, & .nav-disclosure-toggle { color: inherit; }");
});
