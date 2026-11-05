import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";
import { SHADCN_ARIA_FIXED_PATTERNS, SHADCN_ARIA_STYLE_VARS, shadcnAriaStyleRead } from "./shadcn-aria-style-vars.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const fixtures = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const req = createRequire(import.meta.url);

/** Class atom without its variant prefix (the last `:` outside brackets/parens). */
function base(atom: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < atom.length; i++) {
    const ch = atom[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) cut = i + 1;
  }
  return atom.slice(cut).replace(/^!/, "");
}

function pinnedInput(): ShadcnComponentInput {
  const read = (name: string) => readFileSync(resolve(fixtures, name), "utf8");
  return { items: readdirSync(fixtures).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}

/** Fixed-pattern components in the source every shadcn@aria fill ships. */
function fixedHits(): string[] {
  const result = importShadcnAriaComponents(pinnedInput());
  const filled = new Set(result.fills.map(doc => Object.values(doc.components)[0]!.item));
  expect(filled.size).toBeGreaterThan(20);
  const hits: string[] = [];
  for (const item of filled) {
    for (const file of result.rewrites[item]!.files.filter(file => /\.tsx?$/.test(file.path))) {
      for (const atom of file.content.split(/[\s"'`{},]+/)) {
        const bare = base(atom);
        for (const [label, pattern] of Object.entries(SHADCN_ARIA_FIXED_PATTERNS)) {
          if (pattern.test(bare)) hits.push(`${item} ${file.path}: ${label} (${atom})`);
        }
      }
    }
  }
  return hits;
}

async function build(candidates: string[]): Promise<string> {
  const compiler = await compile('@import "tailwindcss";', {
    base: packageRoot,
    loadStylesheet: async (id, from) => {
      const path = id.startsWith("tailwindcss") ? req.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : `${id}.css`) : resolve(from, id);
      return { path, base: resolve(path, ".."), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates).replace(/\/\*[\s\S]*?\*\//g, "");
}

const escapeClass = (candidate: string): string => candidate.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);

/** The declaration value `property` takes in the rule for `candidate`. */
function declaration(css: string, candidate: string, property: string): string {
  const start = css.indexOf(`.${escapeClass(candidate)} {`);
  expect(start, `rule for ${candidate}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const match = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`).exec(body);
  expect(match, `${property} in ${candidate}`).not.toBeNull();
  return match![1]!.trim();
}

/** Resolve `var(--x,<fallback>)` with `--x` unset, so only the style default remains. */
function withDefaults(value: string): string {
  const match = /^var\((--[\w-]+),\s*([\s\S]+)\)$/.exec(value);
  return match ? match[2]!.trim() : value;
}

const squash = (value: string): string => value.replace(/\s+/g, "");

/** How each fixed class is read in the rewritten fill, and the property that carries its value. */
const READS: Record<string, { utility: string; property: string; hint?: "length"; fixedValue?: (css: string) => string }> = {
  "z-50": { utility: "z", property: "z-index" },
  "duration-100": { utility: "duration", property: "transition-duration" },
  "duration-200": { utility: "duration", property: "transition-duration" },
  "opacity-50": { utility: "opacity", property: "opacity" },
  "ring-3": {
    utility: "outline",
    property: "outline-width",
    hint: "length",
    fixedValue: css => /calc\((\S+) \+ var\(--tw-ring-offset-width\)\)/.exec(css.slice(css.indexOf(".ring-3 {")))![1]!,
  },
  "border": { utility: "border", property: "border-width", hint: "length" },
  "h-7": { utility: "h", property: "height" },
  "h-8": { utility: "h", property: "height" },
  "h-9": { utility: "h", property: "height" },
  "size-3.5": { utility: "size", property: "width" },
  "size-4": { utility: "size", property: "width" },
};

describe("shadcn@aria style variables", () => {
  it("leaves none of the ten fixed nova patterns in the source of any shadcn@aria fill", () => {
    expect(Object.keys(SHADCN_ARIA_FIXED_PATTERNS)).toHaveLength(10);
    expect(fixedHits()).toEqual([]);
  });

  it("resolves every rewritten class, with defaults only, to the fixed class's own value", async () => {
    const rows = SHADCN_ARIA_STYLE_VARS.filter(row => row.fallback !== undefined);
    expect(rows.map(row => row.fixed).sort()).toEqual(Object.keys(READS).sort());
    const pairs = rows.map(row => {
      const read = READS[row.fixed]!;
      return { row, read, rewritten: `${read.utility}-${shadcnAriaStyleRead(row.variable, row.fixed, read.hint)}` };
    });
    const css = await build(pairs.flatMap(pair => [pair.row.fixed, pair.rewritten]));
    for (const { row, read, rewritten } of pairs) {
      const fixed = read.fixedValue ? read.fixedValue(css) : declaration(css, row.fixed, read.property);
      const resolved = withDefaults(declaration(css, rewritten, read.property));
      expect(squash(resolved), `${row.fixed} -> ${rewritten}`).toBe(squash(fixed));
    }
  });
});
