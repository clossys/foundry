/**
 * `derive contract-fixtures --from-references` (foundry-build-0048 U27): the Designer package's
 * `contract.fixture` for every component slot, derived from that slot's adopted reference row and
 * never invented. The reference row is the slot contract's `references` (src/catalog/slot-contracts/
 * components.json, itself derived from references/manifest.json). The fixture names the file that
 * reference ships in the Designer's selected shadcn style, and a component
 * that file exports. The style is the Designer's shadcn flavor (`@clossys/designer/shadcn-flavor`, which
 * also writes packages/designer/ui/components.json and the consumer's clossys/components.json); `ui/` is
 * its own workspace and is not in the packed Designer, so it is never read. Every slot this cannot determine is named in src/catalog/contract-fixture-gaps.json
 * with the reason, never given a fixture that passes vacuously.
 *
 * The same reference index backs the DF.CREATE probe: a live component fixture must name a file and an
 * export that slot's own adopted reference ships in the selected style (`slotReferenceShips`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { DESIGNER_SHADCN_FLAVOR } from "@clossys/designer/shadcn-flavor";
import { CONTRACT_FIXTURE_SCHEMA, type ContractFixture } from "../records/slot-model/contract-fixture.js";
import { BLOCK_FIXTURE_RULES, blockContractProps, blockFixture, blockMount, hasDefaultExport } from "./block-fixtures.js";

/**
 * The derivation's data, in one table (planner decisions, U27 round 2).
 * - `layers`: per Designer catalog layer, whether its contracts determine a fixture, or why not.
 * - `overlays`: component slots whose stock component renders nothing while closed. Their fixture
 *   mounts the reference's own `<Root>Trigger` export opened by `open.prop`, with `open.trigger` as the
 *   pressable child and the reference's `<Root>` as the overlay child, so the mounted fixture renders.
 */
export const REFERENCE_FIXTURE_RULES = {
  layers: {
    components: { determined: true },
    // U28: sections and frames mount their adopted reference's block with DRAFT props (block-fixtures.ts).
    sections: { determined: true },
    frames: { determined: true },
    themes: { determined: false, reason: "a token specimen mounts no component (the element certifier needs no fixture) and the contract declares no props to type one" },
    assets: { determined: false, reason: "an asset specimen mounts no component (the element certifier needs no fixture) and the contract declares no props to type one" },
  },
  overlays: ["components.dialog", "components.popover", "components.sheet", "components.tooltip", "components.dropdown-menu", "components.toast"],
  open: { prop: "defaultOpen", trigger: "react-aria-components.Button", triggerText: "Open", contentText: "Content" },
} as const;

export const GAPS_FILE = "src/catalog/contract-fixture-gaps.json";
export const NO_REFERENCE = "no adopted reference";
const LAYERS = Object.keys(REFERENCE_FIXTURE_RULES.layers) as (keyof typeof REFERENCE_FIXTURE_RULES.layers)[];
/** The layers whose slot contracts carry adopted reference rows. */
const REFERENCE_LAYERS = ["components", "sections", "frames"] as const;
const CODE = /\.(?:tsx|ts|jsx|js)$/;

interface ManifestFile { readonly path: string }
interface ManifestItem { readonly registry: string; readonly name: string; readonly version: string; readonly dir: string; readonly files?: readonly ManifestFile[] }
interface Registry { readonly style?: string; readonly upstream?: string }
interface Manifest { readonly registries: Readonly<Record<string, Registry>>; readonly items: readonly ManifestItem[] }
interface ReferenceRow { readonly registry: string; readonly item: string; readonly version: string }
type Row = { id: string; contract?: Record<string, unknown> } & Record<string, unknown>;

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** `dropdown-menu` gives `DropdownMenu`. */
export const pascal = (name: string) => name.split(/[-.]/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
const repoOf = (upstream: string | undefined) => upstream?.split("@")[0];

/** The value names a module exports (`export { A, type B }`, `export function A`, `export const A`); type-only names are left out. */
export function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1]!.split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      const alias = / as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      names.add(alias ? alias[1]! : part);
    }
  }
  for (const decl of source.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(decl[1]!);
  return [...names].sort();
}

