import type { CatalogData, DtcgToken, DtcgType, DtcgValue, FillDoc, FillMeta, LibraryData, Placement, Selection, Slot, Source, Tier } from "../catalog-core/index.js";

/**
 * Throwaway demo data for the Studio first look. It is a small stand-in catalog (ten leaves, four sources, one placement file)
 * that exists only until the shipped catalog and the real engine replace it. It never imports from a
 * fixtures folder: test fixtures are not part of what a published install may depend on. The consumer id is `example`.
 */

type Leaf = readonly [relative: string, token: DtcgToken];
interface Tree { [key: string]: Tree | DtcgToken }

const rgb = (hex: string): DtcgValue => {
  const part = (at: number): number => Math.round((parseInt(hex.slice(at, at + 2), 16) / 255) * 1e6) / 1e6;
  return { colorSpace: "srgb", components: [part(1), part(3), part(5)], hex };
};
const tok = ($type: DtcgType, $value: DtcgValue, dark?: DtcgValue, extensions?: DtcgToken["$extensions"]): DtcgToken => ({
  $type, $value, ...(dark !== undefined || extensions ? { $extensions: { ...extensions, ...(dark !== undefined ? { "com.clossys.modes": { dark } } : {}) } } : {}),
});
const color = (light: string, dark?: string): DtcgToken => tok("color", rgb(light), dark === undefined ? undefined : rgb(dark));
const alias = (target: string, dark?: string): DtcgToken => tok("color", `{${target}}`, dark === undefined ? undefined : `{${dark}}`);
const px = (value: number, extensions?: DtcgToken["$extensions"]): DtcgToken => tok("dimension", { value, unit: "px" }, undefined, extensions);
const rem = (value: number): DtcgToken => tok("dimension", { value, unit: "rem" });
const ms = (value: number): DtcgToken => tok("duration", { value, unit: "ms" });
const bezier = (a: number, b: number, c: number, d: number): DtcgToken => tok("cubicBezier", [a, b, c, d]);
const num = (value: number): DtcgToken => tok("number", value);
const family = (names: readonly string[], payload?: DtcgToken["$extensions"]): DtcgToken => tok("fontFamily", names, undefined, payload);
const font = (name: string, weights: readonly number[]): DtcgToken["$extensions"] => ({
  "com.clossys.font": { kind: "fontsource", package: `example-fonts-${name}`, version: "1.0.0", weights, styles: ["normal"], license: "OFL-1.1" },
});

const A = "tokens.accent-color";
const S = "tokens.surface-color";
const R = "tokens.color-ramp";
const F = "tokens.typeface";
const L = "tokens.line-height";
const P = "tokens.spacing";
const C = "tokens.region-width";
const D = "tokens.duration";
const E = "tokens.easing";
/** A draft leaf with no fill from any source: it drives the empty state and the node expansion that skips it. */
const FS = "tokens.font-size";

const slot = (id: string, tier: Tier, $type: DtcgType, names: readonly string[], emits: readonly string[], dark: boolean, requires: readonly string[]): Slot => ({
  id, layer: "tokens", requires, status: "draft",
  contract: {
    kind: "token", tier, $type, members: { mode: "closed", names }, modes: dark ? ["light", "dark"] : ["light"],
    ...(emits.length > 0 ? { emit: Object.fromEntries(names.map((name, at) => [name, emits[at] as `--${string}`])) } : {}),
  },
});
const BASE = ["dtcg#format", "dtcg#alias"];
const ROLE = [...BASE, "wcag-2.2#1.4.3"];
export const DEMO_SLOTS: readonly Slot[] = [
  slot(A, "role", "color", ["default", "hover"], ["--color-accent", "--color-accent-hover"], true, ROLE),
  slot(S, "role", "color", ["base", "raised"], ["--color-surface-base", "--color-surface-raised"], true, ROLE),
  slot(R, "scale", "color", ["slate.500", "violet.400", "violet.600"], [], false, BASE),
  slot(F, "role", "fontFamily", ["body", "display", "mono"], ["--font-body", "--font-display", "--font-mono"], false, BASE),
  slot(L, "scale", "number", ["body", "tight"], [], false, BASE),
  slot(P, "scale", "dimension", ["lg", "md", "sm"], ["--spacing-lg", "--spacing-md", "--spacing-sm"], false, BASE),
  slot(C, "role", "dimension", ["narrow", "wide"], [], false, BASE),
  slot(D, "scale", "duration", ["base", "fast"], [], false, BASE),
  slot(E, "scale", "cubicBezier", ["emphasized", "standard"], ["--ease-decelerate", "--ease-default"], false, BASE),
  {
    id: FS, layer: "tokens", requires: BASE, status: "draft",
    contract: { kind: "token", tier: "scale", $type: "dimension", members: { mode: "open", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }, modes: ["light"] },
  },
];

/** The demo's placement file, with the shipped node ids and labels. Each leaf is placed once; the tree is built from this and from no id. */
export const DEMO_PLACEMENTS: readonly Placement[] = [{
  layer: "tokens",
  nodes: [
    { id: "scale", label: "Scale", children: [
      { id: "scale-color", label: "Color", leaves: [R] },
      { id: "scale-type", label: "Type", leaves: [FS, L] },
      { id: "scale-space", label: "Space", leaves: [P] },
      { id: "scale-motion", label: "Motion", leaves: [D, E] },
    ] },
    { id: "role", label: "Role", children: [
      { id: "role-color", label: "Color", leaves: [S, A] },
      { id: "role-type", label: "Type", leaves: [F] },
      { id: "role-space", label: "Space", leaves: [C] },
    ] },
  ],
}];

