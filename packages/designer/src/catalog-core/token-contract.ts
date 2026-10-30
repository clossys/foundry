import contractDocument from "../catalog/rules/token-contract.json" with { type: "json" };
import rosterDocument from "../catalog/rules/source-roster.json" with { type: "json" };
import type { DtcgToken } from "./types.js";
import { stableStringify } from "./stable.js";

/**
 * The token contract the chosen component library sets (shadcn@aria), and the source roster built on it.
 * Every token leaf maps to a shadcn theme variable, a Tailwind v4 theme key, a shadcn component or style
 * variable, or an extension named by shadcn convention. Display and offer policy only: an entry is never
 * proof of a fill, licence clearance or an executable implementation.
 */
export type ContractKind = "theme" | "tailwind" | "component" | "style" | "extension" | "moved";
export type ContractDecision = "style-default" | "extension" | "moved";
export interface ContractDefault { readonly from: string; readonly token: DtcgToken }
export interface ContractMember {
  readonly kind: ContractKind;
  readonly target: string;
  readonly status: "live" | "dead";
  readonly decision?: ContractDecision;
  /** Copied from today's fill so a later change can retire that fill without losing the value. */
  readonly default?: ContractDefault;
}
export interface ContractLeaf {
  readonly kind?: ContractKind;
  readonly namespace?: string;
  readonly status?: "live" | "dead";
  readonly decision?: ContractDecision;
  readonly target?: string;
  readonly note?: string;
  readonly slot?: string;
  readonly defaults?: Readonly<Record<string, string>>;
  readonly provided?: Readonly<Record<string, readonly string[]>>;
  readonly members?: Readonly<Record<string, ContractMember>>;
}
export interface TokenContract {
  readonly contract: string;
  readonly pin: { readonly url: string; readonly commit: string; readonly scan: string };
  readonly kinds: Readonly<Record<ContractKind, string>>;
  readonly decisions: readonly ContractDecision[];
  readonly leaves: Readonly<Record<string, ContractLeaf>>;
  /** Live shadcn variables with no leaf of their own, filled from the named leaf member. */
  readonly aliases: Readonly<Record<string, string>>;
}

export interface RosterOffer { readonly source: string; readonly leaves: readonly string[]; readonly reason?: string }
/** `starter`: a Foundry scaffold run from the Custom cell; it writes an authored Custom fill and is never an offered seat. */
export interface RosterRow { readonly l2: string; readonly leaves: readonly string[]; readonly offers: readonly RosterOffer[]; readonly starter?: string }
export interface TokenPreset {
  readonly id: string;
  readonly label: string;
  readonly default?: boolean;
  readonly theme: {
    readonly source: string;
    readonly baseColor: string;
    readonly pin: { readonly url: string; readonly commit: string; readonly file: string; readonly sha256: string };
    readonly vars: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
  };
  readonly namespace: { readonly source: string };
}
export type RosterLayer = "components" | "assets" | "sections" | "frames";
export interface SourceRoster {
  readonly order: string;
  readonly custom: { readonly id: "custom"; readonly label: string; readonly position: string; readonly hiddenWhenEmpty: boolean };
  /** Sources that are never offered, whatever fills they ship. */
  readonly never: readonly string[];
  readonly components: readonly RosterRow[];
  readonly assets: readonly RosterRow[];
  readonly sections: readonly RosterRow[];
  readonly frames: readonly RosterRow[];
  readonly tokens: { readonly presets: readonly TokenPreset[]; readonly default: string };
}

export const tokenContract = contractDocument as unknown as TokenContract;
export const sourceRoster = rosterDocument as unknown as SourceRoster;

const ROSTER_LAYERS: readonly RosterLayer[] = ["components", "assets", "sections", "frames"];
const isRosterLayer = (layer: string): layer is RosterLayer => (ROSTER_LAYERS as readonly string[]).includes(layer);

/** The L2 row that holds a slot, or undefined when the roster has no row for it. */
export function rosterRow(roster: SourceRoster, slot: string): RosterRow | undefined {
  const layer = slot.split(".")[0]!;
  return isRosterLayer(layer) ? roster[layer].find(row => row.leaves.includes(slot)) : undefined;
}