/** The Designer's shadcn style, from the flavor every components.json is written from. */
function flavorStyle(): string {
  const style = DESIGNER_SHADCN_FLAVOR.style;
  if (typeof style !== "string" || !style) throw new Error("@clossys/designer/shadcn-flavor names no style");
  return style;
}

/** The Designer package's adopted references: what each vendored file exports, and the selected style. */
export interface ReferenceIndex {
  readonly style: string;
  readonly manifest: Manifest;
  /** Every vendored code file an adopted reference ships, by its registry path, with its value exports. */
  readonly ships: ReadonlyMap<string, readonly string[]>;
  /** Per manifest item: each code file it ships, by registry path, with that file's value exports. */
  readonly itemShips: ReadonlyMap<ManifestItem, ReadonlyMap<string, readonly string[]>>;
  /** Each component, section and frame slot's reference rows (src/catalog/slot-contracts/<layer>.json). */
  readonly references: ReadonlyMap<string, readonly ReferenceRow[]>;
}

export function referenceIndex(designerRoot: string, style: string = flavorStyle()): ReferenceIndex {
  const manifest = json(join(designerRoot, "references/manifest.json")) as Manifest;
  const ships = new Map<string, string[]>();
  const itemShips = new Map<ManifestItem, Map<string, string[]>>();
  for (const item of manifest.items) for (const file of item.files ?? []) {
    if (!CODE.test(file.path)) continue;
    const path = join(designerRoot, "references", item.dir, file.path);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    // A default export is mounted as `default` (U28: block references such as tailark sections export default).
    const names = [...new Set([...exportedNames(source), ...(hasDefaultExport(source) ? ["default"] : [])])].sort();
    ships.set(file.path, [...new Set([...(ships.get(file.path) ?? []), ...names])].sort());
    if (!itemShips.has(item)) itemShips.set(item, new Map());
    itemShips.get(item)!.set(file.path, names);
  }
  const references = new Map<string, ReferenceRow[]>();
  for (const layer of REFERENCE_LAYERS) {
    const contracts = join(designerRoot, "src/catalog/slot-contracts", `${layer}.json`);
    for (const row of json(contracts) as { slot: string; references?: ReferenceRow[] }[]) references.set(row.slot, row.references ?? []);
  }
  return { style, manifest, ships, itemShips, references };
}

/** Whether an adopted reference ships `file` and it exports `name`. */
export function referenceShips(index: ReferenceIndex, file: string, name: string): boolean {
  return index.ships.get(posix.normalize(file))?.includes(name) ?? false;
}

/**
 * Whether one of `slot`'s own reference rows, in the selected style, ships `file` and it exports `name`.
 * A file some other slot's (or another style's) reference ships does not count.
 */
export function slotReferenceShips(index: ReferenceIndex, slot: string, file: string, name: string): boolean {
  const path = posix.normalize(file);
  return (index.references.get(slot) ?? []).some(row => {
    const item = styled(index, row);
    return !("gap" in item) && (index.itemShips.get(item)?.get(path)?.includes(name) ?? false);
  });
}

/** The manifest item a reference row adopts, in the selected style when its registry family has one. */
function styled(index: ReferenceIndex, row: ReferenceRow): ManifestItem | { gap: string } {
  const item = index.manifest.items.find(entry => entry.registry === row.registry && entry.name === row.item && entry.version === row.version);
  if (!item) return { gap: `reference ${row.registry}/${row.item}@${row.version} is not in references/manifest.json` };
  const registry = index.manifest.registries[row.registry];
  if (!registry?.style || registry.style === index.style) return item;
  const family = Object.entries(index.manifest.registries).find(([, other]) => other.style === index.style && repoOf(other.upstream) !== undefined && repoOf(other.upstream) === repoOf(registry.upstream));
  // A registry with no sibling in the selected style is adopted as its own registry serves it.
  if (!family) return item;
  const restyled = index.manifest.items.find(entry => entry.registry === family[0] && entry.name === row.item);
  return restyled ?? { gap: `${NO_REFERENCE}: ${row.registry}/${row.item} has no ${family[0]} item in style ${index.style}` };
}

