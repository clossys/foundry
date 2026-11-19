/**
 * The Designer contract fixtures (foundry-build-0048 U27): `derive-contract-fixtures.mjs --from-references`
 * derives each component slot's `contract.fixture` from its adopted reference row in the Designer's
 * selected style (src/specimen/reference-fixtures.ts). The committed catalog and gaps file are current,
 * every fixture mounts a file and export an adopted reference ships, every other slot is a named gap, the
 * built-in consumer carries the package fixtures, a richer fixture is kept, and the DF.CREATE probe is red
 * on a fixture no reference ships.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { fixtureShapeIssues } from "../records/slot-model/validate.js";
import { exportedNames, GAPS_FILE, NO_REFERENCE, planReferenceFixtures, REFERENCE_FIXTURE_RULES, referenceFixture, referenceIndex, referenceShips, richer, slotReferenceShips } from "../specimen/reference-fixtures.js";
import { PROBES, type ProbeFacts } from "./dogfood.js";
import type { AgentModel, ConformModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGNER = join(here, "../../../designer");
const STUDIO = JSON.parse(readFileSync(join(here, "../studio-defaults/designer-slots.json"), "utf8")).slots as { id: string; contract?: Record<string, unknown> }[];
const LAYERS = Object.keys(REFERENCE_FIXTURE_RULES.layers);
type Row = { id: string; contract: Record<string, unknown> };
type Fixture = { schema: string; fixtures: { file: string; export: string; props: Record<string, unknown> } };
const catalog = (layer: string): Row[] => JSON.parse(readFileSync(join(DESIGNER, "src/catalog/slots", `${layer}.json`), "utf8")) as Row[];
const gapsDoc = () => JSON.parse(readFileSync(join(DESIGNER, GAPS_FILE), "utf8")) as { style: string; fixtures: number; gaps: { slot: string; layer: string; reason: string; source?: string }[] };
const consumer = fileURLToPath(new URL("../../test-fixtures/consumer/clossys/agents/designer", import.meta.url));
const placed = (): string[] => {
  const ia = JSON.parse(readFileSync(join(consumer, "ia.json"), "utf8")) as { nodes: { children?: { slots?: string[] }[] }[] };
  return ia.nodes.flatMap(node => (node.children ?? []).flatMap(child => child.slots ?? []));
};
const fixtureOf = (id: string) => catalog("components").find(row => row.id === id)?.contract.fixture as Fixture | undefined;
const index = referenceIndex(DESIGNER);

describe("Designer contract fixtures from adopted references", () => {
  it("the committed catalog and gaps file are what --from-references --write writes", () => {
    const stale = planReferenceFixtures(DESIGNER, STUDIO).files.filter(file => file.before !== file.after).map(file => file.path);
    expect(stale).toEqual([]);
  });

  it("takes file and export from the slot's reference row, in the Designer's selected style", () => {
    expect(index.style).toBe("aria-nova");
    const mount = (id: string) => { const fixture = fixtureOf(id); return fixture && `${fixture.fixtures.file}#${fixture.fixtures.export}`; };
    // shadcn (radix-nova) rows restyle to their shadcn-aria item; the upstream item names, never the slot names.
    expect(mount("components.button")).toBe("registry/aria-nova/ui/button.tsx#Button");
    expect(mount("components.breadcrumbs")).toBe("registry/aria-nova/ui/breadcrumb.tsx#Breadcrumb");
    expect(mount("components.text-field")).toBe("registry/aria-nova/ui/input.tsx#Input");
    expect(mount("components.toggle-button")).toBe("registry/aria-nova/ui/toggle.tsx#Toggle");
    expect(mount("components.toast")).toBe("registry/aria-nova/ui/sonner.tsx#Toaster");
    // A slot with no reference row is a named gap, never an invented path.
    expect(referenceFixture(index, "components.x", [])).toEqual({ gap: NO_REFERENCE });
    const unreferenced = gapsDoc().gaps.filter(gap => gap.layer === "components" && gap.reason === NO_REFERENCE);
    expect(unreferenced.length).toBeGreaterThan(0);
    for (const gap of unreferenced) expect(fixtureOf(gap.slot), gap.slot).toBeUndefined();
  });

  it("opens an overlay with its reference's own trigger, so the mounted fixture renders", () => {
    const dialog = fixtureOf("components.dialog")!;
    expect(dialog.fixtures).toEqual({
      file: "registry/aria-nova/ui/dialog.tsx", export: "DialogTrigger",
      props: { defaultOpen: true, children: [{ $component: "react-aria-components.Button", children: "Open" }, { $component: "Dialog", children: "Content" }] },
    });
    for (const id of REFERENCE_FIXTURE_RULES.overlays) {
      const fixture = fixtureOf(id);
      if (!fixture) continue;
      if (fixture.fixtures.export.endsWith("Trigger")) expect(fixture.fixtures.props.defaultOpen, id).toBe(true);
      // The props a fixture sets are declared, so the fixture types against its contract.
      expect(catalog("components").find(row => row.id === id)!.contract.props, id).toEqual(expect.arrayContaining(Object.keys(fixture.fixtures.props)));
    }
  });

  it("every fixture is a valid element fixture an adopted reference ships; every other slot is a named gap", () => {
    const gaps = gapsDoc();
    let fixtures = 0, total = 0;
    for (const layer of LAYERS) for (const slot of catalog(layer)) {
      total++;
      const fixture = slot.contract.fixture as Fixture | undefined;
      if (fixture === undefined) { expect(gaps.gaps.find(gap => gap.slot === slot.id)?.reason, slot.id).toMatch(/\S/); continue; }
      fixtures++;
      expect(contractFixtureIssues(slot.contract), slot.id).toEqual([]);
      expect(fixtureShapeIssues("element", slot.contract), slot.id).toEqual([]);
      expect(referenceShips(index, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
      expect(slotReferenceShips(index, slot.id, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
    }
    expect(fixtures).toBe(gaps.fixtures);
    expect(fixtures + gaps.gaps.filter(gap => gap.source !== "studio").length).toBe(total);
    for (const layer of ["themes", "assets", "sections", "frames"]) expect(catalog(layer).filter(slot => slot.contract.fixture !== undefined), layer).toEqual([]);
  });

  it("the built-in consumer's live component slots carry the package fixture; every other live slot is a named gap", () => {
    const packaged = new Map(catalog("components").map(slot => [slot.id, slot.contract]));
    const named = new Set(gapsDoc().gaps.map(gap => gap.slot));
    const live = placed();
    for (const id of live) expect(packaged.get(id)?.fixture !== undefined || named.has(id), id).toBe(true);
    const fixtured = live.filter(id => packaged.get(id)?.fixture !== undefined);
    expect(fixtured.length).toBeGreaterThan(0);
    for (const id of fixtured) {
      const doc = JSON.parse(readFileSync(join(consumer, id, "slot.json"), "utf8")) as { contract: Record<string, unknown> };
      expect(doc.contract.fixture, id).toEqual(packaged.get(id)!.fixture);
      expect(doc.contract.props, id).toEqual(packaged.get(id)!.props);
    }
  });

  it("reads value exports, never type-only ones", () => {
    expect(exportedNames("function A() {}\nexport { type T, A, B as C }\nexport const D = 1\nexport function E() {}")).toEqual(["A", "C", "D", "E"]);
  });
});

describe("a richer existing fixture is kept", () => {
  let root: string | undefined;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });
  const derived = { schema: "clossys.element-preview/1", fixtures: { file: "registry/aria-nova/ui/button.tsx", export: "Button", props: {} } };

  it("richer(): same file and export with more props or a frame is richer; another file or fewer props is not", () => {
    expect(richer({ ...derived, fixtures: { ...derived.fixtures, props: { variant: "outline" } } }, derived)).toBe(true);
    expect(richer({ ...derived, width: 320 }, derived)).toBe(true);
    expect(richer(derived, derived)).toBe(false);
    expect(richer({ ...derived, fixtures: { ...derived.fixtures, file: "registry/default/ui/button.tsx" } }, derived)).toBe(false);
  });

  it("planReferenceFixtures keeps it, and replaces an invented one", () => {
    root = mkdtempSync(join(tmpdir(), "u27-designer-"));
    const write = (path: string, value: unknown) => { mkdirSync(dirname(join(root!, path)), { recursive: true }); writeFileSync(join(root!, path), typeof value === "string" ? value : JSON.stringify(value)); };
    write("ui/components.json", { style: "aria-nova" });
    write("references/shadcn-aria/button@1/registry/aria-nova/ui/button.tsx", "function Button() { return null }\nexport { Button }\n");
    write("references/manifest.json", {
      registries: { shadcn: { style: "radix-nova", upstream: "github.com/x/ui@1" }, "shadcn-aria": { style: "aria-nova", upstream: "github.com/x/ui@1" } },
      items: [
        { registry: "shadcn", name: "button", version: "1", dir: "shadcn/button@1", files: [{ path: "registry/radix-nova/ui/button.tsx" }] },
        { registry: "shadcn-aria", name: "button", version: "1", dir: "shadcn-aria/button@1", files: [{ path: "registry/aria-nova/ui/button.tsx" }] },
      ],
    });
    write("src/catalog/slot-contracts/components.json", [{ slot: "components.button", references: [{ registry: "shadcn", item: "button", version: "1" }] }, { slot: "components.link", references: [{ registry: "shadcn", item: "button", version: "1" }] }, { slot: "components.logo", references: [] }]);
    const rich = { ...derived, fixtures: { ...derived.fixtures, props: { variant: "outline" } } };
    write("src/catalog/slots/components.json", [
      { id: "components.button", contract: { props: ["variant"], fixture: rich } },
      { id: "components.link", contract: { props: [], fixture: { ...derived, fixtures: { ...derived.fixtures, file: "registry/default/ui/link.tsx", export: "Link" } } } },
      { id: "components.logo", contract: { props: [] } },
    ]);
    for (const layer of ["themes", "assets", "sections", "frames"]) write(`src/catalog/slots/${layer}.json`, []);
    const plan = planReferenceFixtures(root);
    const rows = JSON.parse(plan.files.find(file => file.path.endsWith("slots/components.json"))!.after) as Row[];
    expect(rows[0]!.contract.fixture).toEqual(rich);
    expect(rows[1]!.contract.fixture).toEqual(derived);
    expect(rows[2]!.contract.fixture).toBeUndefined();
    expect(plan).toMatchObject({ fixtures: 2, kept: 1, gaps: [{ slot: "components.logo", layer: "components", reason: NO_REFERENCE }] });
  });
});

describe("DF.CREATE probe (strengthened)", () => {
  const designer = (fixture: unknown) => ({ agent: "designer", live: [{ id: "components.button", source: "placed", contract: { props: [], fixture }, inputs: [], uses: [] }] }) as unknown as AgentModel;
  const probe = (fixture: unknown, facts: Partial<ProbeFacts> = {}) => PROBES["contract-fixture"]!(designer(fixture), {} as ConformModel, { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, ...facts }).rows;

  it("green on a fixture an adopted reference ships", () => {
    expect(probe(fixtureOf("components.button"))).toEqual([]);
  });

  it("mutation: red on an invented file or an export the reference does not ship", () => {
    const invented = { schema: "clossys.element-preview/1", fixtures: { file: "registry/default/ui/button.tsx", export: "Button", props: {} } };
    // registry/default/ui/button.tsx is the round-1 invented path; another registry (corsair-ui) happens to ship a
    // file at that path, but it is not components.button's own reference in the selected style, so it is red.
    expect(probe(invented)).toEqual(["components.button: contract.fixture mounts registry/default/ui/button.tsx#Button, which none of its adopted references ships in the selected style"]);
    const otherStyle = { schema: "clossys.element-preview/1", fixtures: { file: "registry/radix-nova/ui/button.tsx", export: "Button", props: {} } };
    expect(probe(otherStyle)).toHaveLength(1);
    const wrongExport = { schema: "clossys.element-preview/1", fixtures: { file: "registry/aria-nova/ui/button.tsx", export: "Buttons", props: {} } };
    expect(probe(wrongExport)).toHaveLength(1);
    expect(probe(fixtureOf("components.button"), { referenceShips: () => false })).toHaveLength(1);
  });

  it("refuses a broken fixture shape (mutation)", () => {
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
