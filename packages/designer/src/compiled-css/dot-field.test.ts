import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCompiledCss } from "./generate.js";

describe("compiled dot-field decoration", () => {
  it("ships fixed, reduced-motion, print, SVG scale and an opaque halo with tablet geometry (M-DF1)", async () => {
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: [] });
    const compact = css.replace(/\s+/g, "");
    expect(compact).toContain(".dot-field{position:fixed;");
    expect(compact).toContain("block-size:100lvh;");
    expect(compact).toMatch(/@media\(prefers-reduced-motion:reduce\)\{\.dot-field\{position:absolute;inset:0;block-size:auto;/);
    expect(compact).toMatch(/@mediaprint\{\.dot-field\{display:none;/);
    expect(compact).toContain('data-field-window');
    expect(compact).toContain("transform:scale(var(--ui-field-scale,1))");
    expect(compact).toContain("color:var(--color-field-dot,var(--color-ink-on-inverse,oklch(0.970200)))");
    expect(compact).toContain("opacity:var(--ui-field-alpha,0.34)");
    expect(compact).toMatch(/\.field-halo::before\{[^}]*inset:calc\(var\(--spacing-lg,16px\)\*-1\);[^}]*background:var\(--color-surface-inverse,oklch\(0.217800\)\);/);
    expect(compact).toContain("box-shadow:00var(--spacing-2xl,32px)var(--spacing-lg,16px)var(--color-surface-inverse,oklch(0.217800))");
    expect(compact).toMatch(/@media\(min-width:768px\)\{\.field-halo::before\{box-shadow:00var\(--spacing-4xl,64px\)var\(--spacing-2xl,32px\)var\(--color-surface-inverse,oklch\(0.217800\)\)/);
    expect(compact).not.toMatch(/\.field-halo::before\{[^}]*(?:opacity:|gradient\()/);
  });
  it("supplies canonical defaults for field CSS reads while preserving live inverse aliases", async () => {
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: [] });
    const field = css.slice(css.indexOf(".dot-field {"));
    expect(field).not.toMatch(/var\(\s*--[a-zA-Z0-9_-]+\s*\)/);
    expect(field).toContain("var(--ui-field-alpha, 0.34)");
    expect(field).toContain("var(--ui-field-scale, 1)");
    expect(field).toContain("var(--color-field-dot, var(--color-ink-on-inverse, oklch(0.9702 0 0)))");
    expect(field).toContain("var(--radius-panel, var(--radius-surface, var(--radius-default, 3px)))");
  });

});
