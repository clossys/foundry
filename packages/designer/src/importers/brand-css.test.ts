import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { parseFill } from "../catalog-core/cell.js";
import type { DtcgNode, DtcgToken, FillDoc, Slot, Source } from "../catalog-core/types.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import { TOKENS } from "../tokens/tokens.js";
import { importBrandCss } from "./brand-css.js";
import { importFoundry } from "./foundry.js";

const slots = tokenSlots as unknown as readonly Slot[];
const tokens = Object.values(TOKENS);
const styles = resolve(dirname(fileURLToPath(import.meta.url)), "../../styles");
const template = readFileSync(resolve(styles, "brand-template.css"), "utf8");
const tokensCss = readFileSync(resolve(styles, "tokens.css"), "utf8");
const darkValues = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
const consumer: Source = { id: "acme-brand", kind: "consumer", license: "proprietary", author: "first-party" } as unknown as Source;
const address = "styles/brand.css";

const templateNames = new Set([...template.matchAll(/^\s*(--[a-z0-9-]+):\s*;/gm)].map(match => match[1]!));
const optional = tokens.filter(token => token.brandable && !templateNames.has(token.property));
const optionalLiteral = optional.filter(token => !token.value.includes("var(") && !(darkValues.get(token.property) ?? "").includes("var("));