export const DEMO_FOUNDRY: Source = { id: "foundry", kind: "base", author: "foundry", license: "MIT" };
export const DEMO_TAILWIND: Source = { id: "tailwind-default", kind: "external", author: "third-party", license: "MIT", pin: { package: "tailwindcss", version: "4.0.0" } };
export const DEMO_REFERENCE: Source = { id: "reference-kit", kind: "external", author: "third-party", license: "MIT", pin: { package: "reference-kit", version: "1.0.0" } };
export const DEMO_EXAMPLE: Source = { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" };

const nest = (slotId: string, leaves: readonly Leaf[]): FillDoc["tokens"] => {
  const root: Tree = {};
  for (const [relative, token] of leaves) {
    const path = [slotId.split(".")[1] as string, ...relative.split(".")];
    let node = root;
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Tree;
    node[path[path.length - 1] as string] = token;
  }
  return root as FillDoc["tokens"];
};
const fill = (source: Source, slotId: string, leaves: readonly Leaf[], mode: FillMeta["mode"] = "implementation"): FillDoc => {
  const requires = DEMO_SLOTS.find((entry) => entry.id === slotId)?.requires ?? [];
  const meta: FillMeta = {
    id: `${source.id}/${slotId}`, slot: slotId, source: source.id, mode, sourceAddress: `demo/${source.id}/${slotId}.json`,
    relation: source.kind === "external" ? "subset" : "same-contract", builtOn: [], conforms: requires,
    evidence: requires.map((clause) => ({ clause, check: "C1" as const })),
    author: source.author, trust: source.kind === "base" ? "foundry" : source.kind === "consumer" ? "consumer" : "pinned-upstream",
    license: source.license, ...(source.pin ? { pin: source.pin } : {}), status: "draft",
  };
  return { $extensions: { "com.clossys.fill": meta }, tokens: nest(slotId, leaves) };
};

const FOUNDRY_FILLS: readonly FillDoc[] = [
  fill(DEMO_FOUNDRY, A, [["default", color("#4D4D4D", "#D4D4D4")], ["hover", color("#333333", "#FFFFFF")]]),
  fill(DEMO_FOUNDRY, S, [["base", color("#F7F7F7", "#111111")], ["raised", color("#FFFFFF", "#1C1C1C")]]),
  fill(DEMO_FOUNDRY, R, [["slate.500", color("#64748B")], ["violet.400", color("#A78BFA")], ["violet.600", color("#7C3AED")]]),
  fill(DEMO_FOUNDRY, F, [["body", family(["system-ui", "sans-serif"])], ["display", family(["system-ui", "sans-serif"])], ["mono", family(["ui-monospace", "monospace"])]]),
  fill(DEMO_FOUNDRY, L, [["body", num(1.5)], ["tight", num(1.2)]]),
  fill(DEMO_FOUNDRY, P, [["lg", px(16)], ["md", px(12)], ["sm", px(8)]]),
  fill(DEMO_FOUNDRY, C, [["narrow", px(640)], ["wide", px(1024)]]),
  fill(DEMO_FOUNDRY, D, [["base", ms(200)], ["fast", ms(100)]]),
  fill(DEMO_FOUNDRY, E, [["emphasized", bezier(0, 0, 0.2, 1)], ["standard", bezier(0.2, 0, 0, 1)]]),
];
const EXTERNAL_FILLS: readonly FillDoc[] = [
  fill(DEMO_TAILWIND, R, [["slate.500", color("#62748E")], ["violet.400", color("#A684FF")], ["violet.600", color("#7F22FE")]]),
  fill(DEMO_TAILWIND, P, [["lg", rem(1)], ["md", rem(0.75)], ["sm", rem(0.5)]]),
  // Deliberately unsafe: its raw CSS text smuggles a rule. The card must report the error and refuse the pick.
  fill(DEMO_TAILWIND, C, [["narrow", px(640, { "com.clossys.css": { raw: "640px; } body { display: none" } })], ["wide", px(1024)]]),
  fill(DEMO_REFERENCE, A, [["default", color("#0EA5E9", "#7DD3FC")], ["hover", color("#0284C7", "#BAE6FD")]], "reference"),
];

export const DEMO_CATALOG: CatalogData = {
  slots: DEMO_SLOTS, standards: [], sources: [DEMO_FOUNDRY, DEMO_TAILWIND, DEMO_REFERENCE], fills: [...FOUNDRY_FILLS, ...EXTERNAL_FILLS],
  placements: DEMO_PLACEMENTS, retired: [],
};
export const DEMO_LIBRARY: LibraryData = {
  source: DEMO_EXAMPLE,
  fills: [
    fill(DEMO_EXAMPLE, A, [["default", alias(`${R}.violet.600`, `${R}.violet.400`)], ["hover", color("#6D3FC8", "#B79CF7")]]),
    fill(DEMO_EXAMPLE, S, [["base", color("#FFFFFF", "#0D1117")], ["raised", color("#F6F8FA", "#161B22")]]),
    fill(DEMO_EXAMPLE, R, [["slate.500", color("#6E7781")], ["violet.400", color("#A371F7")], ["violet.600", color("#8250DF")]]),
    fill(DEMO_EXAMPLE, F, [["body", family(["Inter", "sans-serif"], font("inter", [400, 600]))], ["display", family(["Inter", "sans-serif"], font("inter", [400, 600]))], ["mono", family(["JetBrains Mono", "monospace"], font("jetbrains-mono", [400]))]]),
  ],
};
export const DEMO_SELECTION: Selection = { version: 1, consumer: "example", defaultChain: ["example", "foundry"], picks: [] };
