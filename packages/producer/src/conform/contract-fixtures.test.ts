/**
 * The Designer contract fixtures (foundry-build-0048 U27): `derive-contract-fixtures.mjs --from-references`
 * derives each component slot's `contract.fixture` from its adopted reference row in the Designer's
 * selected style (src/specimen/reference-fixtures.ts). The committed catalog and gaps file are current,
 * every fixture mounts a file and export an adopted reference ships, every other slot is a named gap, the
 * built-in consumer carries the package fixtures, a richer fixture is kept, and the DF.CREATE probe is red
 * on a fixture no reference ships. The lookup and the probe also hold on the Designer as `npm pack` ships it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { fixtureShapeIssues } from "../records/slot-model/validate.js";
import { isAgentLoop } from "../loop/agent-loops.js";
import { COMPOSED, exportedNames, GAPS_FILE, NO_REFERENCE, planReferenceFixtures, REFERENCE_FIXTURE_RULES, referenceFixture, referenceIndex, referenceShips, richer, slotReferenceShips } from "../specimen/reference-fixtures.js";
import { PROBES, type ProbeFacts } from "./dogfood.js";
import type { AgentModel, ConformModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGNER = join(here, "../../../designer");
const STUDIO = JSON.parse(readFileSync(join(here, "../studio-defaults/designer-slots.json"), "utf8")).slots as { id: string; contract?: Record<string, unknown> }[];
const LAYERS = Object.keys(REFERENCE_FIXTURE_RULES.layers);
type Row = { id: string; contract: Record<string, unknown> };
type Fixture = { schema: string; fixtures: { file: string; export: string; props: Record<string, unknown> } };
const catalog = (layer: string): Row[] => JSON.parse(readFileSync(join(DESIGNER, "src/catalog/slots", `${layer}.json`), "utf8")) as Row[];
const gapsDoc = () => JSON.parse(readFileSync(join(DESIGNER, GAPS_FILE), "utf8")) as { style: string; fixtures: number; gaps: { slot: string; layer: string; reason: string; source?: string }[]; composed: { slot: string; layer: string; reason: string }[] };
const consumer = fileURLToPath(new URL("../../test-fixtures/consumer/clossys/agents/designer", import.meta.url));
const placed = (): string[] => {
  const ia = JSON.parse(readFileSync(join(consumer, "ia.json"), "utf8")) as { nodes: { children?: { slots?: string[] }[] }[] };
  // R3: the adopted loop slots are Producer-standard loops, not Designer components (conform's model skips them too).
  return ia.nodes.flatMap(node => (node.children ?? []).flatMap(child => child.slots ?? [])).filter(id => !isAgentLoop(id));
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
      // The props a fixture sets are declared, so the fixture types against its contract; the trigger's
      // mount props are fixture-only (contract.fixtureProps), never props a candidate must expose (K1).
      const contract = catalog("components").find(row => row.id === id)!.contract as { props: string[]; fixtureProps?: string[] };
      expect([...contract.props, ...(contract.fixtureProps ?? [])], id).toEqual(expect.arrayContaining(Object.keys(fixture.fixtures.props)));
      if (fixture.fixtures.export.endsWith("Trigger")) expect(contract.props, id).not.toEqual(expect.arrayContaining(["defaultOpen"]));
    }
  });

  it("every fixture is a valid element fixture an adopted reference ships; every other slot is a named gap", () => {
    const gaps = gapsDoc();
    const composed = new Set(gaps.composed.map(row => row.slot));
    let fixtures = 0, total = 0;
    for (const layer of LAYERS) for (const slot of catalog(layer)) {
      total++;
      const fixture = slot.contract.fixture as Fixture | undefined;
      // FCR: a composed frame or section is judged against its own pinned, certified composition, not a package fixture.
      if (composed.has(slot.id)) { expect(fixture, slot.id).toBeUndefined(); expect(gaps.gaps.some(gap => gap.slot === slot.id), slot.id).toBe(false); continue; }
      if (fixture === undefined) { expect(gaps.gaps.find(gap => gap.slot === slot.id)?.reason, slot.id).toMatch(/\S/); continue; }
      fixtures++;
      expect(contractFixtureIssues(slot.contract), slot.id).toEqual([]);
      expect(fixtureShapeIssues("element", slot.contract), slot.id).toEqual([]);
      expect(referenceShips(index, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
      expect(slotReferenceShips(index, slot.id, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
    }
    expect(fixtures).toBe(gaps.fixtures);
    expect(fixtures + gaps.gaps.filter(gap => gap.source !== "studio").length + composed.size).toBe(total);
    // Only a frame or section with no adoptable reference is composed; it carries the COMPOSED reason.
    for (const row of gaps.composed) { expect(["frames", "sections"], row.slot).toContain(row.layer); expect(row.reason, row.slot).toContain(COMPOSED); }
    // U28: sections and frames carry fixtures too (block-fixtures.test.ts); themes and assets mount nothing.
    for (const layer of ["themes", "assets"]) expect(catalog(layer).filter(slot => slot.contract.fixture !== undefined), layer).toEqual([]);
  });

  it("the built-in consumer's live component slots carry the package fixture; every other live slot is a named gap", () => {
    const packaged = new Map(["components", "sections", "frames"].flatMap(layer => catalog(layer)).map(slot => [slot.id, slot.contract]));
    // FCR: a composed slot is named in the gaps file's composed list; its fixture is consumer-owned.
    const named = new Set([...gapsDoc().gaps, ...gapsDoc().composed].map(gap => gap.slot));
    const live = placed();
    for (const id of live) expect(packaged.get(id)?.fixture !== undefined || named.has(id), id).toBe(true);
    const fixtured = live.filter(id => packaged.get(id)?.fixture !== undefined);
    expect(fixtured.length).toBeGreaterThan(0);
    for (const id of fixtured) {
      const doc = JSON.parse(readFileSync(join(consumer, id, "slot.json"), "utf8")) as { contract: Record<string, unknown> };
      expect(doc.contract.fixture, id).toEqual(packaged.get(id)!.fixture);
      expect(doc.contract.props, id).toEqual(packaged.get(id)!.props);
      expect(doc.contract.fixtureProps, id).toEqual((packaged.get(id) as { fixtureProps?: unknown }).fixtureProps);
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
    // U28: the index reads the section and frame slot contracts too.
    for (const layer of ["sections", "frames"]) write(`src/catalog/slot-contracts/${layer}.json`, []);
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

describe("DF.CREATE probe on a consumer-asset component slot (provenance consumerAssets, CPE)", () => {
  type Source = Record<string, unknown> | undefined;
  const candidate = (source: Source, path = "ui/x.tsx", content = "export function X() { return null }\n") => ({
    clossys: { schema: "clossys.candidate/1", ...(source ? { source } : {}) }, content: { name: "x", files: [{ path, type: "registry:ui", content }] },
  });
  const ORIGINAL: Source = { kind: "original", ref: [] };
  const fixture = (file?: string, name = "X") => ({ schema: "clossys.element-preview/1", fixtures: { ...(file !== undefined ? { file } : {}), export: name, props: {} } });
  const PIN = { schema: "clossys.pin/2", candidate: "x-v1.json" };
  type SlotOverrides = { id?: string; fixture?: unknown; pin?: Record<string, unknown> | null; pinRejection?: string };
  const live = ({ id = "components.logo", fixture: mount = fixture("ui/x.tsx"), pin = PIN, pinRejection }: SlotOverrides = {}) => ({
    id, source: "placed", contract: { props: [], fixture: mount }, inputs: [], uses: [], ledger: [],
    ...(pin ? { pin } : {}), ...(pinRejection !== undefined ? { pinRejection } : {}),
  });
  interface World { slot?: SlotOverrides; assets?: string[]; candidates?: Record<string, unknown>; ships?: ProbeFacts["referenceShips"] }
  const probe = ({ slot = {}, assets = ["components.logo", "components.icon"], candidates = { "x-v1.json": candidate(ORIGINAL) }, ships = () => false }: World = {}) =>
    PROBES["contract-fixture"]!({ agent: "designer", live: [live(slot)] } as unknown as AgentModel, {} as ConformModel, {
      emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, referenceShips: ships, consumerAssets: assets,
      candidateText: (_slot, name) => {
        const doc = candidates[name];
        if (doc === undefined) throw new Error(`ENOENT: ${name}`);
        return typeof doc === "string" ? doc : JSON.stringify(doc);
      },
    }).rows;
  const red = (id: string, why: RegExp) => [expect.stringMatching(new RegExp(`^${id.replace(/\./g, "\\.")}: contract\\.fixture mounts .*, which neither its adopted references ship in the selected style nor its accepted pinned consumer-owned candidate ships \\(${why.source}\\)$`))];

  it("green: an accepted pin's original candidate ships the fixture file and value export", () => {
    expect(probe()).toEqual([]);
  });

  it("green: an npm candidate that re-exports the fixture name (the fixture world's icon)", () => {
    const npm = candidate({ kind: "npm", ref: ["npm/lucide-react@1.65.0"], license: "ISC" }, "ui/icon.tsx", "export { ArrowRight as Icon } from \"lucide-react\";\n");
    expect(probe({ slot: { id: "components.icon", fixture: fixture("ui/icon.tsx", "Icon") }, candidates: { "x-v1.json": npm } })).toEqual([]);
  });

  it("green: a candidate derived only from the consumer's own asset slots is an original", () => {
    const derived = candidate({ kind: "derived", ref: ["clossys/agents/designer/assets.mark"] });
    expect(probe({ candidates: { "x-v1.json": derived } })).toEqual([]);
  });

  it("OR kept: a consumer-asset slot whose adopted reference ships the fixture passes with no pin", () => {
    expect(probe({ slot: { pin: null }, ships: (slot, file, name) => slot === "components.logo" && file === "ui/x.tsx" && name === "X" })).toEqual([]);
  });

  it("matches the provenance list through its globs", () => {
    expect(probe({ slot: { id: "components.brand-mark" }, assets: ["components.brand-*"] })).toEqual([]);
    expect(probe({ slot: { id: "components.brandmark" }, assets: ["components.brand-*"] })).toHaveLength(1);
  });

  it("mutation: each broken fixture, pin, candidate or source gives exactly one row", () => {
    const registry = candidate({ kind: "registry", ref: ["shadcn/button@1"], hash: "sha256:00" });
    const fromReference = candidate({ kind: "derived", ref: ["shadcn/button@1"], hash: "sha256:00" });
    const cases: [string, World, RegExp][] = [
      ["fixture export renamed", { slot: { fixture: fixture("ui/x.tsx", "Y") } }, /its pinned candidate's ui\/x\.tsx has no value export Y/],
      ["fixture path changed", { slot: { fixture: fixture("ui/y.tsx") } }, /its pinned candidate x-v1\.json ships no file ui\/y\.tsx/],
      ["candidate file path changed", { candidates: { "x-v1.json": candidate(ORIGINAL, "ui/z.tsx") } }, /its pinned candidate x-v1\.json ships no file ui\/x\.tsx/],
      ["type-only export", { candidates: { "x-v1.json": candidate(ORIGINAL, "ui/x.tsx", "type X = string;\nexport { type X }\n") } }, /its pinned candidate's ui\/x\.tsx has no value export X/],
      ["non-code file", { slot: { fixture: fixture("ui/x.svg") }, candidates: { "x-v1.json": candidate(ORIGINAL, "ui/x.svg", "<svg/>") } }, /its pinned candidate's ui\/x\.svg is not a code file/],
      ["no fixture file", { slot: { fixture: fixture(undefined) } }, /the fixture names no file or export/],
      ["no pin", { slot: { pin: null } }, /it has no pin/],
      ["refused pin", { slot: { pinRejection: "hash-drift" } }, /the slot\/2 reader refuses its pin \(hash-drift\)/],
      ["pin names no candidate", { slot: { pin: { schema: "clossys.pin/2" } } }, /its pin names no candidate/],
      ["pinned candidate missing", { slot: { pin: { ...PIN, candidate: "gone-v1.json" } } }, /its pinned candidate gone-v1\.json cannot be read: ENOENT: gone-v1\.json/],
      ["pinned candidate unparsable", { candidates: { "x-v1.json": "{ not json" } }, /its pinned candidate x-v1\.json cannot be read: .*/],
      ["registry source", { candidates: { "x-v1.json": registry } }, /its pinned candidate x-v1\.json has source "registry", which is not consumer-owned .*/],
      ["derived from a reference", { candidates: { "x-v1.json": fromReference } }, /its pinned candidate x-v1\.json has source "derived", which is not consumer-owned .*/],
      ["no clossys.source", { candidates: { "x-v1.json": candidate(undefined) } }, /its pinned candidate x-v1\.json has source null, which is not consumer-owned .*/],
    ];
    for (const [name, world, why] of cases) expect(probe(world), name).toEqual(red(world.slot?.id ?? "components.logo", why));
  });

  it("mutation: outside consumerAssets the same original candidate is red with the U27 message", () => {
    const u27 = (id: string) => [`${id}: contract.fixture mounts ui/x.tsx#X, which none of its adopted references ships in the selected style`];
    expect(probe({ assets: [] }), "slot removed from consumerAssets").toEqual(u27("components.logo"));
    expect(probe({ slot: { id: "components.button" } }), "components.button").toEqual(u27("components.button"));
    expect(probe({ slot: { id: "frames.logo" }, assets: ["frames.logo"] }), "not a component slot").toEqual(u27("frames.logo"));
  });

  it("the fixture world's three consumer-asset slots pass on their real pinned candidates, read by the default readers", () => {
    const root = join(consumer, "../..");
    const slotOf = (id: string, mount?: unknown) => {
      const doc = JSON.parse(readFileSync(join(consumer, id, "slot.json"), "utf8")) as { contract: Record<string, unknown> };
      const pin = JSON.parse(readFileSync(join(consumer, id, "pin.json"), "utf8")) as Record<string, unknown>;
      return { id, source: "placed", contract: { ...doc.contract, ...(mount ? { fixture: mount } : {}) }, inputs: [], uses: [], ledger: [], pin };
    };
    const ids = ["components.icon", "components.logo", "components.semantic-content"];
    const run = (slots: unknown[]) => PROBES["contract-fixture"]!({ agent: "designer", live: slots } as unknown as AgentModel, { consumer: root } as ConformModel, { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false }).rows;
    expect(run(ids.map(id => slotOf(id)))).toEqual([]);
    // Fixture-world mutation: the icon fixture's export renamed to Icons brings its row back.
    expect(run([slotOf("components.icon", fixture("ui/icon.tsx", "Icons"))])).toEqual(red("components.icon", /its pinned candidate's ui\/icon\.tsx has no value export Icons/));
  });
});

