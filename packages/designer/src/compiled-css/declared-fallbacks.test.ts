import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compiledCssDeclaredSources, generateCompiledCss } from "./generate.js";
import { scanCompiledCssSources } from "./scan-sources.js";
import {
  addDeclaredFallbacks,
  collectCustomPropertyDeclarations,
  declaredTokenValues,
  UndeclaredTokenFallbackError,
} from "./declared-fallbacks.js";

/** A bare read of `name`, the shape Tailwind emits for an arbitrary-value utility. */
const bare = (name: string) => `var(${name})`;

const tokensCss = `
@layer foundry-ui-tokens {
:root {
  --spacing-sm: 8px; /* small */
  --color-ink: oklch(0.2 0 0);
  --color-link: ${bare("--color-ink")};
  --icon: url("data:image/svg+xml;utf8,<svg/>");
}
}
@layer foundry-ui-tokens {
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --color-ink: oklch(0.9 0 0); }
}
}
@layer foundry-ui-tokens {
:root[data-theme="dark"] { --spacing-sm: 99px; }
}
`;
const themeCss = `
:root { --available-height: 100dvh; }
@theme { --spacing: 0.25rem; }
@theme inline { --text-caption: var(--text-caption, 12px); }
`;
const defaultThemeCss = `
:root[data-brand-bound] { --primary: oklch(0.205 0 0); }
@media (prefers-color-scheme: dark) { :root[data-brand-bound]:not([data-theme="light"]) { --primary: oklch(0.922 0 0); } }
:root[data-brand-bound][data-theme="dark"] { --primary: oklch(0.922 0 0); }
:root { --radius-theme: 0.625rem; }
`;
const tailwindThemeCss = `
@theme default { --text-sm: 0.875rem; --spacing: 99rem; --primary: red; }
`;
const sources = { tokensCss, themeCss, defaultThemeCss, tailwindThemeCss };
const bareSources = { tokensCss: "", themeCss: "", defaultThemeCss: "", tailwindThemeCss: "" };

describe("collectCustomPropertyDeclarations", () => {
  it("keeps each declaration's enclosing preludes and never splits inside url() or a string", () => {
    const decls = collectCustomPropertyDeclarations(tokensCss);
    expect(decls.find((d) => d.name === "--icon")?.value).toBe(`url("data:image/svg+xml;utf8,<svg/>")`);
    expect(decls.find((d) => d.name === "--spacing-sm")?.context).toEqual(["@layer foundry-ui-tokens", ":root"]);
  });
});

describe("addDeclaredFallbacks", () => {
  it("takes the plain :root value from tokens.css, never a dark or data-theme variant", () => {
    const out = addDeclaredFallbacks(`.a { padding: ${bare("--spacing-sm")}; color: ${bare("--color-ink")}; }`, sources);
    expect(out).toBe(".a { padding: var(--spacing-sm, 8px); color: var(--color-ink, oklch(0.2 0 0)); }");
  });

  it("expands a bare read inside a declared value, so the fallback has no bare read of its own", () => {
    expect(addDeclaredFallbacks(`.a { color: ${bare("--color-link")}; }`, sources)).toBe(
      ".a { color: var(--color-link, var(--color-ink, oklch(0.2 0 0))); }",
    );
  });

  it("reads theme.css :root and @theme declarations, unwrapping a self-referencing @theme key", () => {
    const out = addDeclaredFallbacks(`.a { max-height: ${bare("--available-height")}; gap: ${bare("--spacing")}; font-size: ${bare("--text-caption")}; }`, sources);
    expect(out).toBe(".a { max-height: var(--available-height, 100dvh); gap: var(--spacing, 0.25rem); font-size: var(--text-caption, 12px); }");
  });

  it("reads a declaration in the same output, first in output order, and rewrites its own bare reads", () => {
    const css = `.c { --card-spacing: ${bare("--spacing-sm")}; } .d { --card-spacing: 3px; } .e { gap: ${bare("--card-spacing")}; }`;
    expect(addDeclaredFallbacks(css, sources)).toBe(
      ".c { --card-spacing: var(--spacing-sm, 8px); } .d { --card-spacing: 3px; } .e { gap: var(--card-spacing, var(--spacing-sm, 8px)); }",
    );
  });

  it("takes the package default theme's light value, never its dark variants", () => {
    const out = addDeclaredFallbacks(`.a { color: ${bare("--primary")}; border-radius: ${bare("--radius-theme")}; }`, sources);
    expect(out).toBe(".a { color: var(--primary, oklch(0.205 0 0)); border-radius: var(--radius-theme, 0.625rem); }");
  });

  it("reads Tailwind's default theme last, so a package declaration of the same name wins", () => {
    const out = addDeclaredFallbacks(`.a { font-size: ${bare("--text-sm")}; gap: ${bare("--spacing")}; }`, sources);
    expect(out).toBe(".a { font-size: var(--text-sm, 0.875rem); gap: var(--spacing, 0.25rem); }");
  });

  it("leaves a read that already carries a fallback alone", () => {
    const css = ".a { padding: var(--spacing-sm, 2px); }";
    expect(addDeclaredFallbacks(css, sources)).toBe(css);
  });

  it("refuses a token with no declared source, naming every one, and invents no default", () => {
    const css = `.a { color: ${bare("--primary")}; background: ${bare("--trigger-width")}; outline-color: ${bare("--ring")}; border-color: ${bare("--color-ink")}; }`;
    let caught: unknown;
    try {
      addDeclaredFallbacks(css, sources);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UndeclaredTokenFallbackError);
    expect((caught as UndeclaredTokenFallbackError).tokens).toEqual(["--ring", "--trigger-width"]);
    expect((caught as Error).message).toMatch(/--ring, --trigger-width/);
  });

  it("refuses a declared value whose bare read has no source, naming the missing token", () => {
    const css = `.a { color: ${bare("--x")}; }`;
    expect(() => addDeclaredFallbacks(css, { ...bareSources, tokensCss: `:root { --x: ${bare("--nowhere")}; }` })).toThrow(/--nowhere/);
  });
});