/** The shipped template with every blank filled: light from TOKENS, both dark blocks from tokens.css; `extra` adds the optional properties that hold a literal value. */
function filled(extra = false): string {
  let block: "light" | "dark" = "light";
  return template.split("\n").flatMap(text => {
    const opens = /^:root\[data-brand-bound\](\[data-theme="dark"\])?\s*\{/.exec(text);
    if (/^\s*:root\[data-brand-bound\]\s*\{/.test(text)) block = "light";
    else if (/^\s*:root\[data-brand-bound\]/.test(text)) block = "dark";
    const blank = /^(\s*)(--[a-z0-9-]+):\s*;\s*$/.exec(text);
    if (blank) {
      const name = blank[2]!;
      return [`${blank[1]}${name}: ${block === "dark" ? darkValues.get(name) ?? TOKENS[name]!.value : TOKENS[name]!.value};`];
    }
    if (!extra || !opens) return [text];
    const dark = opens[1] !== undefined;
    return [text, ...optionalLiteral.filter(token => !dark || token.themeDependent).map(token => `  ${token.property}: ${dark ? darkValues.get(token.property) ?? token.value : token.value};`)];
  }).join("\n");
}
const css = filled();
const imported = importBrandCss({ css, source: consumer, address, slots, tokens });
const foundry = importFoundry({ tokens, tokensCss, slots });
const run = (text: string) => importBrandCss({ css: text, source: consumer, address, slots, tokens });

function leaves(fills: readonly FillDoc[]): Map<string, DtcgToken> {
  const found = new Map<string, DtcgToken>();
  const walk = (prefix: string, node: unknown): void => {
    const record = node as Record<string, unknown>;
    if (Object.hasOwn(record, "$value")) { found.set(prefix, record as unknown as DtcgToken); return; }
    for (const [key, child] of Object.entries(record)) walk(`${prefix}.${key}`, child);
  };
  for (const fill of fills) for (const [key, child] of Object.entries(fill.tokens as Record<string, DtcgNode>)) walk(`tokens.${key}`, child);
  return found;
}
const full = importBrandCss({ css: filled(true), source: consumer, address, slots, tokens });
const importedLeaves = leaves(imported);
const fullLeaves = leaves(full);
const foundryLeaves = leaves(foundry);

describe("importBrandCss", () => {
  it("reads the filled template into the same tokens Foundry's own import holds for each brandable property", () => {
    expect(importedLeaves.size).toBe(48);
    for (const [leaf, token] of importedLeaves) expect({ leaf, token }).toEqual({ leaf, token: foundryLeaves.get(leaf) });
  });
  it("also binds the optional properties a brand declares, with the same tokens Foundry holds", () => {
    expect(optional).toHaveLength(11);
    expect(optionalLiteral.length).toBeGreaterThan(0);
    expect(fullLeaves.size).toBe(48 + optionalLiteral.length);
    for (const [leaf, token] of fullLeaves) expect({ leaf, token }).toEqual({ leaf, token: foundryLeaves.get(leaf) });
  });
  it("covers every brandable property: the template, the literal optionals and the optionals that are aliases upstream", () => {
    const emitted = new Set(slots.flatMap(slot => Object.values(slot.contract.emit ?? {})));
    expect(tokens.filter(token => token.brandable && emitted.has(token.property))).toHaveLength(59);
    expect(optional.filter(token => !optionalLiteral.includes(token)).map(token => token.property).sort()).toEqual(optional.filter(token => token.value.includes("var(") || (darkValues.get(token.property) ?? "").includes("var(")).map(token => token.property).sort());
  });
  it("round-trips: re-emitting the imported tokens reproduces the declarations that were read", () => {
    const light = parseDeclarationsForSelector(css, ":root[data-brand-bound]");
    const dark = parseDeclarationsForSelector(css, ':root[data-brand-bound][data-theme="dark"]');
    const emit = new Map<string, { light: string; dark?: string }>();
    for (const slot of slots) for (const [member, property] of Object.entries(slot.contract.emit ?? {})) {
      const token = importedLeaves.get(`${slot.id}.${member}`);
      if (!token) continue;
      const extensions = token.$extensions as { "com.clossys.css": { raw: string }; "com.clossys.modes"?: { dark: unknown } } | undefined;
      const modeDark = extensions?.["com.clossys.modes"]?.dark;
      emit.set(property, { light: extensions!["com.clossys.css"].raw, ...(modeDark === undefined ? {} : { dark: typeof modeDark === "string" ? modeDark : dark.get(property)! }) });
    }
    for (const [property, value] of emit) {
      expect(value.light, property).toBe(light.get(property));
      if (value.dark !== undefined) expect(value.dark, property).toBe(dark.get(property));
    }
    expect(emit.size).toBe(importedLeaves.size);
  });
  it("records the consumer source and the address on every cell and parses them", () => {
    for (const fill of imported) {
      const meta = fill.$extensions["com.clossys.fill"];
      expect(meta).toMatchObject({ source: "acme-brand", mode: "implementation", sourceAddress: address, trust: "consumer", status: "draft", builtOn: [] });
      expect(meta.id).toBe(`acme-brand/${meta.slot}`);
      expect(parseFill(fill).findings).toEqual([]);
    }
  });
  it("lists names the catalog does not bind in unmapped", () => {
    const result = run(`${css}\n:root[data-brand-bound] {\n  --brand-extra: 3px;\n  --space-md: 1rem;\n}\n`);
    expect(result[0]!.$extensions["com.clossys.fill"].unmapped).toEqual(expect.arrayContaining(["--brand-extra", "--space-md"]));
    expect(imported[0]!.$extensions["com.clossys.fill"].unmapped).toBeUndefined();
  });
  it("rejects blank values, aliases, a missing dark value and a stylesheet that binds nothing", () => {
    expect(() => run(template)).toThrow(new Error("importer: --color-surface-base is declared empty"));
    expect(() => run(css.replace(/(--color-surface-base:\s*)[^;]+;/, "$1var(--other, #000);"))).toThrow(new Error("importer: --color-surface-base must be a literal value"));
    expect(() => run(":root[data-brand-bound] {\n  --brand-extra: 3px;\n}\n")).toThrow(new Error("importer: brand css binds no brandable token"));
  });
  it("requires a dark value for a theme-dependent property", () => {
    const withoutDark = css.replace(/^:root\[data-brand-bound\]\[data-theme="dark"\] \{/m, ":root[data-brand-nodark] {");
    expect(() => run(withoutDark)).toThrow(new Error("importer: --color-surface-base has no dark value"));
  });
  it("reads a differently named dark selector", () => {
    const renamed = css.replace(/^:root\[data-brand-bound\]\[data-theme="dark"\] \{/m, ".brand-dark {");
    expect(importBrandCss({ css: renamed, source: consumer, address, slots, tokens, darkSelector: ".brand-dark" })).toEqual(imported);
  });
});