/** Offered sources for one slot, in roster order, Custom last. Tokens offer presets, not sources: only Custom here. */
export function rosterOffers(roster: SourceRoster, slot: string): readonly string[] {
  const row = rosterRow(roster, slot);
  const offered = row ? row.offers.filter(offer => offer.leaves.includes(slot)).map(offer => offer.source) : [];
  return [...new Set(offered), roster.custom.id];
}

/** The starter the Custom cell offers for one slot (brand rows: the identity kit), or undefined. */
export function rosterStarter(roster: SourceRoster, slot: string): string | undefined {
  return rosterRow(roster, slot)?.starter;
}

export function defaultPreset(roster: SourceRoster): TokenPreset {
  return roster.tokens.presets.find(preset => preset.id === roster.tokens.default) ?? roster.tokens.presets[0]!;
}

/** One normalized value per mode, so a Custom value and a preset value compare by what they render. */
export interface ModeValues { readonly light: string; readonly dark?: string }
const css = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as { colorSpace?: string; components?: readonly number[]; alpha?: number; unit?: string; value?: number };
    if (record.colorSpace === "oklch" && Array.isArray(record.components)) {
      const body = record.components.map(part => String(Number(part.toFixed(6)))).join(" ");
      return `oklch(${body}${record.alpha !== undefined && record.alpha !== 1 ? ` / ${record.alpha}` : ""})`;
    }
    if (typeof record.value === "number" && typeof record.unit === "string") return `${record.value}${record.unit}`;
  }
  return stableStringify(value);
};
export function tokenModeValues(token: DtcgToken): ModeValues {
  const extensions = (token.$extensions ?? {}) as Record<string, unknown>;
  const raw = (extensions["com.clossys.css"] as { raw?: string } | undefined)?.raw;
  const dark = (extensions["com.clossys.modes"] as { dark?: unknown } | undefined)?.dark;
  return { light: css(raw ?? token.$value), ...(dark !== undefined ? { dark: css(dark) } : {}) };
}

/**
 * A preset's values for one token slot, member by member: theme members from the preset's pinned theme,
 * component, style and extension members from the contract default. Tailwind members are filled by the
 * tailwind-default namespace and are left to that source.
 */
export function presetValues(contract: TokenContract, preset: TokenPreset, slot: string): Readonly<Record<string, ModeValues>> {
  const members = contract.leaves[slot]?.members ?? {};
  const values: Record<string, ModeValues> = {};
  for (const [name, member] of Object.entries(members)) {
    if (member.kind === "theme") {
      const light = preset.theme.vars.light[member.target];
      if (light === undefined) continue;
      const dark = preset.theme.vars.dark[member.target];
      values[name] = { light: css(light), ...(dark !== undefined ? { dark: css(dark) } : {}) };
    } else if (member.default) values[name] = tokenModeValues(member.default.token);
  }
  return values;
}

export type RosterCode = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9";
export interface RosterFinding { readonly code: RosterCode; readonly severity: "error" | "warning"; readonly subject: string; readonly message: string }

/**
 * R7: Custom must differ from what is already offered. A whole slot equal to an offered preset or external
 * is an error (pick that offer instead); a single matching member is a warning.
 */
export function assertCustomDistinct(
  slot: string,
  custom: Readonly<Record<string, DtcgToken>>,
  offered: readonly { readonly source: string; readonly values: Readonly<Record<string, ModeValues>> }[],
): readonly RosterFinding[] {
  const mine = Object.fromEntries(Object.entries(custom).map(([name, token]) => [name, stableStringify(tokenModeValues(token))]));
  const names = Object.keys(mine);
  if (!names.length) return [];
  const findings: RosterFinding[] = [];
  for (const offer of offered) {
    const theirs = Object.fromEntries(Object.entries(offer.values).map(([name, value]) => [name, stableStringify(value)]));
    const same = names.filter(name => theirs[name] !== undefined && theirs[name] === mine[name]);
    if (same.length === names.length && names.length === Object.keys(theirs).length) {
      findings.push({ code: "R7", severity: "error", subject: slot, message: `Custom ${slot} equals ${offer.source}; choose ${offer.source} instead of authoring a copy` });
    } else for (const name of same) {
      findings.push({ code: "R7", severity: "warning", subject: `${slot}.${name}`, message: `Custom ${slot}.${name} equals ${offer.source}` });
    }
  }
  return findings;
}

