import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCompiledCss } from "./generate.js";

const stylesDir = resolve(import.meta.dirname, "..", "..", "styles");

describe("generateCompiledCss", () => {
  it("produces a real Tailwind compile scoped to the requested candidates", async () => {
    const result = await generateCompiledCss({
      stylesDir,
      candidates: ["bg-accent", "text-ink-on-accent", "rounded-control", "px-md", "hover:bg-accent-hover"],
    });
    expect(result.css).toContain(".bg-accent {");
    expect(result.css).toContain("background-color: var(--color-accent, oklch(0.4748 0 0));");
    expect(result.css).toContain(".rounded-control {");
    expect(result.css).toContain("hover\\:bg-accent-hover");
    expect(result.classCount).toBeGreaterThan(0);
    expect(result.byteSize).toBe(Buffer.byteLength(result.css, "utf8"));
  });

  it("wraps every generated utility in the foundry-ui-compiled named layer", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent", "px-md"] });
    expect(result.css).toContain("@layer foundry-ui-compiled {");
  });

  it("never emits Tailwind's preflight (universal box-sizing/margin reset)", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent", "border", "flex"] });
    expect(result.css).not.toContain("box-sizing: border-box");
    expect(result.css).not.toMatch(/\*,\s*::after,\s*::before/);
  });

  it("never emits the redundant, unlayered :root, :host theme-reflection block", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent"] });
    expect(result.css).not.toContain(":root, :host {");
  });

  it("never re-declares tokens.css's own content (no dev-mode badge, no sentinel)", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent"] });
    expect(result.css).not.toContain("No brand binding");
    expect(result.css).not.toContain("--ui-tokens-loaded");
  });

  it("is harmless when given non-Tailwind candidates mixed in (over-inclusive input, precise output)", async () => {
    const result = await generateCompiledCss({
      stylesDir,
      candidates: ["bg-accent", "this", "share", "totally-not-a-real-utility-name"],
    });
    expect(result.css).toContain(".bg-accent {");
    expect(result.css).not.toContain(".this {");
    expect(result.css).not.toContain(".share {");
  });

  it("includes a generated-file header warning against hand-editing", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent"] });
    expect(result.css).toContain("GENERATED FILE");
    expect(result.css).toContain("do not hand-edit");
  });

  it("carries a live var() reference (not a baked-in literal) so brand overrides are picked up", async () => {
    const result = await generateCompiledCss({ stylesDir, candidates: ["bg-accent"] });
    // The declaration must read the custom property, with the token's own
    // default as fallback — never a bare literal that could never respond
    // to a later :root[data-brand-bound] override.
    expect(result.css).toMatch(/background-color:\s*var\(--color-accent,\s*oklch\(0\.4748 0 0\)\);/);
  });
});