/** The fixture one component slot's reference rows determine, or `{ gap }` naming why none. */
export function referenceFixture(index: ReferenceIndex, slot: string, references: readonly ReferenceRow[]): { fixture: ContractFixture; props: readonly string[]; reference: string } | { gap: string } {
  if (!references.length) return { gap: NO_REFERENCE };
  const misses: string[] = [];
  for (const row of references) {
    const item = styled(index, row);
    if ("gap" in item) { misses.push(item.gap); continue; }
    const own = index.itemShips.get(item);
    const code = (item.files ?? []).filter(file => CODE.test(file.path) && own?.has(file.path));
    const main = code.find(file => posix.basename(file.path).replace(CODE, "") === item.name) ?? (code.length === 1 ? code[0] : undefined);
    if (!main) { misses.push(`${item.registry}/${item.name} ships no ${item.name} code file`); continue; }
    const exports = (own!.get(main.path) ?? []).filter(name => /^[A-Z]/.test(name));
    const root = exports.includes(pascal(item.name)) ? pascal(item.name) : exports.length === 1 ? exports[0]! : undefined;
    if (!root) { misses.push(`${main.path} exports no ${pascal(item.name)} and ${exports.length} other components`); continue; }
    const reference = `${item.registry}/${item.name}@${item.version}`;
    const trigger = `${root}Trigger`;
    if ((REFERENCE_FIXTURE_RULES.overlays as readonly string[]).includes(slot) && exports.includes(trigger)) {
      const { prop, trigger: pressable, triggerText, contentText } = REFERENCE_FIXTURE_RULES.open;
      return {
        reference,
        props: ["children", prop],
        fixture: { schema: CONTRACT_FIXTURE_SCHEMA, fixtures: { file: main.path, export: trigger, props: { [prop]: true, children: [{ $component: pressable, children: triggerText }, { $component: root, children: contentText }] } } },
      };
    }
    return { reference, props: [], fixture: { schema: CONTRACT_FIXTURE_SCHEMA, fixtures: { file: main.path, export: root, props: {} } } };
  }
  return { gap: misses.join("; ") };
}

/** The fixture one section or frame slot's reference rows determine (block-fixtures.ts), or `{ gap }` naming why none. */
export function blockReferenceFixture(index: ReferenceIndex, layer: "sections" | "frames", contract: Readonly<Record<string, unknown>>, references: readonly ReferenceRow[], designerRoot: string): { fixture: ContractFixture; props: readonly string[]; reference: string } | { gap: string } {
  if (!references.length) return { gap: NO_REFERENCE };
  const misses: string[] = [];
  for (const row of references) {
    const item = styled(index, row);
    if ("gap" in item) { misses.push(item.gap); continue; }
    const mount = blockMount(designerRoot, item, index.itemShips.get(item));
    if ("gap" in mount) { misses.push(mount.gap); continue; }
    return { reference: `${item.registry}/${item.name}@${item.version}`, props: blockContractProps(layer), fixture: blockFixture(layer, contract, mount) };
  }
  return { gap: misses.join("; ") };
}

/**
 * A fixture that mounts the same file and export as the derived one, sets every prop the derived one
 * sets and says something more (other props or values, inputs, frame) is richer, and is kept.
 */
export function richer(existing: unknown, derived: ContractFixture): boolean {
  if (!object(existing) || !object(existing.fixtures)) return false;
  const fixtures = existing.fixtures;
  if (fixtures.file !== derived.fixtures.file || fixtures.export !== derived.fixtures.export || !object(fixtures.props)) return false;
  const props = fixtures.props;
  return Object.keys(derived.fixtures.props).every(key => key in props) && JSON.stringify(existing) !== JSON.stringify(derived);
}

