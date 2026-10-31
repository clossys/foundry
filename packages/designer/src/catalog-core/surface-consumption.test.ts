// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSurfaceConsumption, type SurfaceConsumptionInput } from "./surface-consumption.js";
import { dogfoodComposes, runDogfood } from "./dogfood.js";

const fixture = (): SurfaceConsumptionInput => ({
  tokens: [{ id: "tokens.ink", contract: { emit: { primary: "--color-ink" } } }], assets: [],
  components: [{ id: "components.button" }],
  sections: [{ id: "sections.example", contract: { allowedReads: { themes: [], assets: [] }, allowedComposes: [], parts: [] } }],
  frames: [{ id: "frames.example", contract: { allowedReads: { themes: [], assets: [] }, composes: [] } }],
  fills: [{ id: "foundry/sections.example", slot: "sections.example", source: "foundry" }],
  sourceScans: [{ fill: "foundry/sections.example", files: [{ path: "src/Section.tsx", content: 'import { Button as Action } from "./Button.js"; const style = "text-ink"; export const Example = () => <section className={style}><Action/><button/><svg/></section>;' }], resolvedImports: { "src/Section.tsx:./Button.js#Button": "components.button" } }],
  themeCss: "@theme { --color-ink: var(--color-ink); }",
});

describe("sections and frames observed consumption", () => {
  it("derives aliased source edges and token reads independently of declarations", () => {
    const report = buildSurfaceConsumption(fixture()), row = report.fills[0]!;
    expect(row.scannedReads.themes).toEqual(["tokens.ink"]);
    expect(row.missingDeclaredReads.themes).toEqual(["tokens.ink"]);
    expect(row.scannedComposes).toEqual(["components.button"]);
    expect(row.missingDeclaredComposes).toEqual(["components.button"]);
    expect(report.findings.some(f => f.code === "DF4" && f.evidence.includes("tokens.ink"))).toBe(true);
    expect(report.findings.some(f => f.code === "DF4" && f.evidence.includes("components.button"))).toBe(true);
    expect(report.findings.map(f => f.code)).toEqual(expect.arrayContaining(["DF1", "DF2", "DF3", "DF4"]));
    expect(report.reverseComposes["components.button"]).toMatchObject({ declared: [], scanned: [row.id], effective: [row.id] });
    expect(report.reverseReads["tokens.ink"]).toMatchObject({ declared: [], scanned: [row.id] });
  });

  it("uses authored section parts and frame composes without widening either contract", () => {
    const input = fixture(); input.sections[0]!.contract.parts = ["sections.band"];
    input.frames[0]!.contract.composes = ["components.button"];
    input.fills.push({ id: "foundry/frames.example", slot: "frames.example", source: "foundry" });
    input.sourceScans.push({ ...input.sourceScans[0]!, fill: "foundry/frames.example" });
    const before = JSON.stringify(input), report = buildSurfaceConsumption(input);
    expect(report.fills.find(row => row.slot === "frames.example")!.missingDeclaredComposes).toEqual([]);
    expect(report.fills.find(row => row.slot === "sections.example")!.declaredComposes).toEqual(["sections.band"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("preserves unknown visual imports, dynamic values, raw controls and missing scans as evidence", () => {
    const input = fixture(); input.sourceScans[0]!.files[0]!.content += '\nimport { Button as Fake } from "other-ui"; const Unknown = () => <Fake style={styles}/>;';
    input.sourceScans[0]!.unresolved = [{ file: "src/Section.tsx", line: 2, evidence: "unresolved dynamic import" }];
    const report = buildSurfaceConsumption(input);
    expect(report.findings.some(row => row.code === "DF5" && row.evidence.includes("Fake"))).toBe(true);
    expect(report.findings.some(row => row.code === "DF2" && row.evidence.includes("dynamic import"))).toBe(true);
    input.sourceScans = [];
    expect(buildSurfaceConsumption(input).fills[0]!.scanStatus).toBe("unavailable");
    expect(buildSurfaceConsumption(input).findings.some(row => row.evidence.includes("source scan unavailable"))).toBe(true);
  });

  it("records namespace aliases from actual import provenance and flags undeclared composition with DF4", () => {
    const file = "src/Frame.tsx", content = 'import * as UI from "./local.js"; import { Button as Fake } from "foreign-ui"; const View = () => <><UI.Button/><Fake/></>;';
    const input = { files: [{ file, content }], resolvedImports: { [`${file}:./local.js#Button`]: "components.button" }, contracts: { [file]: { id: "frames.example", allowedReads: {}, allowedComposes: [] } } };
    expect(dogfoodComposes(input)).toEqual([{ file, line: 1, tag: "UI.Button", slotId: "components.button", module: "./local.js", symbol: "Button" }]);
    expect(runDogfood(input).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF4", slotId: "frames.example" }), expect.objectContaining({ code: "DF5", tag: "Fake" })]));
  });

  it("keeps deterministic output and makes loss of a known token or edge observable", () => {
    const input = fixture(), baseline = buildSurfaceConsumption(input);
    expect(buildSurfaceConsumption({ ...input, sections: [...input.sections].reverse(), frames: [...input.frames].reverse(), sourceScans: [...input.sourceScans].reverse() })).toEqual(baseline);
    // These positive observations are the assertions exercised by the implementation mutation harness.
    expect(baseline.fills[0]!.scannedReads.themes).toContain("tokens.ink");
    expect(baseline.fills[0]!.scannedComposes).toContain("components.button");
    expect(baseline.claims.descriptorConformance).toBe("unmeasured");
  });
});

describe("committed section/frame scan evidence", () => {
  const report = () => JSON.parse(readFileSync(new URL("../catalog/reports/sections-frames-consumption.json", import.meta.url), "utf8"));

  it.each([
    ["sections.data-table", "frames.sheet"],
    ["sections.data-table", "sections.empty-state"],
    ["sections.task-list", "sections.empty-state"],
  ])("S2-2 removes observed prohibited relationship %s -> %s", (slot, prohibited) => {
    const row = report().fills.find((fill: { slot: string }) => fill.slot === slot);
    expect(row.scannedComposes).not.toContain(prohibited);
    expect(row.observedComposes.some((edge: { slotId: string }) => edge.slotId === prohibited)).toBe(false);
  });

  it.each([
    ["sections.data-table", "data-table/ViewOptions.tsx", "components.dialog", "Dialog"],
    ["sections.data-table", "data-table/FlatGrid.tsx", "sections.section-header", "SectionHeader"],
    ["sections.data-table", "data-table/PivotGrid.tsx", "sections.section-header", "SectionHeader"],
    ["sections.task-list", "TaskList.tsx", "sections.section-header", "SectionHeader"],
  ])("S2-2 observes the direct replacement in %s at %s", (slot, file, target, tag) => {
    const row = report().fills.find((fill: { slot: string }) => fill.slot === slot);
    expect(row.observedComposes.some((edge: { file: string; slotId: string; tag: string }) => edge.file.endsWith(`/blocks/${file}`) && edge.slotId === target && edge.tag === tag)).toBe(true);
  });

  it("S2-6 retains unresolved Chip and server Meter ownership and unmeasured claims", () => {
    const actual = report();
    for (const [fill, tag] of [["foundry/sections.data-table", "Chip"], ["foundry/sections.task-list", "Meter"], ["foundry/sections.task-list", "MeterBar"]]) {
      expect(actual.findings.some((finding: { fill: string; code: string; evidence: string }) => finding.fill === fill && finding.code === "DF5" && finding.evidence.includes(`<${tag}>`))).toBe(true);
    }
    expect(actual.claims).toEqual({ consumerAdoption: "unmeasured", descriptorConformance: "unmeasured", reportFreshness: "Reproducibility only; not conformance clearance.", runtimeAccessibility: "unmeasured" });
    expect(actual.fills.filter((fill: { scanStatus: string }) => fill.scanStatus === "lower-bound")).toHaveLength(38);
    expect(actual.inventory.components).not.toContain("components.chip");
  });

  it("pins the known chat composition and under-declared utility reads while preserving primitive boundaries", () => {
    const report = JSON.parse(readFileSync(new URL("../catalog/reports/sections-frames-consumption.json", import.meta.url), "utf8"));
    const chat = report.fills.find((row: { slot: string }) => row.slot === "sections.chat");
    expect(chat.scannedComposes).toContain("components.button");
    expect(chat.sourceFiles.some((file: string) => /components\/Button\.tsx$/.test(file))).toBe(false);
    expect(report.findings.some((row: { code: string; evidence: string }) => row.code === "DF4" && row.evidence.includes("themes."))).toBe(true);
    expect(report.inventory.sections).toHaveLength(45);
    expect(report.inventory.frames).toHaveLength(9);
    expect(report.claims.consumerAdoption).toBe("unmeasured");
  });
});

it.each([
  ["sections.faq", "Faq.tsx"], ["sections.empty-state", "EmptyState.tsx"],
  ["sections.features", "items/compat-features.tsx"], ["sections.pricing", "PricingTable.tsx"],
  ["sections.steps", "OrderedStepSequence.tsx"], ["sections.status-list", "StatusList.tsx"],
  ["sections.record-detail", "DetailView.tsx"],
])("S4-7 observes a real direct Header call in %s", (slot, file) => {
  const actual = JSON.parse(readFileSync(new URL("../catalog/reports/sections-frames-consumption.json", import.meta.url), "utf8"));
  const row = actual.fills.find((fill: { slot: string }) => fill.slot === slot);
  expect(row.observedComposes.some((edge: { file: string; slotId: string; tag: string }) => edge.file.endsWith(`/blocks/${file}`) && edge.slotId === "sections.section-header" && edge.tag === "SectionHeader")).toBe(true);
});

it("S4-7 keeps h1 owners and externally framed bare modules free of synthetic Header/band edges", () => {
  const actual = JSON.parse(readFileSync(new URL("../catalog/reports/sections-frames-consumption.json", import.meta.url), "utf8"));
  for (const slot of ["sections.hero", "sections.content", "sections.page-header", "sections.article", "sections.people", "sections.testimonials", "sections.logo-cloud", "sections.comparison"]) {
    const row = actual.fills.find((fill: { slot: string }) => fill.slot === slot);
    expect(row).toBeDefined();
    expect(row.scannedComposes).not.toContain("sections.section-header");
    expect(row.scannedComposes).not.toContain("sections.band");
  }
  expect(actual.claims.runtimeAccessibility).toBe("unmeasured");
  expect(actual.claims.consumerAdoption).toBe("unmeasured");
});

it.each(["frames.site-header", "frames.app-header"])("S7 records the real header option helper and lower-bound layer scan for %s", slot => {
  const actual = JSON.parse(readFileSync(new URL("../catalog/reports/sections-frames-consumption.json", import.meta.url), "utf8"));
  const row = actual.fills.find((fill: { slot: string }) => fill.slot === slot);
  expect(row.sourceFiles).toContain("packages/designer/src/catalog-core/frame-header-options.ts");
  expect(row.scanStatus).toBe("lower-bound");
  expect(row.scannedReads.themes).toContain("tokens.z-index");
  // A source scan sees all branches; runtime tests separately prove lazy reads for static instances.
  expect(actual.claims.runtimeAccessibility).toBe("unmeasured");
  expect(actual.claims.consumerAdoption).toBe("unmeasured");
});
