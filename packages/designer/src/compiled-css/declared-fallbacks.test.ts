import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compiledCssDeclaredSources, generateCompiledCss } from "./generate.js";
import { scanCompiledCssSources } from "./scan-sources.js";
import { runtimeSetNames, runtimeSetVariables, scanRuntimeSetters } from "./runtime-setters.js";
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
const sources = { tokensCss, themeCss, defaultThemeCss, tailwindThemeCss, runtimeSetVariables: new Set<string>() };
const bareSources = { tokensCss: "", themeCss: "", defaultThemeCss: "", tailwindThemeCss: "", runtimeSetVariables: new Set<string>() };

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

  it("writes unset for a runtime-only variable: set inline by the package sources and declared nowhere", () => {
    const css = `.a { inline-size: ${bare("--panel-w")}; --tw-x: ${bare("--panel-w")}; }`;
    const runtime = { ...sources, runtimeSetVariables: new Set(["--panel-w"]) };
    expect(addDeclaredFallbacks(css, runtime)).toBe(".a { inline-size: var(--panel-w, unset); --tw-x: var(--panel-w, unset); }");
  });

  it("keeps the declared value for a variable that is both set inline and declared", () => {
    const css = `.a { padding: ${bare("--spacing-sm")}; }`;
    expect(addDeclaredFallbacks(css, { ...sources, runtimeSetVariables: new Set(["--spacing-sm"]) })).toBe(".a { padding: var(--spacing-sm, 8px); }");
  });

  it("refuses a new bare variable with no inline setter and no declaration, naming it [mutant: drop one setter]", () => {
    const css = `.a { inline-size: ${bare("--panel-w")}; block-size: ${bare("--brand-new")}; }`;
    const runtime = { ...sources, runtimeSetVariables: new Set(["--panel-w"]) };
    expect(() => addDeclaredFallbacks(css, runtime)).toThrow(UndeclaredTokenFallbackError);
    expect(() => addDeclaredFallbacks(css, runtime)).toThrow(/: --brand-new\. /);
  });

  it("writes unset for --tw only in the feature query Tailwind's supports variant generates", () => {
    const query = `@supports (backdrop-filter: ${bare("--tw")}) { .b { color: red; } }`;
    expect(addDeclaredFallbacks(query, sources)).toBe("@supports (backdrop-filter: var(--tw, unset)) { .b { color: red; } }");
    expect(() => addDeclaredFallbacks(`.b { color: ${bare("--tw")}; }`, sources)).toThrow(/: --tw\. /);
    expect(() => addDeclaredFallbacks(query, { ...sources, themeCss: `${themeCss}\n${query}` })).toThrow(/: --tw\. /);
  });
});

describe("runtime setters", () => {
  it("finds style-object keys and setProperty calls, through a const name, and ignores comments", () => {
    const scan = scanRuntimeSetters(`
      const PANEL = "--panel-w";
      // style={{ "--in-line-comment": 1 }}
      /* "--in-block-comment": 1 */
      export const A = () => <div style={{ "--gap": gap, '--ratio': r } as CSSProperties} />;
      el.style.setProperty("--clearance", h);
      el.style.setProperty(PANEL, w);
      el.style.setProperty(UNKNOWN, w);
      const label = "--not-a-key";
    `);
    expect([...runtimeSetNames(scan)].sort()).toEqual(["--clearance", "--gap", "--panel-w", "--ratio"]);
  });

  it("finds declarations in HTML style attributes written as strings, skipping ${...} interpolations (CONTAM-U7)", () => {
    const scan = scanRuntimeSetters(`
      const a = \`<div style="--ink:\${ref(rules.ink, "var(--border)")};--tile:\${ref(rules.tile, "24px")};background:\${shape}"></div>\`;
      const b = "<p data-x=1 style='--lines:3'>";
      const c = \`<html style="color-scheme:\${mode}">\`;
      const d = \`<div class="--not-style:1" title="style">\`;
      // <div style="--in-comment:1">
      const e = '<div style="--unclosed:1';
    `);
    expect([...runtimeSetNames(scan)].sort()).toEqual(["--ink", "--lines", "--tile"]);
  });

  it("refuses a bare read again once its only HTML style-attribute setter is removed", () => {
    const set = runtimeSetNames(scanRuntimeSetters('const html = `<p style="--lines:${n}">`;'));
    const css = ".a { -webkit-line-clamp: var(--lines); }";
    expect(addDeclaredFallbacks(css, { ...bareSources, runtimeSetVariables: set })).toBe(".a { -webkit-line-clamp: var(--lines, unset); }");
    const removed = runtimeSetNames(scanRuntimeSetters('const html = `<p data-lines="${n}">`;'));
    expect(() => addDeclaredFallbacks(css, { ...bareSources, runtimeSetVariables: removed })).toThrow(/--lines/);
  });

  it("reads this package's own sources: every variable the stylesheets set only at run time", () => {
    const names = runtimeSetVariables(resolve(import.meta.dirname, "..", ".."));
    for (const name of ["--frame-panel-w", "--gap", "--plate-x", "--plate-y", "--plate-z", "--studio-pattern-image", "--studio-pattern-size", "--studio-ruler-bar", "--studio-specimen-value", "--studio-swatch"]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(names.has("--tw")).toBe(false);
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
    const declaredSources = compiledCssDeclaredSources(stylesDir);
    const declared = declaredTokenValues(declaredSources, raw);
    /** The fallback a bare read must carry: the declared value, else `unset` for a runtime-only variable or Tailwind's `--tw` feature query. */
    const expectedFallback = (name: string, index: number) =>
      declared.get(name) ??
      (declaredSources.runtimeSetVariables.has(name) || (name === "--tw" && /@supports \([a-z-]+: $/.test(raw.slice(index - 40, index))) ? "unset" : undefined);
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
      const value = expectedFallback(name, m.index);
      if (value === undefined || collapseFallbacks(written.fallback ?? "") !== collapseFallbacks(value)) problems.push(`${name}: ${written.fallback} != ${value}`);
      delta += written.text.length - m[0].length;
      rawAt = m.index + m[0].length;
    }
    if (problems.length === 0 && raw.slice(rawAt) !== committed.slice(rawAt + delta)) problems.push("trailing text differs");
    expect(problems).toEqual([]);
  }, 60_000);
});
