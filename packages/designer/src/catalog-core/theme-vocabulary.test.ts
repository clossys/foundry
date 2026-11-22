import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { SHADCN_KEYS_BEGIN, SHADCN_KEYS_END } from "../compiled-css/shadcn-theme-keys.js";
import { STOCK_COLOR_BY_PROPERTY, STOCK_COLOR_KEYS, THEME_CONTRAST_PAIRS, shippedThemeCss } from "./theme-vocabulary.js";
import { defaultThemeCss } from "../builder/theme/css.js";
import { checkTokenContrast } from "../tokens/contrast-gate.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";
import { mergeDeclarations, registryFromDeclarations } from "../tokens/internal/registry-from-css.js";

const themeKeys = readFileSync(resolve(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
const tokensCss = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
/** The stock text pairs (planner ruling R1) and the Foundry pair whose threshold each keeps. */
const STOCK_TEXT_STANDS_IN_FOR: Readonly<Record<string, string>> = {
  "foreground/background": "ink-primary/surface-base",
  "foreground/card": "ink-primary/surface-raised",
  "foreground/popover": "ink-primary/surface-raised",
  "muted-foreground/card": "ink-muted/surface-raised",
  "muted-foreground/popover": "ink-muted/surface-raised",
  "muted-foreground/surface-raised": "ink-muted/surface-raised",
};
/** The package default theme (`defaultThemeCss()`) over the Foundry tokens, in light, OS dark and explicit dark. */
function defaultThemeRegistries(css = defaultThemeCss()) {
  const light = mergeDeclarations(parseRootDeclarations(tokensCss), parseDeclarationsForSelector(css, ":root[data-brand-bound]"));
  const dark = (tokensSelector: string, themeSelector: string) => mergeDeclarations(mergeDeclarations(light, parseDeclarationsForSelector(tokensCss, tokensSelector)), parseDeclarationsForSelector(css, themeSelector));
  return [
    { label: "light", declarations: light },
    { label: "dark OS", declarations: dark(':root:not([data-theme="light"])', ':root[data-brand-bound]:not([data-theme="light"])') },
    { label: "dark explicit", declarations: dark(':root[data-theme="dark"]', ':root[data-brand-bound][data-theme="dark"]') },
  ].map(theme => ({ ...theme, registry: registryFromDeclarations(theme.declarations) }));
}
const colourLeaves = (themeSlots as readonly { id: string; contract: { $type?: string; modes: readonly string[]; emit: Record<string, string> } }[])
  .filter(slot => slot.contract.$type === "color");

describe("stock shadcn colour vocabulary from the themes leaves", () => {
  it("has one entry per themes colour leaf, read from the leaf data", () => {
    expect(STOCK_COLOR_KEYS.size).toBe(colourLeaves.length);
    for (const slot of colourLeaves) {
      const entry = STOCK_COLOR_BY_PROPERTY.get(slot.contract.emit.default!);
      expect(entry, slot.id).toEqual({ key: `--color-${slot.contract.emit.default!.slice(2)}`, property: slot.contract.emit.default, leaf: slot.id, themeDependent: slot.contract.modes.includes("dark") });
    }
  });

  it("names the stock semantic set: primary, secondary, muted, accent, destructive, border, ring and chart-*", () => {
    for (const name of ["primary", "secondary", "muted", "accent", "destructive", "border", "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]) {
      expect(STOCK_COLOR_KEYS.get(`--color-${name}`)?.property, name).toBe(`--${name}`);
    }
    // The accent leaf is the stock highlight surface; the legacy brand accent is themes.primary.
    expect(STOCK_COLOR_KEYS.get("--color-accent")?.leaf).toBe("themes.accent");
    expect(STOCK_COLOR_KEYS.get("--color-primary")?.leaf).toBe("themes.primary");
  });

  it("equals the generated stock region of styles/theme-keys.css, key for key", () => {
    const region = themeKeys.slice(themeKeys.indexOf(SHADCN_KEYS_BEGIN) + SHADCN_KEYS_BEGIN.length, themeKeys.indexOf(SHADCN_KEYS_END));
    const generated = new Map([...region.matchAll(/^\s*(--color-[a-z0-9-]+):\s*var\((--[a-z0-9-]+), [^;]+\);/gm)].map(match => [match[1]!, match[2]!]));
    expect(new Map([...STOCK_COLOR_KEYS].map(([key, entry]) => [key, entry.property]))).toEqual(generated);
    const inline = parseDeclarationsForSelector(themeKeys, "@theme inline");
    for (const entry of STOCK_COLOR_KEYS.values()) expect(inline.get(entry.key), entry.key).toMatch(new RegExp(`^var\\(${entry.property}, [^;]+\\)$`));
  });

  it("ships a light value for every stock variable, and both dark contexts for every dark-mode leaf", () => {
    const css = shippedThemeCss();
    const light = parseRootDeclarations(css);
    const darkOs = parseDeclarationsForSelector(css, ':root:not([data-theme="light"])');
    const dark = parseDeclarationsForSelector(css, ':root[data-theme="dark"]');
    for (const entry of STOCK_COLOR_KEYS.values()) {
      expect(light.get(entry.property)?.trim(), entry.property).toBeTruthy();
      if (entry.themeDependent) {
        expect(darkOs.get(entry.property)?.trim(), entry.property).toBeTruthy();
        expect(dark.get(entry.property), entry.property).toBe(darkOs.get(entry.property));
      }
    }
  });

  it("keeps every stock contrast pair on a stock variable, outside the Foundry token gate", () => {
    expect(THEME_CONTRAST_PAIRS.length).toBeGreaterThan(0);
    for (const pair of THEME_CONTRAST_PAIRS) expect(STOCK_COLOR_BY_PROPERTY.has(pair.foreground) || STOCK_COLOR_BY_PROPERTY.has(pair.background), pair.id).toBe(true);
  });

  it("keeps each stock text pair at the threshold of the Foundry pair it stands in for", () => {
    for (const [id, foundry] of Object.entries(STOCK_TEXT_STANDS_IN_FOR)) {
      const pair = THEME_CONTRAST_PAIRS.find(candidate => candidate.id === id);
      const reference = CONTRAST_PAIRS.find(candidate => candidate.id === foundry);
      expect(pair, id).toBeDefined();
      expect(reference, foundry).toBeDefined();
      expect({ level: pair!.level, minimumRatio: pair!.minimumRatio }, id).toEqual({ level: reference!.level, minimumRatio: reference!.minimumRatio });
      expect(STOCK_COLOR_BY_PROPERTY.has(pair!.foreground), id).toBe(true);
    }
  });

  it("measures every stock contrast pair on the package default theme in light, OS dark and explicit dark", () => {
    for (const theme of defaultThemeRegistries()) {
      const report = checkTokenContrast(THEME_CONTRAST_PAIRS, { tokens: theme.registry });
      expect({ ok: report.ok, pairsChecked: report.pairsChecked, findings: report.findings, unchecked: report.unchecked, relieved: report.relieved }, theme.label)
        .toEqual({ ok: true, pairsChecked: THEME_CONTRAST_PAIRS.length, findings: [], unchecked: [], relieved: [] });
    }
  });

  it("fails a stock text pair measured on the default theme when its text matches its ground [mutant: light --foreground on --card]", () => {
    const css = defaultThemeCss();
    const light = parseDeclarationsForSelector(css, ":root[data-brand-bound]");
    const mutated = css.replace(`--foreground: ${light.get("--foreground")};`, `--foreground: ${light.get("--card")};`);
    expect(mutated).not.toBe(css);
    const [lightTheme] = defaultThemeRegistries(mutated);
    const report = checkTokenContrast(THEME_CONTRAST_PAIRS, { tokens: lightTheme!.registry });
    expect(report.ok).toBe(false);
    expect(report.findings.map(finding => finding.pairId)).toEqual(expect.arrayContaining(["foreground/card", "foreground/popover", "foreground/background"]));
  });

  it("reads the same stock pair values the conformance gate measures (shipped fills) as the package default theme", () => {
    const shipped = shippedThemeCss();
    const fallback = defaultThemeCss();
    const variables = [...new Set(THEME_CONTRAST_PAIRS.flatMap(pair => [pair.foreground, pair.background]).filter(property => STOCK_COLOR_BY_PROPERTY.has(property)))];
    for (const [shippedSelector, defaultSelector] of [
      [":root", ":root[data-brand-bound]"],
      [':root:not([data-theme="light"])', ':root[data-brand-bound]:not([data-theme="light"])'],
      [':root[data-theme="dark"]', ':root[data-brand-bound][data-theme="dark"]'],
    ] as const) {
      const a = parseDeclarationsForSelector(shipped, shippedSelector);
      const b = parseDeclarationsForSelector(fallback, defaultSelector);
      for (const property of variables) expect(a.get(property), `${shippedSelector} ${property}`).toBe(b.get(property));
    }
  });
});
