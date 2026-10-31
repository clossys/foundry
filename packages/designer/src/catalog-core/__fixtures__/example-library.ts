import type { FillDoc, FillMeta, LibraryData, Resolved, LegacySelection, Source } from "../types.js";

/**
 * Hand-written fixture for the consumer id `example`: two theme colours (primary violet 600 with a
 * violet 400 dark value, background as a literal with a dark value) and one sans font.
 * Used by tests and by Studio previews. Not a real brand.
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
    $extensions: { "com.clossys.fill": meta("themes.primary", ROLE, "library/fills/themes.primary.json") },
    themes: { primary: { default: { $type: "color", $value: violet600, $extensions: { "com.clossys.modes": { dark: violet400 } } } } },
  },
  {
    $extensions: { "com.clossys.fill": meta("themes.background", ROLE, "library/fills/themes.background.json") },
    themes: { background: { default: { $type: "color", $value: white, $extensions: { "com.clossys.modes": { dark: ink900 } } } } },
  },
  {
    $extensions: { "com.clossys.fill": meta("themes.font-sans", BASE, "library/fills/themes.font-sans.json") },
    themes: { "font-sans": { default: {
      $type: "fontFamily", $value: ["Inter", "sans-serif"],
      $extensions: { "com.clossys.font": { kind: "fontsource", package: "example-fonts-inter", version: "5.3.0", weights: [400, 600], styles: ["normal"], license: "OFL-1.1" } },
    } } },
  },
];

export const EXAMPLE_LIBRARY: LibraryData = { source: EXAMPLE_SOURCE, fills: EXAMPLE_FILLS };

export const EXAMPLE_SELECTION: LegacySelection = { version: 1, consumer: "example", defaultChain: ["example", "foundry"], picks: [] };

/** Hand-written `Resolved` for EXAMPLE_LIBRARY with EXAMPLE_SELECTION. Keys sorted by code unit. S0-b verifies `selectionHash` against its own implementation. */
export const EXAMPLE_RESOLVED: Resolved = {
  version: 1, consumer: "example", selectionHash: "fnv1a64:03524439ea8d0b8f",
  members: {
    "themes.background.default": {
      slot: "themes.background", source: "example", fill: "example/themes.background", via: "default", $type: "color",
      value: { light: white, dark: ink900 }, css: { light: "#FFFFFF", dark: "#0D1117" }, alias: {}, emit: "--background",
    },
    "themes.font-sans.default": {
      slot: "themes.font-sans", source: "example", fill: "example/themes.font-sans", via: "default", $type: "fontFamily",
      value: { light: ["Inter", "sans-serif"] }, css: { light: "\"Inter\", sans-serif" }, alias: {}, emit: "--font-sans",
      font: { kind: "fontsource", package: "example-fonts-inter", version: "5.3.0", weights: [400, 600], styles: ["normal"], license: "OFL-1.1" },
    },
    "themes.primary.default": {
      slot: "themes.primary", source: "example", fill: "example/themes.primary", via: "default", $type: "color",
      value: { light: violet600, dark: violet400 }, css: { light: "#8250DF", dark: "#A371F7" },
      alias: {}, emit: "--primary",
    },
  },
  notices: [],
};
