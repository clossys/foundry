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
