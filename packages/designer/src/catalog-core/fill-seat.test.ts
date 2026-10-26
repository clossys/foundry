import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rosterOffers, rosterRow, rosterStarter, sourceRoster, type SourceRoster } from "./token-contract.js";

/**
 * C10 fill-seat: every fill on disk belongs to a source the roster offers for its slot (tokens: a preset's
 * theme or namespace source), or carries a pending-replacement record naming why it still ships. A fill
 * that loses its seat is deleted; one that something still reads waits here until its replacement lands.
 */
const fillsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills");

const ENGINE = "the engine catalog (catalog-core/index.ts) still loads it and resolve has no contract-default fallback";
const U4_TAIL = "its L2 is not fully covered by shadcn@aria; waits for the component tail";
const PRESET_FOLD = "token rows offer presets only; this external token fill waits for its preset fold-in";
const GENERATED = "shadcn@aria covers its L2 in full, but the Foundry component generator (importers/foundry-components) still emits and pins it; deleting it needs the generator to skip covered leaves";
const NEVER = "never-offered reference fill (R6); kept as importer evidence, not a seat";
const pendingFamilies: Readonly<Record<string, string>> = {
  "foundry/tokens.": ENGINE,
  "foundry-baseline/tokens.": ENGINE,
  "radix-colors/tokens.": PRESET_FOLD,
  "carbon-colors/tokens.": PRESET_FOLD,
  "lucide/tokens.": PRESET_FOLD,
  "rac-starter/components.": NEVER,
};
/** Leaves on L2s shadcn@aria covers in full whose Foundry fill still ships. */
const COVERED_IN_FULL = ["avatar", "badge", "checkbox", "combo-box", "dialog", "menu", "popover", "radio-group", "select", "switch", "tabs", "toggle-group", "tooltip"];
/** Single fills pending replacement, by fill id, with the reason they still ship. */
export const PENDING_REPLACEMENT: Readonly<Record<string, string>> = {
  "foundry/assets.image-ratio": "waits for Open Props (SF14-A); the Foundry fill stays until then",
  ...Object.fromEntries(["banner", "breadcrumbs", "button", "calendar", "card", "chart-area", "chart-bar", "chart-line", "disclosure", "progress-bar", "separator", "skeleton", "slider", "table", "toggle-button"]
    .map(leaf => [`foundry/components.${leaf}`, U4_TAIL])),
  ...Object.fromEntries(COVERED_IN_FULL.map(leaf => [`foundry/components.${leaf}`, GENERATED])),
};

interface DiskFill { readonly id: string; readonly source: string; readonly slot: string }
export function diskFills(root = fillsRoot): readonly DiskFill[] {
  const fills: DiskFill[] = [];
  for (const directory of readdirSync(root).sort()) for (const name of readdirSync(resolve(root, directory)).sort()) {
    if (!name.endsWith(".json")) continue;
    const meta = (JSON.parse(readFileSync(resolve(root, directory, name), "utf8")) as { $extensions?: { "com.clossys.fill"?: DiskFill } }).$extensions?.["com.clossys.fill"];
    if (meta) fills.push({ id: meta.id, source: meta.source, slot: meta.slot });
  }
  return fills;
}

export function pendingReason(fill: DiskFill): string | undefined {
  return PENDING_REPLACEMENT[fill.id] ?? Object.entries(pendingFamilies).find(([prefix]) => fill.id.startsWith(prefix))?.[1];
}

/** Fills with neither a seat nor a pending-replacement record. */
export function unseatedFills(fills: readonly DiskFill[], roster: SourceRoster = sourceRoster): readonly string[] {
  const tokenSources = new Set(roster.tokens.presets.flatMap(preset => [preset.theme.source, preset.namespace.source]));
  const seated = (fill: DiskFill) => fill.slot.startsWith("tokens.") ? tokenSources.has(fill.source) : rosterOffers(roster, fill.slot).includes(fill.source);
  return fills.filter(fill => !seated(fill) && pendingReason(fill) === undefined).map(fill => fill.id).sort();
}

const BRAND = ["assets.lockup", "assets.mark", "assets.favicon", "assets.app-icon"];

describe("C10 fill seats", () => {
  const fills = diskFills();

  it("every fill on disk has a seat or a pending-replacement record", () => {
    expect(fills.length).toBeGreaterThan(100);
    expect(unseatedFills(fills)).toEqual([]);
  });

  it("flags a fill that lost its seat and has no record", () => {
    expect(unseatedFills([...fills, { id: "foundry/assets.lockup", source: "foundry", slot: "assets.lockup" }])).toEqual(["foundry/assets.lockup"]);
    expect(unseatedFills([...fills, { id: "foundry/components.keyboard", source: "foundry", slot: "components.keyboard" }])).toEqual(["foundry/components.keyboard"]);
  });

  it("names only pending records that still ship", () => {
    const ids = new Set(fills.map(fill => fill.id));
    expect(Object.keys(PENDING_REPLACEMENT).filter(id => !ids.has(id))).toEqual([]);
  });

  it("brand rows offer nothing, ship no fill and carry the identity-kit starter", () => {
    for (const slot of BRAND) {
      expect(rosterRow(sourceRoster, slot), slot).toBeDefined();
      expect(rosterOffers(sourceRoster, slot), slot).toEqual(["custom"]);
      expect(rosterStarter(sourceRoster, slot), slot).toBe("identity-kit");
      expect(fills.filter(fill => fill.slot === slot).map(fill => fill.id), slot).toEqual([]);
    }
  });

  it("a Foundry component fill on an L2 shadcn@aria covers in full ships only with its pending record", () => {
    const full = sourceRoster.components.filter(row => row.offers.length > 0 && row.offers.every(offer => offer.source === "shadcn@aria")
      && row.leaves.every(leaf => row.offers.some(offer => offer.leaves.includes(leaf))));
    expect(full.length).toBeGreaterThan(0);
    const leaves = new Set(full.flatMap(row => row.leaves));
    const shipped = fills.filter(fill => fill.source === "foundry" && leaves.has(fill.slot)).map(fill => fill.id).sort();
    expect(shipped).toEqual(COVERED_IN_FULL.map(leaf => `foundry/components.${leaf}`).filter(id => shipped.includes(id)));
    for (const id of shipped) expect(PENDING_REPLACEMENT[id], id).toBe(GENERATED);
  });
});
