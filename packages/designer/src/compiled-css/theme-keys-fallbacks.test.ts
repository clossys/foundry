// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compiledCssDeclaredSources } from "./generate.js";
import { alignDeclaredFallbacks, classifyFallbackReads, collectCustomPropertyDeclarations, globalDeclaredTokenValues, type DeclaredSources } from "./declared-fallbacks.js";
import { SHADCN_KEYS_BEGIN, SHADCN_KEYS_END } from "./shadcn-theme-keys.js";

/**
 * CONTAM-U6 (planner decision D5 B = a): every `var(--x, F)` read in styles/theme-keys.css carries a
 * fallback, and where `--x` has a global declared value (`:root` or theme level; for Tailwind's
 * `--tw-*`, its `@property` initial value) F equals that value, expanded. A read of a scoped or
 * runtime-only variable has no global value to equal; it is listed by name and left as written.
 */
const styles = resolve(import.meta.dirname, "../../styles");
const themeKeys = readFileSync(resolve(styles, "theme-keys.css"), "utf8");
const compiled = readFileSync(resolve(styles, "compiled.css"), "utf8");
const sources = compiledCssDeclaredSources(styles);
const reads = classifyFallbackReads(themeKeys, sources, compiled);
const lineOf = (offset: number): number => themeKeys.slice(0, offset).split("\n").length;
const at = (read: { name: string; offset: number }): string => `theme-keys.css:${lineOf(read.offset)} ${read.name}`;

describe("theme-keys.css fallbacks equal their declared values (CONTAM-U6)", () => {
  it("has no bare read", () => {
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((read) => read.fallback === null).map(at)).toEqual([]);
  });

  it("gives every read of a global token, and every --tw-* read, its declared value as fallback", () => {
    const judged = reads.filter((read) => read.kind === "global" || read.kind === "tw-property");
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.filter((read) => read.fallback !== read.expected).map((read) => `${at(read)}: ${read.fallback} != ${read.expected}`)).toEqual([]);
  });

  it("lists scoped and runtime reads by name, each with no global declared value", () => {
    const global = globalDeclaredTokenValues(sources, compiled);
    const scopedOutput = new Set(collectCustomPropertyDeclarations(compiled).map((d) => d.name));
    const listed = reads.filter((read) => read.kind !== "global" && read.kind !== "tw-property");
    for (const read of listed) {
      expect(global.has(read.name), at(read)).toBe(false);
      if (read.kind === "scoped") expect(scopedOutput.has(read.name), at(read)).toBe(true);
      if (read.kind === "runtime") expect(sources.runtimeSetVariables.has(read.name), at(read)).toBe(true);
      expect(read.kind, at(read)).not.toBe("unresolvable");
    }
    // Printed so a reviewer reads the names the equality rule does not reach.
    console.info(`theme-keys.css reads with no global declared value: ${[...new Set(listed.map((read) => `${read.name} (${read.kind})`))].sort().join(", ")}`);
  });

  it("covers the 31 generated shadcn colour keys", () => {
    const begin = themeKeys.indexOf(SHADCN_KEYS_BEGIN);
    const end = themeKeys.indexOf(SHADCN_KEYS_END);
    const region = reads.filter((read) => read.offset > begin && read.offset < end);
    expect(region).toHaveLength(31);
    for (const read of region) expect(read.kind, at(read)).toBe("global");
  });

  it("is a fixed point of the aligner (node scripts/align-theme-keys-fallbacks.mjs)", () => {
    expect(alignDeclaredFallbacks(themeKeys, sources, compiled)).toBe(themeKeys);
  });
});

describe("the fallback judge", () => {
  const fixture: DeclaredSources = {
    tokensCss: ":root { --a: 4px; --b: var(--a, 4px); }",
    themeCss: "",
    defaultThemeCss: "",
    tailwindThemeCss: "",
    runtimeSetVariables: new Set(["--r"]),
  };
  const output = ".x { --s: 1px; } @property --tw-k { syntax: \"*\"; inherits: false; initial-value: 0; }";

  it("writes the global, --tw-* and nested declared values, and leaves scoped, runtime and comment reads as written", () => {
    expect(alignDeclaredFallbacks("/* var(--a, 1px) */ .y { a: var(--b, 1px); b: var(--a, 9px); c: var(--r, 3px); d: var(--s, 2px); e: var(--tw-k, 1); }", fixture, output))
      .toBe("/* var(--a, 1px) */ .y { a: var(--b, var(--a, 4px)); b: var(--a, 4px); c: var(--r, 3px); d: var(--s, 2px); e: var(--tw-k, 0); }");
  });

  // The two mutations the equality test must catch, made on the real file: a stripped fallback and a changed one.
  const target = reads.find((read) => read.kind === "global" && read.fallback !== null && !read.fallback.includes("var("))!;
  let end = target.offset + 3;
  for (let depth = 0; ; end++) {
    if (themeKeys[end] === "(") depth++;
    else if (themeKeys[end] === ")" && --depth === 0) break;
  }
  const original = themeKeys.slice(target.offset, end + 1);

  it("finds a stripped fallback as bare, and the aligner puts it back", () => {
    const stripped = themeKeys.slice(0, target.offset) + original.replace(/,[^,]*\)$/, ")") + themeKeys.slice(end + 1);
    const found = classifyFallbackReads(stripped, sources, compiled).filter((read) => read.fallback === null);
    expect(found.map((read) => read.name)).toEqual([target.name]);
    expect(alignDeclaredFallbacks(stripped, sources, compiled)).toBe(themeKeys);
  });

  it("finds a changed fallback as unequal, and the aligner puts it back", () => {
    const changed = themeKeys.slice(0, target.offset) + `var(${target.name}, 0.123px)` + themeKeys.slice(end + 1);
    const unequal = classifyFallbackReads(changed, sources, compiled).filter((read) => read.kind === "global" && read.fallback !== read.expected);
    expect(unequal.map((read) => `${read.name} ${read.fallback}`)).toEqual([`${target.name} 0.123px`]);
    expect(alignDeclaredFallbacks(changed, sources, compiled)).toBe(themeKeys);
  });

  it("gives a bare runtime-only read unset (--frame-panel-w)", () => {
    expect(reads.find((read) => read.name === "--frame-panel-w")).toMatchObject({ kind: "runtime", fallback: "unset" });
  });
});
