/**
 * CP1-REFS (a): Foundry's own stylesheets declare every tokens.ts id a vendored stock item reads.
 *
 * A stock file (packages/designer/references/**) reads tokens with bare `var(--x)`. Wherever the file is written,
 * each read takes its declared value through a declared-fallback reader, and a name with no declared value is
 * refused. Foundry's own declared sources are styles/tokens.css `:root`, styles/theme.css (with theme-keys.css) and
 * the package default theme: Tailwind's default theme is not Foundry's, so it is left out here. The set is computed
 * from the references and TOKEN_ENTRIES, never typed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_ENTRIES } from "../catalog/tokens.js";
import { alignImportedReads, bareReads, pinnedThemeFallbackReader } from "../importers/declared-fallback-reader.js";
import { declaredTokenValues } from "./declared-fallbacks.js";
import { compiledCssDeclaredSources, generateCompiledCss } from "./generate.js";

const PACKAGE = resolve(__dirname, "../..");
const STYLES = join(PACKAGE, "styles");
const REFERENCES = join(PACKAGE, "references");
const BUTTON = join(REFERENCES, "shadcn-aria/button@4.23.0/registry/aria-nova/ui/button.tsx");

/** Foundry's own declared value of each token: the generator's sources and precedence, without Tailwind's default theme. */
function foundryDeclared(): Map<string, string> {
  return declaredTokenValues({ ...compiledCssDeclaredSources(STYLES), tailwindThemeCss: "" }, "");
}

function referenceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...referenceFiles(path));
    else if (/\.(?:tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}

describe("stock reads have Foundry-declared sources", () => {
  it("every token a vendored stock item reads has a declared source", () => {
    const ids = new Set(TOKEN_ENTRIES.map(entry => entry.id));
    const declared = foundryDeclared();
    const missing = new Map<string, string>();
    for (const file of referenceFiles(REFERENCES)) {
      for (const name of bareReads(readFileSync(file, "utf8"))) {
        if (ids.has(name) && !declared.has(name) && !missing.has(name)) missing.set(name, relative(REFERENCES, file));
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it("each declared stock-read id aliases its previous id", () => {
    const declared = foundryDeclared();
    for (const id of ["--radius-xs", "--radius-md", "--ease-out"]) {
      const entry = TOKEN_ENTRIES.find(each => each.id === id)!;
      const value = declared.get(id) ?? "";
      expect(entry.previousIds.some(previous => value.startsWith(`var(${previous},`)), `${id} = ${value}`).toBe(true);
    }
  });

  it("the stock button compiles with no theme slot pinned", async () => {
    const text = readFileSync(BUTTON, "utf8");
    expect(bareReads(text)).toContain("--radius-md");
    // No pinned theme: the only values are Foundry's own declared ones.
    const reader = pinnedThemeFallbackReader(Object.fromEntries(foundryDeclared()), "foundry declared sources");
    const aligned = alignImportedReads(text, reader);
    expect(bareReads(aligned)).toEqual([]);
    const candidates = [...new Set([...aligned.matchAll(/"([^"\n]*)"/g)].flatMap(match => match[1]!.split(/\s+/)).filter(Boolean))];
    const generated = await generateCompiledCss({ stylesDir: STYLES, candidates });
    expect(generated.css).toMatch(/--radius-md/);
  });
});
