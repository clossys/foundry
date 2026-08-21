import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCompiledCss } from "./generate.js";

const stylesDir = resolve(import.meta.dirname, "..", "..", "styles");

describe("generateCompiledCss's #182 tailwindcss peer-version guard", () => {
  afterEach(() => {
    vi.doUnmock("../internal/resolve-installed-peer-version.js");
    vi.resetModules();
  });

  it("stays silent when the real, installed tailwindcss satisfies the declared range (present, in range)", async () => {
    await expect(generateCompiledCss({ stylesDir, candidates: ["bg-accent"] })).resolves.toBeDefined();
  });

  it("throws naming tailwindcss when it cannot be resolved at all (absent), before ever attempting the real compile", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => undefined,
    }));
    const { generateCompiledCss: generateWithMock } = await import("./generate.js");
    await expect(generateWithMock({ stylesDir, candidates: ["bg-accent"] })).rejects.toThrow(
      /tailwindcss is required for this import but is not installed/,
    );
  });

  it("throws a distinctly-worded error when tailwindcss is installed but out of range", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => "3.4.0",
    }));
    const { generateCompiledCss: generateWithMock } = await import("./generate.js");
    await expect(generateWithMock({ stylesDir, candidates: ["bg-accent"] })).rejects.toThrow(
      /tailwindcss@3\.4\.0 is installed, but this package requires tailwindcss@"\^4\.0\.0"/,
    );
  });

  // Updated for #389: assertPeerVersion no longer throws when it merely
  // cannot PARSE an installed version (e.g. a prerelease identifier) —
  // that is now indeterminate, reported via a single console.warn, and
  // the real compile proceeds. See ../internal/peer-version.ts's header.
  it("warns and proceeds, rather than rejecting, when the installed version cannot be parsed (unresolvable)", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => "4.0.0-alpha.1",
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { generateCompiledCss: generateWithMock } = await import("./generate.js");
      await expect(generateWithMock({ stylesDir, candidates: ["bg-accent"] })).resolves.toBeDefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/prerelease identifier/);
    } finally {
      warn.mockRestore();
    }
  });
});

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
