// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import legacy from "./__fixtures__/rail-legacy-inventory.test.json" with { type: "json" };
import { sha256 } from "./digest.js";
import { loadBuildCatalog } from "./index.js";
import bundleData from "../catalog-bundles.data.json" with { type: "json" };
import { generatedShadcnComponentFiles, type ShadcnComponentInput } from "../importers/shadcn-aria-components.js";
import { importShadcnAriaRail } from "../importers/shadcn-aria-rail.js";

const addedComponents = ["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"];
const addedIds = ["assets.icon-panel-left", ...addedComponents.map(leaf => `components.${leaf}`)];
const directory = join(import.meta.dirname, "../catalog/fills/shadcn@aria");

it("joins exactly eight rail registrations to ordered original slots with approved frame and section contracts", () => {
  const current = loadBuildCatalog().slots;
  expect(current.filter(slot => addedIds.includes(slot.id)).map(slot => slot.id).sort()).toEqual([...addedIds].sort());
  for (const row of legacy.slots) {
    const rows = JSON.parse(readFileSync(join(import.meta.dirname, `../catalog/slots/${row.layer}.json`), "utf8")) as { id: string }[];
    const previous = rows.filter(slot => !addedIds.includes(slot.id));
    expect(previous.map(slot => slot.id), row.layer).toEqual(row.ids);
    expect(sha256(JSON.stringify(previous)), row.layer).toBe(row.rowsSha256);
    expect(rows.map(slot => slot.id)).toEqual(current.filter(slot => slot.layer === row.layer).map(slot => slot.id));
  }
  expect(current).toHaveLength(legacy.slots.reduce((count, row) => count + row.ids.length, 0) + addedIds.length);
  expect(new Set(current.map(slot => slot.id)).size).toBe(current.length);
});

it("authenticates the full inventory with approved card/menu typography and seven generated rail offers", () => {
  const generated = importShadcnAriaRail().fills.filter(doc => addedIds.includes(doc.$extensions["com.clossys.fill"].slot));
  expect(generated.map(doc => doc.$extensions["com.clossys.fill"].slot).sort()).toEqual(addedComponents.map(leaf => `components.${leaf}`));
  const additions = generated.map(doc => {
    const name = `${doc.$extensions["com.clossys.fill"].slot}.json`;
    const bytes = JSON.stringify(doc, null, 2) + "\n";
    expect(readFileSync(join(directory, name), "utf8")).toBe(bytes);
    return { name, sha256: sha256(bytes) };
  });
  // The approved Card heading/Menu label mappings regenerate only these descriptors and their coverage notes.
  const typography = ["components.card.json", "components.menu.json", "components.coverage.json"];
  const canonical = generatedShadcnComponentFiles(structuredClone(bundleData.shadcn) as unknown as ShadcnComponentInput);
  for (const name of typography) expect(Object.hasOwn(canonical, name), name).toBe(true);
  expect(legacy.descriptors.filter(row => typography.includes(row.name)).map(row => row.name).sort()).toEqual([...typography].sort());
  const originals = legacy.descriptors.map(row => {
    const bytes = readFileSync(join(directory, row.name), "utf8");
    if (typography.includes(row.name)) {
      expect(bytes, row.name).toBe(canonical[row.name]);
      return { name: row.name, sha256: sha256(canonical[row.name]!) };
    }
    expect(sha256(bytes), row.name).toBe(row.sha256);
    return row;
  });
  const current = readdirSync(directory).filter(name => /^components\..*\.json$/.test(name)).sort();
  const combined = [...originals, ...additions].sort((a, b) => a.name.localeCompare(b.name));
  expect(current).toEqual(combined.map(row => row.name));
  const currentHash = sha256(current.map(name => `${name}\n${sha256(readFileSync(join(directory, name), "utf8"))}\n`).join(""));
  expect(currentHash).toBe(sha256(combined.map(row => `${row.name}\n${row.sha256}\n`).join("")));
});
