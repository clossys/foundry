#!/usr/bin/env node
/**
 * Contract fixtures (foundry-build-0048 U27): derives `contract.fixture` for every Designer catalog
 * slot whose contract determines one, from the contract and the shadcn registry layout only, and
 * names every slot it cannot determine with the reason. Never hand-written, never a faked pass.
 *
 * A fixture is the slot's `clossys.element-preview/1` preview (producer records/slot-model/contract-fixture.ts):
 * the file a candidate ships, the component it exports and the props it is certified with. Its props are
 * typed by `contract.props`, so the minimal fixture mounts with no props at all.
 *
 *   node scripts/generate-contract-fixtures.mjs           # writes src/catalog/slots/<layer>.json and the gaps file
 *   node scripts/generate-contract-fixtures.mjs --check   # exit 1 when either differs from what it would write
 *
 * Consumers receive the package fixtures through `clossys ia sync` (the package contract), never by hand.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_SCHEMA = "clossys.element-preview/1";

/**
 * The one convention table (planner decision, U27): per Designer layer, where a candidate's mounted file
 * lives in the shadcn registry layout and how its export is named, or why the contract determines no fixture.
 * `ui` for components (create.component craft: one `registry:ui` item), `blocks` for sections and frames
 * (the package defaults: registry/default/blocks/<name>.tsx). Export: PascalCase of `<name>` plus `exportSuffix`;
 * the frames default exports `DeckFrame` for frames.deck, so frames carry the `Frame` suffix.
 */
export const CONVENTION = {
  components: { determined: true, dir: "ui", exportSuffix: "" },
  sections: {
    determined: false, dir: "blocks", exportSuffix: "",
    reason: "the contract declares no props list, so no typed fixture can be written; the section mounts with copy and region slots whose Writer keys and parts the contract does not name",
  },
  frames: {
    determined: false, dir: "blocks", exportSuffix: "Frame",
    reason: "the contract declares no props list, so no typed fixture can be written; the frame mounts with region slots and copy the contract does not name",
  },
  themes: {
    determined: false,
    reason: "a token specimen mounts no component (the element certifier needs no fixture) and the contract declares no props to type one",
  },
  assets: {
    determined: false,
    reason: "an asset specimen mounts no component (the element certifier needs no fixture) and the contract declares no props to type one",
  },
};

export const LAYERS = Object.keys(CONVENTION);
const here = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(here, "..");
export const GAPS_FILE = "src/catalog/contract-fixture-gaps.json";
/** The Designer slots the Studio publication defines on top of the catalog (Producer package data, read only here). */
export const STUDIO_SLOTS_FILE = "../producer/src/studio-defaults/designer-slots.json";

/** `dropdown-menu` gives `DropdownMenu`. */
export const pascal = name => name.split(/[-.]/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join("");

/** The fixture a slot's contract determines under the convention, or `{gap}` naming why it determines none. */
export function fixtureFor(slot, layer) {
  const rule = CONVENTION[layer];
  if (!rule) return { gap: `layer ${layer} has no convention row` };
  if (!slot.id.startsWith(`${layer}.`)) return { gap: `slot ${slot.id} is not in layer ${layer}` };
  if (!rule.determined) return { gap: rule.reason };
  const contract = slot.contract ?? {};
  if (contract.install && typeof contract.install === "object") return { gap: `the contract installs its own file (${contract.install.layer ?? "?"} ${contract.install.alias ?? "?"}/${contract.install.file ?? "?"}), outside the shadcn registry convention, so the convention determines no candidate file` };
  if (!Array.isArray(contract.props)) return { gap: "the contract declares no props list, so no typed fixture can be written" };
  const name = slot.id.slice(layer.length + 1);
  return { fixture: { schema: FIXTURE_SCHEMA, fixtures: { file: `registry/default/${rule.dir}/${name}.tsx`, export: `${pascal(name)}${rule.exportSuffix}`, props: {} } } };
}

const json = value => `${JSON.stringify(value, null, 2)}\n`;

/** What the generator would write: every layer file with fixtures set or cleared, and the gaps document. */
export function plan(root = PACKAGE_ROOT) {
  const files = [];
  const gaps = [];
  let fixtures = 0;
  for (const layer of LAYERS) {
    const path = join(root, "src/catalog/slots", `${layer}.json`);
    const before = readFileSync(path, "utf8");
    const rows = JSON.parse(before);
    for (const slot of rows) {
      const result = fixtureFor(slot, layer);
      const contract = { ...(slot.contract ?? {}) };
      delete contract.fixture;
      if (result.fixture) { contract.fixture = result.fixture; fixtures++; } else gaps.push({ slot: slot.id, layer, reason: result.gap });
      slot.contract = contract;
    }
    files.push({ path, before, after: json(rows) });
  }
  // Studio slots are Producer package data: named here when their contract determines no fixture; never written.
  const studioPath = join(root, STUDIO_SLOTS_FILE);
  const studio = existsSync(studioPath) ? JSON.parse(readFileSync(studioPath, "utf8")).slots : [];
  for (const slot of studio) {
    const layer = slot.id.split(".")[0];
    const result = fixtureFor(slot, layer);
    gaps.push({ slot: slot.id, layer, source: "studio", reason: result.fixture ? "Producer package data (studio-defaults/designer-slots.json): this generator does not write it" : result.gap });
  }
  const gapsDoc = {
    note: "Designer slots whose contract determines no contract.fixture (generated by scripts/generate-contract-fixtures.mjs; do not edit).",
    convention: CONVENTION,
    fixtures,
    gaps,
  };
  const gapsPath = join(root, GAPS_FILE);
  const gapsBefore = existsSync(gapsPath) ? readFileSync(gapsPath, "utf8") : "";
  files.push({ path: gapsPath, before: gapsBefore, after: json(gapsDoc) });
  return { files, fixtures, gaps };
}

function main(argv) {
  const check = argv.includes("--check");
  const result = plan();
  const stale = result.files.filter(file => file.before !== file.after);
  if (check) {
    for (const file of stale) console.error(`contract fixtures stale: ${file.path} (run node scripts/generate-contract-fixtures.mjs)`);
    console.log(`contract fixtures: ${result.fixtures} determined, ${result.gaps.length} not determined by the contract${stale.length ? `, ${stale.length} file(s) stale` : ""}`);
    return stale.length ? 1 : 0;
  }
  for (const file of stale) writeFileSync(file.path, file.after);
  console.log(`contract fixtures: ${result.fixtures} determined, ${result.gaps.length} not determined by the contract; wrote ${stale.length} file(s)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
