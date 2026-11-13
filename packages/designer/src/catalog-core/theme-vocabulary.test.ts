import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { SHADCN_KEYS_BEGIN, SHADCN_KEYS_END } from "../compiled-css/shadcn-theme-keys.js";
import { STOCK_COLOR_BY_PROPERTY, STOCK_COLOR_KEYS, THEME_CONTRAST_PAIRS, shippedThemeCss } from "./theme-vocabulary.js";

const themeKeys = readFileSync(resolve(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
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
    const generated = new Map([...region.matchAll(/^\s*(--color-[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);/gm)].map(match => [match[1]!, match[2]!]));
    expect(new Map([...STOCK_COLOR_KEYS].map(([key, entry]) => [key, entry.property]))).toEqual(generated);
    const inline = parseDeclarationsForSelector(themeKeys, "@theme inline");
    for (const entry of STOCK_COLOR_KEYS.values()) expect(inline.get(entry.key), entry.key).toBe(`var(${entry.property})`);
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
});