const BRAND_L2 = new Set(["logo-artwork", "app-identity-browser", "app-identity-application"]);
const ICON_SOURCES = ["lucide", "phosphor"] as const;
const EXTERNAL_LIMIT = 2;
const PRESET_LIMIT = 7;
const GAP_REASON = "no external covers";

export interface RosterCheckInput {
  readonly contract: TokenContract;
  readonly roster: SourceRoster;
  /** Every slot id in the catalog, all layers. */
  readonly slots: readonly string[];
  /** Every fill the catalog ships, as source and slot. */
  readonly fills: readonly { readonly source: string; readonly slot: string }[];
  /** Live shadcn variables found by the contract scan of the pinned upstream source. */
  readonly scannedVars: readonly string[];
}

/** R1–R6 and R9 over the roster and contract. R7 is `assertCustomDistinct`; R8 is `checkBoardColumns`. */
export function checkSourceRoster(input: RosterCheckInput): readonly RosterFinding[] {
  const { contract, roster } = input;
  const findings: RosterFinding[] = [];
  const error = (code: RosterCode, subject: string, message: string) => findings.push({ code, severity: "error", subject, message });
  const fills = new Set(input.fills.map(fill => `${fill.source}\u0000${fill.slot}`));
  const never = new Set(roster.never);

  // R1: every slot resolves to exactly one roster row (tokens: one contract leaf).
  const known = new Set(input.slots);
  for (const slot of input.slots) {
    const layer = slot.split(".")[0]!;
    if (layer === "tokens") { if (!contract.leaves[slot]) error("R1", slot, `${slot} has no token contract leaf`); continue; }
    if (!isRosterLayer(layer)) continue;
    const rows = roster[layer].filter(row => row.leaves.includes(slot));
    if (rows.length !== 1) error("R1", slot, `${slot} resolves to ${rows.length} roster rows`);
  }
  for (const layer of ROSTER_LAYERS) for (const row of roster[layer]) for (const leaf of row.leaves) {
    if (!known.has(leaf)) error("R1", leaf, `roster row ${row.l2} names unknown slot ${leaf}`);
  }

  // R2: at most two externals per component L2, the seven shadcn base-color presets, one default.
  for (const row of roster.components) {
    const externals = row.offers.filter(offer => offer.source !== "foundry");
    if (externals.length > EXTERNAL_LIMIT) error("R2", row.l2, `${row.l2} offers ${externals.length} externals (max ${EXTERNAL_LIMIT})`);
  }
  if (roster.tokens.presets.length > PRESET_LIMIT) error("R2", "tokens", `${roster.tokens.presets.length} token presets (max ${PRESET_LIMIT})`);
  if (!roster.tokens.presets.some(preset => preset.id === roster.tokens.default)) error("R2", "tokens", `default preset ${roster.tokens.default} is not offered`);

  // R3: an offer fills every leaf it claims; Foundry sits only where no external covers the component;
  // a preset fills every live theme key and alias.
  for (const layer of ROSTER_LAYERS) for (const row of roster[layer]) {
    const external = new Set(row.offers.filter(offer => offer.source !== "foundry").flatMap(offer => offer.leaves));
    for (const offer of row.offers) {
      for (const leaf of offer.leaves) {
        if (!row.leaves.includes(leaf)) error("R3", `${row.l2}/${offer.source}`, `${offer.source} offers ${leaf} outside ${row.l2}`);
        if (!fills.has(`${offer.source}\u0000${leaf}`)) error("R3", `${row.l2}/${offer.source}`, `${offer.source} is offered on ${leaf} but ships no fill for it`);
        if (offer.source === "foundry" && external.has(leaf)) error("R3", `${row.l2}/foundry`, `Foundry seat on ${leaf}, which an external already covers`);
      }
      if (offer.source === "foundry" && offer.reason !== GAP_REASON) error("R3", `${row.l2}/foundry`, `Foundry gap seat on ${row.l2} needs reason "${GAP_REASON}"`);
    }
  }
  const themeKeys = Object.values(contract.leaves).flatMap(leaf => Object.values(leaf.members ?? {})).filter(member => member.kind === "theme" && member.status === "live").map(member => member.target);
  for (const preset of roster.tokens.presets) {
    for (const key of new Set(themeKeys)) for (const mode of ["light", "dark"] as const) {
      if (preset.theme.vars[mode][key] === undefined) error("R3", preset.id, `${preset.id} leaves live key ${key} empty in ${mode}`);
    }
    for (const key of Object.keys(contract.aliases)) {
      if (preset.theme.vars.light[key] === undefined) error("R3", preset.id, `${preset.id} leaves alias key ${key} empty`);
    }
    if (preset.namespace.source !== "tailwind-default") error("R3", preset.id, `${preset.id} must compose the tailwind-default namespace keys`);
  }

  // R4: Custom is last and hidden when empty, and never an offer itself.
  if (roster.custom.position !== "last" || !roster.custom.hiddenWhenEmpty) error("R4", "custom", "Custom must be last and hidden when empty");
  for (const layer of ROSTER_LAYERS) for (const row of roster[layer]) {
    if (row.offers.some(offer => offer.source === roster.custom.id)) error("R4", row.l2, `${row.l2} lists Custom as an offer`);
  }

  // R5: icons offer Lucide then Phosphor; brand rows offer nothing (Custom only, with a Generate starter).
  for (const row of roster.assets) {
    const sources = row.offers.map(offer => offer.source);
    if (row.l2.startsWith("icons-") && stableStringify(sources) !== stableStringify(ICON_SOURCES)) error("R5", row.l2, `${row.l2} must offer ${ICON_SOURCES.join(", ")}`);
    if (BRAND_L2.has(row.l2) && sources.length) error("R5", row.l2, `${row.l2} is brand: offers nothing`);
    if (BRAND_L2.has(row.l2) && !row.starter) error("R5", row.l2, `${row.l2} is brand: Custom carries a Generate starter`);
  }

  // R6: never-offered sources.
  for (const required of ["rac-starter", "carbon", "material-3", "fluent", "primer", "bootstrap"]) {
    if (!never.has(required)) error("R6", "never", `${required} must stay on the never-offered list`);
  }
  for (const layer of ROSTER_LAYERS) for (const row of roster[layer]) for (const offer of row.offers) {
    if (never.has(offer.source)) error("R6", row.l2, `${offer.source} is never offered (${row.l2})`);
  }

  // R9: every scanned live variable has a leaf member or alias; every dead member has a decision.
  const targets = new Set(Object.values(contract.leaves).flatMap(leaf => Object.values(leaf.members ?? {})).map(member => member.target));
  for (const name of new Set(input.scannedVars)) {
    if (!targets.has(name) && !(name in contract.aliases)) error("R9", name, `live variable ${name} has no leaf member or alias`);
  }
  for (const [slot, leaf] of Object.entries(contract.leaves)) {
    if (leaf.status === "dead" && !leaf.decision) error("R9", slot, `dead leaf ${slot} has no decision`);
    for (const [name, member] of Object.entries(leaf.members ?? {})) {
      if (member.status === "dead" && !member.decision) error("R9", `${slot}.${name}`, `dead member ${slot}.${name} has no decision`);
      if ((member.kind === "extension" || member.kind === "style" || member.kind === "component") && !member.default) error("R9", `${slot}.${name}`, `${slot}.${name} has no default value`);
    }
  }
  for (const [key, member] of Object.entries(contract.aliases)) {
    const [layer, leaf, ...rest] = member.split(".");
    if (!contract.leaves[`${layer}.${leaf}`]?.members?.[rest.join(".")]) error("R9", key, `alias ${key} points at missing member ${member}`);
  }
  return findings;
}

/** R8: a Board or Matrix shows at most three columns, every one from the roster for the slots it shows. */
export function checkBoardColumns(roster: SourceRoster, slots: readonly string[], columns: readonly string[]): readonly RosterFinding[] {
  const allowed = new Set(slots.flatMap(slot => rosterOffers(roster, slot)));
  const findings: RosterFinding[] = [];
  if (columns.length > 3) findings.push({ code: "R8", severity: "error", subject: slots.join(","), message: `${columns.length} columns (max 3)` });
  for (const column of columns) if (!allowed.has(column)) findings.push({ code: "R8", severity: "error", subject: column, message: `${column} is not on the roster for ${slots.join(", ")}` });
  return findings;
}
