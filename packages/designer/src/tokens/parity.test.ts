import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { parseRootDeclarations } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const declarations = parseRootDeclarations(tokensCss);

/**
 * The important test in this package (see the README's Tests section): two
 * independently hand-authored artifacts, `styles/tokens.css` and
 * `src/tokens.ts`, both claim to describe the same 154 tokens. Nothing
 * generates one from the other, so nothing but a test keeps them in sync —
 * this is that test, checked in both directions and by value, not just by
 * name.
 */
describe("tokens.css <-> src/tokens.ts parity", () => {
  it("declares at least one custom property in :root", () => {
    expect(declarations.size).toBeGreaterThan(0);
  });

  it("every property declared in tokens.css has a matching TOKENS entry", () => {
    const missing = [...declarations.keys()].filter((name) => !(name in TOKENS));
    expect(missing).toEqual([]);
  });

  it("every TOKENS entry has a matching declaration in tokens.css", () => {
    const missing = Object.keys(TOKENS).filter((name) => !declarations.has(name));
    expect(missing).toEqual([]);
  });

  it("every TOKENS entry's `property` field matches its own key", () => {
    const mismatched = Object.entries(TOKENS).filter(([key, def]) => def.property !== key);
    expect(mismatched).toEqual([]);
  });

  it("every TOKENS value matches the literal value declared in tokens.css", () => {
    const mismatched: Array<{ name: string; css: string; ts: string }> = [];
    for (const [name, def] of Object.entries(TOKENS)) {
      const cssValue = declarations.get(name);
      if (cssValue !== undefined && cssValue !== def.value) {
        mismatched.push({ name, css: cssValue, ts: def.value });
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("declares exactly 154 tokens (the curated set this package promises)", () => {
    expect(declarations.size).toBe(154);
    expect(Object.keys(TOKENS).length).toBe(154);
  });
});