export interface FixtureGap { readonly slot: string; readonly layer: string; readonly reason: string; readonly source?: "studio" }
export interface ReferenceFixturePlan {
  readonly files: readonly { readonly path: string; readonly before: string; readonly after: string }[];
  readonly fixtures: number;
  readonly kept: number;
  readonly gaps: readonly FixtureGap[];
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * What `--from-references --write` writes: each Designer catalog layer file with every component
 * fixture derived (a richer one naming the same file and export is kept), other layers' fixtures
 * cleared, and the gaps document. `studioSlots` are the Studio publication's Designer slots
 * (Producer package data): listed as gaps, never written.
 */
export function planReferenceFixtures(designerRoot: string, studioSlots: readonly { id: string; contract?: Record<string, unknown> }[] = []): ReferenceFixturePlan {
  const index = referenceIndex(designerRoot);
  const references = index.references;
  const retiredPath = join(designerRoot, "src/catalog/retired.json");
  const retired = new Set(existsSync(retiredPath) ? (json(retiredPath) as { id: string }[]).map(entry => entry.id) : []);
  const files: { path: string; before: string; after: string }[] = [];
  const gaps: FixtureGap[] = [];
  let fixtures = 0, kept = 0;
  for (const layer of LAYERS) {
    const path = join(designerRoot, "src/catalog/slots", `${layer}.json`);
    const before = readFileSync(path, "utf8");
    const rows = JSON.parse(before) as Row[];
    const rule = REFERENCE_FIXTURE_RULES.layers[layer];
    for (const slot of rows) {
      const contract = { ...(slot.contract ?? {}) };
      const existing = contract.fixture;
      delete contract.fixture;
      if (layer === "sections" || layer === "frames") {
        // U28: a block's props are its contract's (DRAFT copy, region placeholders); it declares no props list of its own.
        delete contract.props;
        const block = retired.has(slot.id) ? { gap: BLOCK_FIXTURE_RULES.retired } : blockReferenceFixture(index, layer, contract, references.get(slot.id) ?? [], designerRoot);
        if ("gap" in block) { gaps.push({ slot: slot.id, layer, reason: block.gap }); slot.contract = contract; continue; }
        contract.props = [...block.props];
        contract.fixture = block.fixture;
        fixtures++;
        slot.contract = contract;
        continue;
      }
      const result = rule.determined ? referenceFixture(index, slot.id, references.get(slot.id) ?? []) : { gap: rule.reason };
      if ("gap" in result) { gaps.push({ slot: slot.id, layer, reason: result.gap }); slot.contract = contract; continue; }
      if (!Array.isArray(contract.props)) { gaps.push({ slot: slot.id, layer, reason: "the contract declares no props list, so no typed fixture can be written" }); slot.contract = contract; continue; }
      const keep = richer(existing, result.fixture);
      const fixture = keep ? existing as ContractFixture : result.fixture;
      // Mount-only props type the fixture but are never required of a candidate (K1 reads contract.props only).
      const required = contract.props as string[];
      const mountOnly = [...new Set([...result.props, ...Object.keys(fixture.fixtures.props)])].filter(key => !required.includes(key)).sort();
      delete contract.fixtureProps;
      if (mountOnly.length) contract.fixtureProps = mountOnly;
      contract.fixture = fixture;
      if (keep) kept++;
      fixtures++;
      slot.contract = contract;
    }
    files.push({ path, before, after: text(rows) });
  }
  for (const slot of studioSlots) {
    const layer = slot.id.split(".")[0]!;
    const install = object(slot.contract?.install) ? slot.contract!.install as Record<string, unknown> : undefined;
    gaps.push({ slot: slot.id, layer, source: "studio", reason: install ? `the contract installs its own file (${String(install.layer ?? "?")} ${String(install.alias ?? "?")}/${String(install.file ?? "?")}), which no adopted reference ships` : "Producer package data (studio-defaults/designer-slots.json): derived by no reference row" });
  }
  const gapsPath = join(designerRoot, GAPS_FILE);
  const doc = {
    note: "Designer slots whose contract determines no contract.fixture. Generated by packages/producer/scripts/derive-contract-fixtures.mjs --from-references --write; do not edit.",
    style: index.style,
    rules: REFERENCE_FIXTURE_RULES,
    fixtures,
    gaps,
  };
  files.push({ path: gapsPath, before: existsSync(gapsPath) ? readFileSync(gapsPath, "utf8") : "", after: text(doc) });
  return { files, fixtures, kept, gaps };
}