describe("packed Designer layout (what a tarball consumer installs)", () => {
  let packed: string | undefined, packedRoot = "";
  beforeAll(() => {
    packed = mkdtempSync(join(tmpdir(), "u27-packed-"));
    execFileSync("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", packed], { cwd: DESIGNER, stdio: ["ignore", "ignore", "inherit"] });
    const tarball = readdirSync(packed).find(name => name.endsWith(".tgz"))!;
    execFileSync("tar", ["-xzf", join(packed, tarball), "-C", packed]);
    packedRoot = join(packed, "package");
  }, 300_000);
  afterAll(() => { if (packed) rmSync(packed, { recursive: true, force: true }); });

  it("the packed Designer ships no ui/ workspace, and the lookup and the probe still hold on it", () => {
    expect(existsSync(join(packedRoot, "references/manifest.json"))).toBe(true);
    expect(existsSync(join(packedRoot, "ui"))).toBe(false);
    const packedIndex = referenceIndex(packedRoot);
    expect(packedIndex.style).toBe("aria-nova");
    const stale = planReferenceFixtures(packedRoot, STUDIO).files.filter(file => file.before !== file.after).map(file => file.path);
    expect(stale).toEqual([]);
    const live = catalog("components").filter(row => row.contract.fixture !== undefined);
    expect(live.length).toBeGreaterThan(0);
    for (const row of live) {
      const fixture = row.contract.fixture as Fixture;
      expect(slotReferenceShips(packedIndex, row.id, fixture.fixtures.file, fixture.fixtures.export), row.id).toBe(true);
    }
    const model = { agent: "designer", live: live.map(row => ({ id: row.id, source: "placed", contract: row.contract, inputs: [], uses: [] })) } as unknown as AgentModel;
    const facts: ProbeFacts = { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, referenceShips: (slot, file, name) => slotReferenceShips(packedIndex, slot, file, name) };
    expect(PROBES["contract-fixture"]!(model, {} as ConformModel, facts).rows).toEqual([]);
  });
});
