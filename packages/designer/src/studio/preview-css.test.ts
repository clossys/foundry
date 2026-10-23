import { describe, expect, it } from "vitest";
import type { LibraryData, Selection } from "../catalog-core/index.js";
import { resolveCascade, type CascadeRule } from "../tokens/internal/cascade.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { emit, resolve } from "./demo-engine.js";
import { buildCandidates } from "./model.js";
import { candidatesCss, liveCss } from "./preview-css.js";

const ACTION = "tokens.accent-color";
const RAMP = "tokens.color-ramp";
const CONTAINER = "tokens.region-width";
const SURFACE = "--color-surface-base";
const base = { catalog: DEMO_CATALOG, library: DEMO_LIBRARY };

interface Rule { readonly selector: string; readonly insideDarkMedia: boolean; readonly declarations: Readonly<Record<string, string>> }
const BLOCK = /(@media \(prefers-color-scheme: dark\) \{ )?([^{}@]+?) \{([^{}]*)\}/g;
function parseRules(css: string): Rule[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(BLOCK)].map((match) => ({
    selector: (match[2] as string).trim(), insideDarkMedia: match[1] !== undefined,
    declarations: Object.fromEntries((match[3] as string).split(";").map((line) => line.trim()).filter(Boolean).map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    })),
  }));
}
const braces = (css: string): number => (css.match(/\{/g) ?? []).length - (css.match(/\}/g) ?? []).length;

/** A working library whose surface fill has one value for both modes, and a light value the base brand does not have. */
function singleModeSurface(): LibraryData {
  const strip = (node: unknown, light: string): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.$type === "color") {
      (record.$value as { hex: string }).hex = light;
      delete (record.$extensions as Record<string, unknown> | undefined)?.["com.clossys.modes"];
      return;
    }
    for (const value of Object.values(record)) strip(value, light);
  };
  const library = structuredClone(DEMO_LIBRARY);
  for (const fill of library.fills) if (fill.$extensions["com.clossys.fill"].slot === "tokens.surface-color") strip(fill.tokens, "#ABCDEF");
  return library;
}

describe("liveCss against a brand block generated later in the page", () => {
  const generated = emit(resolve({ ...base, selection: DEMO_SELECTION }), ["css-brand"])[0]?.contents ?? "";
  const live = liveCss({ ...base, library: singleModeSurface(), working: DEMO_SELECTION, previous: "" });
  const rules: CascadeRule[] = [...parseRules(live.css), ...parseRules(generated)].map((rule, at) => ({
    selector: rule.selector, insideDarkMedia: rule.insideDarkMedia, sourceIndex: at, value: rule.declarations[SURFACE] ?? "",
  }));
  it("is safe, balanced, and declares each member in all three blocks", () => {
    expect(live.safe).toBe(true);
    expect(braces(live.css)).toBe(0);
    const own = parseRules(live.css);
    expect(own.map((rule) => rule.selector)).toEqual([
      ":root:root[data-brand-bound]", ":root:root[data-brand-bound]:not([data-theme=\"light\"])", ":root:root[data-brand-bound][data-theme=\"dark\"]",
    ]);
    expect(own.map((rule) => rule.declarations[SURFACE])).toEqual(["#ABCDEF", "#ABCDEF", "#ABCDEF"]);
    expect(own.map((rule) => Object.keys(rule.declarations).length)).toEqual([12, 12, 12]);
  });
  it.each([
    ["light", { brandBound: true, dataTheme: undefined, osDark: false }],
    ["os dark", { brandBound: true, dataTheme: undefined, osDark: true }],
    ["explicit dark", { brandBound: true, dataTheme: "dark", osDark: false }],
    ["explicit dark under os dark", { brandBound: true, dataTheme: "dark", osDark: true }],
    ["explicit light under os dark", { brandBound: true, dataTheme: "light", osDark: true }],
  ] as const)("the preview value wins over the generated block in the %s state", (_name, state) => {
    expect(resolveCascade(rules, state)?.value).toBe("#ABCDEF");
  });
  it("the generated block alone would have shown its own value in dark", () => {
    const only = rules.filter((rule) => rule.sourceIndex >= 3);
    expect(resolveCascade(only, { brandBound: true, dataTheme: "dark", osDark: false })?.value).toBe("#0D1117");
  });
});

describe("liveCss with unsafe text", () => {
  const unsafe: Selection = { ...DEMO_SELECTION, picks: [{ scope: "slot", target: CONTAINER, source: "tailwind-default" }] };
  it("keeps the previous CSS and reports that it is not safe", () => {
    const first = liveCss({ ...base, working: DEMO_SELECTION, previous: "" });
    const next = liveCss({ ...base, working: unsafe, previous: first.css });
    expect(next).toEqual({ css: first.css, safe: false });
    expect(next.css).not.toContain("display: none");
    expect(liveCss({ ...base, working: unsafe, previous: "" })).toEqual({ css: "", safe: false });
  });
  it("recovers once the pick is gone", () => {
    expect(liveCss({ ...base, working: DEMO_SELECTION, previous: "stale" }).css).toContain(":root:root[data-brand-bound]");
  });
});

describe("candidatesCss", () => {
  const cards = (slotId: string): ReturnType<typeof buildCandidates> => buildCandidates({ ...base, working: DEMO_SELECTION, slotId, scope: "slot", target: slotId });
  it("scopes every block to one card, with the dark variants nested under the theme state", () => {
    const css = candidatesCss(cards(ACTION));
    expect(braces(css)).toBe(0);
    const selectors = parseRules(css).map((rule) => rule.selector);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toMatch(/\[data-studio-candidate="[0-2]"\]$/);
    expect(selectors).toContain(":root[data-theme=\"dark\"] [data-studio-candidate=\"0\"]");
    expect(parseRules(css).some((rule) => rule.insideDarkMedia && rule.selector === ":root:not([data-theme=\"light\"]) [data-studio-candidate=\"1\"]")).toBe(true);
    expect(css).not.toContain("data-brand-bound");
  });
  it("redeclares the bound token inside the card, so each card shows its own value", () => {
    const rules = parseRules(candidatesCss(cards(ACTION)));
    const light = (index: number): string | undefined => rules.find((rule) => rule.selector === `[data-studio-candidate="${index}"]`)?.declarations["--color-accent"];
    expect([light(0), light(1), light(2)]).toEqual(["#8250DF", "#4D4D4D", "#0EA5E9"]);
  });
  it("numbers unbound members per card, in id order", () => {
    const rules = parseRules(candidatesCss(cards(RAMP)));
    expect(rules.map((rule) => Object.keys(rule.declarations))).toEqual([["--studio-m-0", "--studio-m-1", "--studio-m-2"], ["--studio-m-0", "--studio-m-1", "--studio-m-2"], ["--studio-m-0", "--studio-m-1", "--studio-m-2"]]);
    expect(rules[0]?.declarations["--studio-m-0"]).toBe("#6E7781");
  });
  it("gives a card with a C1 error no block at all, so its raw text never reaches a style element", () => {
    const css = candidatesCss(cards(CONTAINER));
    expect(css).not.toContain("display: none");
    expect(css).not.toContain("body");
    expect(css).not.toContain("data-studio-candidate=\"1\"");
    expect(braces(css)).toBe(0);
  });
});
