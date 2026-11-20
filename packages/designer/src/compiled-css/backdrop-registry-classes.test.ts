/**
 * foundry-build-0048 U23 review B1: the adopted backdrop registry fixes classes on its source
 * components (`props.className`, e.g. grid-pattern's `fill-current/20 stroke-current/30`). They live
 * in JSON, which the text scan never reads, so without a rule in compiled.css the layer paints with
 * browser defaults. Every such token must have a rule in the committed compiled.css, and reach the
 * scan's candidates. The registry is read here directly, not through the scanner under test.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { backdropRegistryClasses, scanCompiledCssSources, scanUtilitiesSources } from "./scan-sources.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");
const registry = JSON.parse(readFileSync(resolve(packageRoot, "src/catalog/rules/backdrop-components.json"), "utf8")) as {
  components: { id: string; props?: { className?: string }; reducedMotion?: { props?: { className?: string } } }[];
};
const compiled = readFileSync(resolve(packageRoot, "styles/compiled.css"), "utf8");

/** Tailwind's own selector escaping: every character outside [a-zA-Z0-9_-] gains a backslash. */
const selectorOf = (className: string) => "." + className.replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);
const tokens = [...new Set(registry.components.flatMap(entry => [entry.props?.className, entry.reducedMotion?.props?.className]
  .flatMap(value => (typeof value === "string" ? value.split(/\s+/).filter(Boolean) : []))))].sort();

describe("backdrop registry fixed classes have compiled CSS (foundry-build-0048 U23 B1)", () => {
  it("the registry fixes at least the grid-pattern paint classes", () => {
    expect(tokens).toEqual(expect.arrayContaining(["fill-current/20", "stroke-current/30"]));
  });

  it.each(tokens)("%s has a rule in the committed compiled.css", token => {
    expect(compiled.includes(`${selectorOf(token)} {`) || compiled.includes(`${selectorOf(token)},`) || compiled.includes(`${selectorOf(token)}:`), token).toBe(true);
  });

  it("the scan reads exactly the registry's fixed classes, and both CSS scans carry them", () => {
    expect(backdropRegistryClasses(packageRoot)).toEqual(tokens);
    const compiledCandidates = new Set(scanCompiledCssSources(packageRoot).candidates);
    const utilitiesCandidates = new Set(scanUtilitiesSources(packageRoot).candidates);
    for (const token of tokens) {
      expect(compiledCandidates.has(token), `compiled.css candidates: ${token}`).toBe(true);
      expect(utilitiesCandidates.has(token), `utilities.css candidates: ${token}`).toBe(true);
    }
  });
});
