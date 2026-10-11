import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRootDeclarations, parseDeclarationsForSelector } from "./internal/parse-css.js";
import { type TokenDefinition } from "./tokens.js";
import { registryFromDeclarations } from "./internal/registry-from-css.js";
import { checkTokenContrast } from "./contrast-gate.js";
import { AA, AA_LARGE, CONTRAST_PAIRS, contrastPairsForTheme } from "./contrast-pairs.js";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");
const groundPairs = (theme: "light" | "dark") => contrastPairsForTheme(theme).filter(pair =>
  /^chart-(inline-axis-label|categorical-[1-8])\/surface-(base|sunken)$/.test(pair.id));
const registry = (theme: "light" | "dark") => {
  const values = new Map([...parseRootDeclarations(css), ...(theme === "dark" ? parseDeclarationsForSelector(css, ':root[data-theme="dark"]') : [])]);
  return registryFromDeclarations(values);
};
const def = (property: string, value: string): TokenDefinition => ({property, value, family: "surface", brandable: false, themeDependent: false});

describe("chart chrome and series on actual base/sunken grounds", () => {
  it("checks every axis-label and all eight categorical slots on both grounds", () => {
    const pairs = groundPairs("light");
    expect(pairs).toHaveLength(18);
    expect(new Set(pairs.map(pair => pair.id)).size).toBe(18);
    for (const pair of pairs) expect(pair.minimumRatio).toBe(pair.id.includes("axis-label") ? AA : AA_LARGE);
    expect(CONTRAST_PAIRS.filter(pair => pairs.some(candidate => candidate.id === pair.id)).every(pair => !pair.exception)).toBe(true);
  });
  it("reports the eight raw light ground failures without compensation", () => {
    const ids = new Set(groundPairs("light").map(pair => pair.id));
    const result = checkTokenContrast(CONTRAST_PAIRS.filter(pair => ids.has(pair.id)), {tokens: registry("light")});
    expect(result.findings.map(pair => pair.pairId).sort()).toEqual(["base", "sunken"].flatMap(surface => [2, 3, 4, 5].map(slot => `chart-categorical-${slot}/surface-${surface}`)).sort());
    expect(result.ok).toBe(false);
    expect(result.relieved).toEqual([]);
    expect(result.unchecked).toEqual([]);
  });
  it("preserves the original raised relief independently of the new grounds", () => {
    const pairs = contrastPairsForTheme("light").filter(pair => pair.id.startsWith("chart-categorical-"));
    expect(pairs.filter(pair => pair.exception).map(pair => pair.id).sort()).toEqual([
      ...[3, 4, 5].map(slot => `chart-categorical-${slot}/chart-surface`),
      ...["base", "sunken"].flatMap(surface => [2, 3, 4, 5].map(slot => `chart-categorical-${slot}/surface-${surface}`)),
    ].sort());
    expect(pairs.find(pair => pair.id === "chart-categorical-2/chart-surface")!.exception).toBeUndefined();
  });
  it.each(["light", "dark"] as const)("measures %s and permits only the explicitly compensated light slots", theme => {
    const result = checkTokenContrast(groundPairs(theme), { tokens: registry(theme) });
    expect(result.pairsChecked).toBe(18);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toEqual([]);
    const expected = theme === "light" ? ["base", "sunken"].flatMap(surface => [2, 3, 4, 5].map(slot => `chart-categorical-${slot}/surface-${surface}`)).sort() : [];
    expect(result.relieved.map(pair => pair.pairId).sort()).toEqual(expected);
    expect(result.ok).toBe(true);
  });
  it.each(["base", "sunken"])("rejects stale light slot-2 relief on %s", surface => {
    const id = `chart-categorical-2/surface-${surface}`;
    const pairs = groundPairs("light").filter(pair => pair.id === id);
    expect(pairs).toHaveLength(1);
    const tokens = { ...registry("light"), "--color-chart-categorical-2": def("--color-chart-categorical-2", "#000000") };
    expect(checkTokenContrast(pairs, { tokens }).findings).toEqual([expect.objectContaining({ pairId: id, rule: "stale-exception" })]);
    expect(checkTokenContrast(pairs, { tokens }).ok).toBe(false);
  });
  it.each(["base", "sunken"])("does not relieve a new dark slot-2 failure on %s", surface => {
    const id = `chart-categorical-2/surface-${surface}`;
    const pairs = groundPairs("dark").filter(pair => pair.id === id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.exception).toBeUndefined();
    const tokens = registry("dark");
    const mutated = { ...tokens, "--color-chart-categorical-2": def("--color-chart-categorical-2", tokens[`--color-surface-${surface}`]!.value) };
    expect(checkTokenContrast(pairs, { tokens: mutated }).findings).toEqual([expect.objectContaining({ pairId: id, rule: "below-threshold", ratio: 1 })]);
    expect(checkTokenContrast(pairs, { tokens: mutated }).ok).toBe(false);
  });
});
