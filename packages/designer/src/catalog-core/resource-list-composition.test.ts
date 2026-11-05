/** @vitest-environment node */
import { createHash } from "node:crypto";
import { realpathSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { measureFoundrySurfaces } from "../../scripts/lib/foundry-surface-consumption.mjs";
import { buildSurfaceConsumption } from "./surface-consumption.js";
import { loadSectionRegistry, sectionRegistryFindings } from "./sections-contract.js";
import { contractFindings, surfaceConsumptionFindings } from "./surface-defaults.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { adoptedSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { resolve } from "./api.js";
import { surfaceDescriptorHash, surfaceDocument, surfaceOf } from "./surface-library.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const callers = ["activity-feed", "resource-list", "usage"];
const section = (leaf: string) => loadSectionRegistry().slots.find(row => row.id === `sections.${leaf}`)!;
const descriptor = (leaf: string) => Object.values(importFoundrySections().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === `sections.${leaf}`)!.sections)[0]!;
let measured: ReturnType<typeof measureFoundrySurfaces>;
beforeAll(() => { measured = measureFoundrySurfaces(root, buildSurfaceConsumption); }, 20_000);

it("measures the real ResourceList EmptyState import as its native section, with a separate header boundary", () => {
  const row = measured.measurements["sections.resource-list"].consumption;
  expect(row.scannedComposes).toEqual(["components.button", "components.grid-list", "components.menu", "components.skeleton", "sections.empty-state"]);
  const scan = measured.input.sourceScans.find((scan: { fill: string }) => scan.fill === "foundry/sections.resource-list")!;
  expect(scan.resolvedImports["packages/designer/src/blocks/ResourceList.tsx:./EmptyState.js#EmptyState"]).toBe("sections.empty-state");
  expect(row.sourceFiles.map((file: { path: string }) => file.path)).not.toContain("packages/designer/src/blocks/EmptyState.tsx");
  expect(row.scannedComposes).not.toContain("sections.section-header");
  expect(measured.measurements["sections.empty-state"].consumption.scannedComposes).toContain("sections.section-header");
  expect(row.unresolved.some((finding: { evidence: string }) => finding.evidence.includes("EmptyState"))).toBe(false);
  for (const [slot, value] of Object.entries(measured.measurements) as [string, any][]) {
    expect(value.consumption.scannedComposes, slot).not.toContain(slot);
    for (const file of value.consumption.sourceFiles) expect(file.sha256).toBe(createHash("sha256").update(readFileSync(join(root, "../..", file.path))).digest("hex"));
  }
});

it("declares exactly the three real EmptyState callers as composition while keeping shared parts locked", () => {
  const slots = loadSectionRegistry().slots;
  expect(slots.filter(slot => slot.contract.composes?.includes("sections.empty-state")).map(slot => slot.id)).toEqual(callers.map(leaf => `sections.${leaf}`));
  for (const slot of slots) for (const part of slot.contract.parts) expect(["sections.band", "sections.section-header", "sections.pagination"]).toContain(part);
  for (const leaf of callers) {
    expect(section(leaf).contract.composes).toEqual(["sections.empty-state"]);
    expect(section(leaf).contract.parts).not.toContain("sections.empty-state");
    expect(descriptor(leaf).composes).toContain("sections.empty-state");
    expect(contractFindings(section(leaf), descriptor(leaf))).toEqual([]);
  }
  // The private boundary adapter keeps its public adaptation anchor, not native ownership.
  expect(descriptor("boundary-message").pin.export).toBe("./blocks#EmptyState");
  expect(descriptor("boundary-message").notes.join(" ")).toContain("private runtime boundary-message");
});

it("uses the same strict actual-use rules for source and package consumers of nested sections", () => {
  const slot = section("resource-list"), fill = structuredClone(descriptor("resource-list"));
  const actual = measured.measurements[slot.id].consumption;
  expect(surfaceConsumptionFindings(slot, fill, actual)).toEqual([]);
  expect(contractFindings(slot, fill)).toEqual([]);
  slot.contract.composes = [];
  fill.composes = fill.composes!.filter(id => id !== "sections.empty-state");
  for (const findings of [surfaceConsumptionFindings(slot, fill, actual), contractFindings(slot, fill)]) {
    expect(findings).toContain("S5 unsupported composes: sections.empty-state");
    expect(findings).toContain("S5 underreported composes: sections.empty-state");
  }
});

it("admits a declared composed section on the public source path and refuses excess composition", () => {
  const { input, bundle } = adoptedSurface();
  const slot = input.catalog.surfaces!.slots[0]!;
  if (slot.contract.kind !== "section") throw new Error("expected section fixture");
  slot.contract.composes = ["sections.empty-state"];
  const fill = structuredClone(surfaceOf(input.library.surfaces!.fills[0]!));
  fill.composes = ["sections.empty-state"];
  const install = () => {
    fill.origin = { kind: "authored", license: fill.license, lineage: bundle.base, descriptorHash: surfaceDescriptorHash(fill) };
    input.library.surfaces = { ...input.library.surfaces!, fills: [surfaceDocument(input.library, fill)] };
  };
  install();
  expect(resolve(input).surfaces!.check.findings.filter(row => row.code === "S5" && /unsupported composes/.test(row.message))).toEqual([]);
  fill.composes = [...fill.composes, "sections.error-state"];
  install();
  expect(resolve(input).surfaces!.check.findings.some(row => row.code === "S5" && row.message === "unsupported composes")).toBe(true);
});

