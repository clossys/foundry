/**
 * The stock shadcn colour vocabulary, read from the themes leaves.
 *
 * Every themes colour slot (`src/catalog/slots/themes.json`) emits one shadcn
 * theme variable (`--primary`, `--accent`, `--border`, `--chart-1` ...), and
 * `styles/theme-keys.css` wires it to the stock utility key
 * `--color-<leaf>: var(--<leaf>)` in its generated region. A utility such as
 * `bg-primary` or `outline-ring` therefore paints the themes variable, never a
 * Foundry `--color-*` token of the same name. This module is that map, derived
 * from the leaf data rather than listed by hand, so a themes leaf added or
 * removed changes the vocabulary with it.
 *
 * The shipped values are the themes fills the catalog ships (one fill per themes
 * slot), emitted through the real `css-brand` pipeline with the unscoped scale
 * selectors, so a check resolving a stock variable reads the same light, OS dark
 * and explicit dark values a consumer binding the default brand receives.
 */
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { AA_LARGE, type ContrastPair } from "../tokens/contrast-pairs.js";
import { THEME_OUTPUT_BY_PROPERTY } from "./emit.js";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve, type LibraryData } from "./index.js";

export interface StockColorKey {
  /** The Tailwind utility key, e.g. `--color-primary` (what `bg-primary` reads). */
  readonly key: string;
  /** The themes variable the key reads, e.g. `--primary`. */
  readonly property: string;
  /** The themes leaf that emits `property`, e.g. `themes.primary`. */
  readonly leaf: string;
  /** Whether the leaf declares a dark mode value. */
  readonly themeDependent: boolean;
}

interface ThemesSlot { id: string; contract: { $type?: string; emit?: Readonly<Record<string, string | undefined>> } }

/** Utility key (`--color-<leaf>`) to the themes variable it reads, for every themes colour leaf. */
export const STOCK_COLOR_KEYS: ReadonlyMap<string, StockColorKey> = new Map((themeSlots as readonly ThemesSlot[])
  .filter(slot => slot.contract.$type === "color")
  .map(slot => {
    const property = slot.contract.emit?.default;
    if (!property || !/^--[a-z][a-z0-9-]*$/.test(property)) throw new Error(`${slot.id}: a themes colour leaf emits no single default variable`);
    const output = THEME_OUTPUT_BY_PROPERTY.get(property);
    if (!output) throw new Error(`${slot.id}: ${property} is not a shipped theme output`);
    const key = `--color-${property.slice(2)}`;
    return [key, { key, property, leaf: slot.id, themeDependent: output.themeDependent }] as const;
  }));

/** Themes variable (`--primary`) to its stock key entry. */
export const STOCK_COLOR_BY_PROPERTY: ReadonlyMap<string, StockColorKey> = new Map([...STOCK_COLOR_KEYS.values()].map(entry => [entry.property, entry]));

/**
 * Contrast pairs whose foreground or background is a themes variable. They are
 * checked against the shipped themes values (see `shippedThemeCss`), not
 * `styles/tokens.css`, which declares no themes variable; that is why they are
 * not members of the Foundry token gate's `CONTRAST_PAIRS`.
 */
export const THEME_CONTRAST_PAIRS: readonly ContrastPair[] = [{
  id: "focus-outline/primary/surface-raised",
  foreground: "--primary",
  background: "--color-surface-raised",
  level: "AA-large",
  minimumRatio: AA_LARGE,
  description: "Stock focus outline (`outline-primary`, themes.primary) against the raised plate it surrounds (non-text 3:1).",
}];

const SCALE_SELECTORS = { light: ":root", mediaDark: '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])', dark: ':root[data-theme="dark"]' };

let shipped: string | undefined;
/** The shipped themes fills' colour and radius variables, as unscoped light / OS dark / explicit dark CSS. */
export function shippedThemeCss(): string {
  if (shipped !== undefined) return shipped;
  const catalog = loadCatalog();
  let library: LibraryData = { source: { id: "theme-vocabulary", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" }, fills: [], adoptedAt: "2026-11-06" };
  const changes = catalog.fills.map(fill => fill.$extensions["com.clossys.fill"]).filter(meta => meta.slot.startsWith("themes.")).map(meta => ({ op: "adopt" as const, slot: meta.slot, source: meta.source }));
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes });
  shipped = emit(resolve({ catalog, library }), ["css-brand"], { full: true, header: false, selectors: SCALE_SELECTORS }).map(file => file.contents).join("\n");
  return shipped;
}
