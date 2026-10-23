import type { FillDoc, FillMeta, LibraryData, Resolved, Selection, Source } from "../types.js";

/**
 * Hand-written fixture for the consumer id `example`: one colour ramp (violet 400 and 600),
 * two role colours (accent-color.default aliasing the ramp, surface-color.base as a literal with a dark value)
 * and one typeface (body). Used by tests and by Studio previews. Not a real brand.
 */
export const EXAMPLE_SOURCE: Source = { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" };

const meta = (slot: string, requires: readonly string[], sourceAddress: string): FillMeta => ({
  id: `example/${slot}`, slot, source: "example", mode: "implementation", sourceAddress,
  relation: "subset", builtOn: [], conforms: requires,
  evidence: requires.map((clause) => ({ clause, check: clause === "dtcg#format" ? ("C1" as const) : clause === "dtcg#alias" ? ("C2" as const) : ("C9" as const) })),
  author: "consumer", trust: "consumer", license: "UNLICENSED", status: "draft",
});
const BASE = ["dtcg#format", "dtcg#alias"] as const;
const ROLE = ["dtcg#format", "dtcg#alias", "wcag-2.2#1.4.3"] as const;

const violet600 = { colorSpace: "srgb", components: [0.509804, 0.313725, 0.87451], hex: "#8250DF" } as const;
const violet400 = { colorSpace: "srgb", components: [0.639216, 0.443137, 0.968627], hex: "#A371F7" } as const;
const white = { colorSpace: "srgb", components: [1, 1, 1], hex: "#FFFFFF" } as const;
const ink900 = { colorSpace: "srgb", components: [0.05098, 0.066667, 0.090196], hex: "#0D1117" } as const;

export const EXAMPLE_FILLS: readonly FillDoc[] = [
  {
    $extensions: { "com.clossys.fill": meta("tokens.color-ramp", BASE, "library/fills/tokens.color-ramp.json") },
    tokens: { "color-ramp": { violet: { "400": { $type: "color", $value: violet400 }, "600": { $type: "color", $value: violet600 } } } },
  },
  {
    $extensions: { "com.clossys.fill": meta("tokens.accent-color", ROLE, "library/fills/tokens.accent-color.json") },
    tokens: { "accent-color": { default: {
      $type: "color", $value: "{tokens.color-ramp.violet.600}",
      $extensions: { "com.clossys.modes": { dark: "{tokens.color-ramp.violet.400}" } },
    } } },
  },
  {
    $extensions: { "com.clossys.fill": meta("tokens.surface-color", ROLE, "library/fills/tokens.surface-color.json") },
    tokens: { "surface-color": { base: { $type: "color", $value: white, $extensions: { "com.clossys.modes": { dark: ink900 } } } } },
  },
  {
    $extensions: { "com.clossys.fill": meta("tokens.typeface", BASE, "library/fills/tokens.typeface.json") },
    tokens: { typeface: { body: {
      $type: "fontFamily", $value: ["Inter", "sans-serif"],
      $extensions: { "com.clossys.font": { kind: "fontsource", package: "example-fonts-inter", version: "5.3.0", weights: [400, 600], styles: ["normal"], license: "OFL-1.1" } },
    } } },
  },
];

export const EXAMPLE_LIBRARY: LibraryData = { source: EXAMPLE_SOURCE, fills: EXAMPLE_FILLS };

export const EXAMPLE_SELECTION: Selection = { version: 1, consumer: "example", defaultChain: ["example", "foundry"], picks: [] };

/** Hand-written `Resolved` for EXAMPLE_LIBRARY with EXAMPLE_SELECTION. Keys sorted by code unit. S0-b verifies `selectionHash` against its own implementation. */
export const EXAMPLE_RESOLVED: Resolved = {
  version: 1, consumer: "example", selectionHash: "fnv1a64:03524439ea8d0b8f",
  members: {
    "tokens.accent-color.default": {
      slot: "tokens.accent-color", source: "example", fill: "example/tokens.accent-color", via: "default", $type: "color",
      value: { light: violet600, dark: violet400 }, css: { light: "#8250DF", dark: "#A371F7" },
      alias: { light: "tokens.color-ramp.violet.600", dark: "tokens.color-ramp.violet.400" }, emit: "--color-accent",
    },
    "tokens.color-ramp.violet.400": {
      slot: "tokens.color-ramp", source: "example", fill: "example/tokens.color-ramp", via: "default", $type: "color",
      value: { light: violet400 }, css: { light: "#A371F7" }, alias: {},
    },
    "tokens.color-ramp.violet.600": {
      slot: "tokens.color-ramp", source: "example", fill: "example/tokens.color-ramp", via: "default", $type: "color",
      value: { light: violet600 }, css: { light: "#8250DF" }, alias: {},
    },
    "tokens.surface-color.base": {
      slot: "tokens.surface-color", source: "example", fill: "example/tokens.surface-color", via: "default", $type: "color",
      value: { light: white, dark: ink900 }, css: { light: "#FFFFFF", dark: "#0D1117" }, alias: {}, emit: "--color-surface-base",
    },
    "tokens.typeface.body": {
      slot: "tokens.typeface", source: "example", fill: "example/tokens.typeface", via: "default", $type: "fontFamily",
      value: { light: ["Inter", "sans-serif"] }, css: { light: "\"Inter\", sans-serif" }, alias: {}, emit: "--font-body",
      font: { kind: "fontsource", package: "example-fonts-inter", version: "5.3.0", weights: [400, 600], styles: ["normal"], license: "OFL-1.1" },
    },
  },
  notices: [],
};