describe("styles/compiled.css carries declared fallbacks", () => {
  const packageRoot = resolve(import.meta.dirname, "..", "..");
  const stylesDir = resolve(packageRoot, "styles");
  const read = (file: string) => readFileSync(resolve(stylesDir, file), "utf8");

  /** The full `var(...)` text opening at `start`, and its fallback argument (undefined for a bare read). */
  function varAt(css: string, start: number): { text: string; fallback: string | undefined } {
    let depth = 0;
    let comma = -1;
    for (let i = start + 4; i < css.length; i++) {
      const ch = css[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) return { text: css.slice(start, i + 1), fallback: comma === -1 ? undefined : css.slice(comma + 1, i).trim() };
        depth--;
      } else if (ch === "," && depth === 0 && comma === -1) comma = i;
    }
    throw new Error(`unbalanced var( at ${start}`);
  }

  /** `value` with every `var(--y, F)` collapsed to `var(--y)`: the declared text a fallback was expanded from. */
  function collapseFallbacks(value: string): string {
    let out = value;
    for (;;) {
      const next = out.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g, "var($1)");
      if (next === out) return out;
      out = next;
    }
  }

  it("has no bare token read (a var() with no fallback) left anywhere in the file [mutant: skip one family in the injector]", () => {
    const body = read("compiled.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...new Set([...body.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g)].map((m) => m[1]))]).toEqual([]);
  });

  it("gives every read Tailwind emitted bare a fallback equal to the token's declared value, and changes nothing else", async () => {
    const scan = scanCompiledCssSources(packageRoot);
    const raw = (await generateCompiledCss({ stylesDir, candidates: scan.candidates, declaredFallbacks: false })).css;
    const committed = read("compiled.css");
    const declared = declaredTokenValues(compiledCssDeclaredSources(stylesDir), raw);
    const problems: string[] = [];
    let rawAt = 0;
    let delta = 0;
    for (const m of raw.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g)) {
      const name = m[1] as string;
      if (raw.slice(rawAt, m.index) !== committed.slice(rawAt + delta, m.index + delta)) {
        problems.push(`text before ${name} at ${m.index} differs`);
        break;
      }
      const at = m.index + delta;
      if (!committed.startsWith(`var(${name},`, at)) {
        problems.push(`${name} at ${m.index}: no fallback`);
        break;
      }
      const written = varAt(committed, at);
      const value = declared.get(name);
      if (value === undefined || collapseFallbacks(written.fallback ?? "") !== collapseFallbacks(value)) problems.push(`${name}: ${written.fallback} != ${value}`);
      delta += written.text.length - m[0].length;
      rawAt = m.index + m[0].length;
    }
    if (problems.length === 0 && raw.slice(rawAt) !== committed.slice(rawAt + delta)) problems.push("trailing text differs");
    expect(problems).toEqual([]);
  }, 60_000);
});