it("validates composed-section references without adding parts or accepting self/unknown targets", () => {
  const registry = loadSectionRegistry();
  const resource = registry.slots.find(slot => slot.id === "sections.resource-list")!;
  resource.contract.composes = ["sections.empty-state"];
  expect(sectionRegistryFindings(registry)).toEqual([]);
  resource.contract.composes = ["sections.resource-list", "sections.missing"];
  expect(sectionRegistryFindings(registry)).toEqual(expect.arrayContaining([
    "composition: sections.resource-list composes itself", "composition: sections.resource-list has unknown section sections.missing",
  ]));
});

/** SYNTHETIC collision corpus; the real ResourceList proof above uses repository source. */
function collisionFixture() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "native-section-owner-"))), root = join(repo, "packages/designer");
  const write = (path: string, text: string) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value));
  json("package.json", { name: "@example/designer" });
  mkdirSync(join(repo, "packages/publisher"), { recursive: true });
  writeFileSync(join(repo, "packages/publisher/package.json"), JSON.stringify({ name: "@example/publisher" }));
  for (const layer of ["themes", "assets", "components", "frames"]) json(`src/catalog/slots/${layer}.json`, []);
  const contract = { allowedReads: { themes: [], assets: [] }, allowedComposes: [], composes: ["sections.empty-state"], parts: [] };
  json("src/catalog/slots/sections.json", ["resource-list", "empty-state", "boundary-message", "other-native"].map(leaf => ({ id: `sections.${leaf}`, contract })));
  const doc = (leaf: string, name: string) => json(`src/catalog/fills/foundry/sections.${leaf}.json`, { $extensions: { "com.clossys.fill": { id: `foundry/sections.${leaf}`, slot: `sections.${leaf}`, source: "foundry", pin: { package: "@example/designer", version: "1.0.0", export: `./blocks#${name}` } } }, sections: { [leaf]: { propMap: {} } } });
  doc("resource-list", "ResourceList"); doc("empty-state", "EmptyState"); doc("boundary-message", "EmptyState");
  write("src/blocks/index.ts", 'export { ResourceList } from "./ResourceList.js"; export { EmptyState } from "./EmptyState.js";');
  write("src/blocks/ResourceList.tsx", 'import { EmptyState } from "./EmptyState.js"; export function ResourceList() { return <EmptyState/>; }');
  const native = 'import { dsAttrs } from "../catalog-core/provenance-attrs.js"; const SECTION_STAMP = dsAttrs("sections", "sections.empty-state", "foundry/sections.empty-state"); export function EmptyState() { return <div {...SECTION_STAMP}/>; }';
  write("src/blocks/EmptyState.tsx", native);
  write("src/catalog-core/provenance-attrs.ts", 'export function dsAttrs(layer, slot, fill) { return { "data-ds-slot": slot }; }');
  write("styles/theme.css", ""); write("styles/theme-keys.css", "");
  const row = () => measureFoundrySurfaces(root, buildSurfaceConsumption).measurements["sections.resource-list"].consumption;
  return { write, doc, native, row, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

it("uses a bound native provenance value and retains real ambiguity when that witness is missing or spoofed", () => {
  const fixture = collisionFixture();
  try {
    expect(fixture.row().scannedComposes).toEqual(["sections.empty-state"]);
    const spoofs = [
      fixture.native.replace('dsAttrs("sections", "sections.empty-state", "foundry/sections.empty-state")', '{} /* dsAttrs("sections", "sections.empty-state", "foundry/sections.empty-state") */'),
      fixture.native.replace('dsAttrs("sections", "sections.empty-state", "foundry/sections.empty-state")', "'dsAttrs(\"sections\", \"sections.empty-state\", \"foundry/sections.empty-state\")'"),
      fixture.native.replace('../catalog-core/provenance-attrs.js', 'foreign-provenance'),
      fixture.native.replace('import { dsAttrs } from "../catalog-core/provenance-attrs.js";', 'function dsAttrs() { return {}; }'),
      fixture.native.replace('"sections.empty-state", "foundry/sections.empty-state"', '"sections.boundary-message", "foundry/sections.boundary-message"'),
      fixture.native.replace('return <div', 'const SECTION_STAMP = {}; return <div'),
    ];
    for (const source of spoofs) {
      fixture.write("src/blocks/EmptyState.tsx", source);
      const row = fixture.row();
      expect(row.scannedComposes).toEqual([]);
      expect(row.unresolved.some((finding: { code: string; evidence: string }) => finding.code === "DF5" && finding.evidence.includes("ambiguous slot ownership"))).toBe(true);
    }
    fixture.write("src/blocks/EmptyState.tsx", fixture.native);
    fixture.doc("other-native", "EmptyState");
    expect(fixture.row().unresolved.some((finding: { code: string; evidence: string }) => finding.code === "DF5" && finding.evidence.includes("sections.other-native"))).toBe(true);
  } finally { fixture.cleanup(); }
});

it("does not invent actual composition from the caller contract when the import is absent", () => {
  const fixture = collisionFixture();
  try {
    fixture.write("src/blocks/ResourceList.tsx", "export function ResourceList() { return <section/>; }");
    expect(fixture.row().scannedComposes).toEqual([]);
  } finally { fixture.cleanup(); }
});
