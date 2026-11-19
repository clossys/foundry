/**
 * The Designer contract fixtures (foundry-build-0048 U27): scripts/generate-contract-fixtures.mjs derives
 * `contract.fixture` from each catalog contract and the convention table, the result is current, every
 * derived fixture is a valid typed element fixture, every slot it cannot determine is named with a reason,
 * the built-in consumer's live component slots carry the package fixture, and a broken fixture is refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { CONVENTION, fixtureFor, LAYERS, PACKAGE_ROOT, pascal, plan } from "../../../designer/scripts/generate-contract-fixtures.mjs";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { fixtureShapeIssues } from "../records/slot-model/validate.js";

type Row = { id: string; contract: Record<string, unknown> };
const catalog = (layer: string): Row[] => JSON.parse(readFileSync(join(PACKAGE_ROOT, "src/catalog/slots", `${layer}.json`), "utf8")) as Row[];
const consumer = fileURLToPath(new URL("../../test-fixtures/consumer/clossys/agents/designer", import.meta.url));
const placed = (): string[] => {
  const ia = JSON.parse(readFileSync(join(consumer, "ia.json"), "utf8")) as { nodes: { children?: { slots?: string[] }[] }[] };
  return ia.nodes.flatMap(node => (node.children ?? []).flatMap(child => child.slots ?? []));
};

describe("Designer contract fixtures", () => {
  it("the committed catalog and gaps file are what the generator writes", () => {
    const stale = (plan() as { files: { path: string; before: string; after: string }[] }).files.filter(file => file.before !== file.after).map(file => file.path);
    expect(stale).toEqual([]);
  });

  it("derives the shadcn registry file and PascalCase export from the convention table", () => {
    expect(pascal("dropdown-menu")).toBe("DropdownMenu");
    expect(fixtureFor({ id: "components.toggle-button", contract: { props: [] } }, "components")).toEqual({
      fixture: { schema: "clossys.element-preview/1", fixtures: { file: "registry/default/ui/toggle-button.tsx", export: "ToggleButton", props: {} } },
    });
    expect(CONVENTION.frames.exportSuffix).toBe("Frame");
  });

  it("every derived fixture is a valid element fixture typed by its contract; every other slot is a named gap", () => {
    const gaps = JSON.parse(readFileSync(join(PACKAGE_ROOT, "src/catalog/contract-fixture-gaps.json"), "utf8")) as { fixtures: number; gaps: { slot: string; layer: string; reason: string; source?: string }[] };
    let fixtures = 0, total = 0;
    for (const layer of LAYERS as string[]) for (const slot of catalog(layer)) {
      total++;
      if (slot.contract.fixture === undefined) {
        expect(gaps.gaps.find(gap => gap.slot === slot.id)?.reason, slot.id).toMatch(/\S/);
        continue;
      }
      fixtures++;
      expect(contractFixtureIssues(slot.contract), slot.id).toEqual([]);
      expect(fixtureShapeIssues("element", slot.contract), slot.id).toEqual([]);
    }
    expect(fixtures).toBe(gaps.fixtures);
    expect(fixtures + gaps.gaps.filter(gap => gap.source !== "studio").length).toBe(total);
    // A specimen that mounts nothing is never given a fixture it would pass vacuously.
    for (const layer of ["themes", "assets"]) expect(catalog(layer).filter(slot => slot.contract.fixture !== undefined)).toEqual([]);
  });

  it("the built-in consumer's live component slots carry the package fixture; every other live slot is a named gap", () => {
    const packaged = new Map(catalog("components").map(slot => [slot.id, slot.contract.fixture]));
    const named = new Set((JSON.parse(readFileSync(join(PACKAGE_ROOT, "src/catalog/contract-fixture-gaps.json"), "utf8")) as { gaps: { slot: string }[] }).gaps.map(gap => gap.slot));
    for (const id of placed()) expect(packaged.get(id) !== undefined || named.has(id), id).toBe(true);
    const live = placed().filter(id => packaged.get(id) !== undefined);
    expect(live.length).toBeGreaterThan(0);
    for (const id of live) {
      const doc = JSON.parse(readFileSync(join(consumer, id, "slot.json"), "utf8")) as { contract: Record<string, unknown> };
      expect(doc.contract.fixture, id).toEqual(packaged.get(id));
    }
  });

  it("refuses a broken fixture (mutation)", () => {
    const slot = catalog("components").find(row => row.id === "components.button")!;
    const fixture = slot.contract.fixture as { fixtures: Record<string, unknown> };
    const broken = [
      { ...slot.contract, fixture: { ...fixture, schema: "clossys.element-preview/0" } },
      { ...slot.contract, fixture: { ...fixture, fixtures: { ...fixture.fixtures, props: { undeclared: true } } } },
      { ...slot.contract, fixture: { ...fixture, fixtures: { file: "", export: "Button", props: {} } } },
      { ...slot.contract, fixture: { ...fixture, notDetermined: true } },
    ];
    for (const contract of broken) expect(fixtureShapeIssues("element", contract).length, JSON.stringify(contract.fixture)).toBeGreaterThan(0);
  });
});
