/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { loadCatalog, loadComponentRegistry } from "./index.js";
import { selectedPackageClosure } from "./__fixtures__/surface-engine/selected-package-closure.js";
import { contractFindings, type SurfaceDefaultDescriptor } from "./surface-defaults.js";
import { buildSurfaceConsumption } from "./surface-consumption.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { adoptedSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { surfaceDescriptorHash, surfaceDocument, surfaceEntryOf, surfaceManifest, surfaceOf, surfacePackageDescriptorHash } from "./surface-library.js";
import type { FrameSlot } from "./types.js";
import { measuredSurfaceConsumption } from "../importers/foundry-surface-consumption.js";
import { sha256 } from "./digest.js";

const app = () => structuredClone((frameSlots as unknown as FrameSlot[]).find(slot => slot.id === "frames.app-shell")!);
const descriptor = () => structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!.frames["app-shell"]!) as SurfaceDefaultDescriptor & Record<string, any>;
/** SYNTHETIC parser input: observations come from the same scanner as real descriptors. */
const measured = (token = false) => {
  const file = { path: "src/Example.tsx", content: token ? 'export const View = () => <div style={{gap:"var(--spacing-md)"}}/>;' : 'import { Avatar } from "./Avatar.js"; export const View = () => <Avatar/>;' };
  const row = buildSurfaceConsumption({ tokens: [{ id: "themes.spacing", contract: { emit: { md: "--spacing-md" } } }], assets: [], components: [{ id: "components.avatar" }], sections: [], frames: [app()], fills: [{ id: "synthetic", slot: "frames.app-shell", source: "synthetic" }], sourceScans: [{ fill: "synthetic", files: [file], resolvedImports: { "src/Example.tsx:./Avatar.js#Avatar": "components.avatar" } }], themeCss: "" }).fills[0]!;
  return { scanStatus: row.scanStatus as "lower-bound", sourceFiles: [{ path: file.path, sha256: sha256(file.content) }], scannedReads: row.scannedReads, scannedComposes: row.scannedComposes };
};

it("refuses actual package composition outside the contract even when declared fields underreport it", () => {
  const slot = app(), fill = descriptor();
  slot.contract.composes = [];
  Object.assign(fill, { reads: { themes: [], assets: [] }, composes: [], consumption: measured() });
  expect(contractFindings(slot, fill).join(" ")).toContain("unsupported composes: components.avatar");
  expect(contractFindings(slot, fill).join(" ")).toContain("underreported composes: components.avatar");
});

it("refuses actual package reads outside the contract even when declared fields underreport them", () => {
  const slot = app(), fill = descriptor();
  slot.contract.allowedReads.themes = [];
  Object.assign(fill, { reads: { themes: [], assets: [] }, composes: [], consumption: measured(true) });
  expect(contractFindings(slot, fill).some(row => row.startsWith("S5 unsupported tokens:") && row.includes("themes.spacing"))).toBe(true);
  expect(contractFindings(slot, fill).some(row => row.startsWith("S5 underreported tokens:") && row.includes("themes.spacing"))).toBe(true);
});

it("does not mistake an absent package consumption measurement for an empty successful scan", () => {
  const fill = descriptor();
  delete fill.consumption;
  expect(contractFindings(app(), fill).join(" ")).toContain("S8 surface consumption measurement unavailable");
});

it("reads historical package descriptors without injecting fields or changing their original hashes", () => {
  const doc = structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!);
  const old = doc.frames["app-shell"] as any;
  delete old.reads; delete old.composes; delete old.consumption;
  const before = JSON.stringify(doc), hash = surfacePackageDescriptorHash(old);
  const parsed = surfaceEntryOf(doc as any);
  expect(parsed).not.toHaveProperty("consumption");
  expect(parsed).not.toHaveProperty("reads");
  expect(parsed).not.toHaveProperty("composes");
  expect(surfacePackageDescriptorHash(parsed as any)).toBe(hash);
  expect(JSON.stringify(doc)).toBe(before);
  expect(contractFindings(app(), parsed as any, doc.$extensions["com.clossys.fill"].pin)).toContain("S8 surface consumption measurement unavailable");
});

it("carries measured reads and composes on every real generated package descriptor", () => {
  const docs = [...importFoundrySections().fills, ...importFoundryFrames().fills];
  expect(docs).toHaveLength(62);
  for (const doc of docs) {
    const fill = Object.values((doc as any).sections ?? (doc as any).frames)[0] as any;
    expect(fill.consumption?.scanStatus, fill.slot).toBe("lower-bound");
    expect(fill.reads, fill.slot).toEqual({ tokens: fill.consumption.scannedReads.themes, assets: fill.consumption.scannedReads.assets });
    expect(fill.composes, fill.slot).toEqual(fill.consumption.scannedComposes);
    expect(fill.consumption.sourceFiles.length, fill.slot).toBeGreaterThan(0);
  }
});

it("accepts the real app-shell closure after its legitimate actual use is declared", () => {
  const fill = descriptor();
  expect(fill.consumption?.scannedComposes).toEqual(expect.arrayContaining(["components.avatar", "components.banner", "components.resize-handle", "frames.sheet"]));
  expect(fill.consumption?.sourceFiles.some((row: { path: string }) => row.path.endsWith("/frames/AppFrame.tsx"))).toBe(true);
  expect(contractFindings(app(), fill)).toEqual([]);
});

it("source resolution refuses an underreported actual read and uses the same contract diagnostic", () => {
  const { input, bundle } = adoptedSurface();
  const fill = structuredClone(surfaceOf(input.library.surfaces!.fills[0]!));
  const files = input.library.surfaces!.files.map(file => file.path === fill.impl.entry ? { ...file, content: 'export function Synthetic() { return "var(--color-ink-primary)"; }\n' } : file);
  fill.outputSha256 = surfaceManifest(files);
  fill.origin = { kind: "authored", license: fill.license, lineage: bundle.base, descriptorHash: surfaceDescriptorHash(fill) };
  input.library.surfaces = { ...input.library.surfaces!, fills: [surfaceDocument(input.library, fill as any)], files };
  const findings = resolve(input).surfaces!.check.findings;
  expect(findings.some(row => row.code === "S5" && row.message === "unsupported tokens: themes.foreground")).toBe(true);
  expect(findings.some(row => row.code === "S5" && row.message === "underreported tokens: themes.foreground")).toBe(true);
});

it("source resolution refuses undeclared actual composition through the selected component index", () => {
  const { input, bundle } = adoptedSurface();
  input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } }] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
  const fill = structuredClone(surfaceOf(input.library.surfaces!.fills[0]!));
  const originalEntry = fill.impl.entry;
  fill.impl.entry = originalEntry.replace(/\.ts$/, ".tsx");
  fill.bindings = [{ file: fill.impl.entry, module: "../../components/button/index.js", name: "Button", local: "Action", slot: "components.button" }];
  fill.dependencies = [{ module: "@clossys/designer/components", version: "0.12.0", license: "MIT" }, { module: "react", version: "19.3.0", license: "MIT" }];
  input.surfaceOptions!.packages = [{ module: "@clossys/designer/components", version: "0.12.0", artifactSha256: "b".repeat(64), values: ["Button"], types: [] }, { module: "react", version: "19.3.0", artifactSha256: "d".repeat(64), values: ["createElement", "forwardRef"], types: ["ComponentType"] }];
  const files = input.library.surfaces!.files.map(file => file.path === originalEntry ? { ...file, path: fill.impl.entry, content: 'import { Button as Action } from "../../components/button/index.js"; export function Synthetic() { return <Action/>; }\n' } : file);
  fill.outputSha256 = surfaceManifest(files);
  const install = () => {
    fill.origin = { kind: "authored", license: fill.license, lineage: bundle.base, descriptorHash: surfaceDescriptorHash(fill) };
    input.library.surfaces = { ...input.library.surfaces!, fills: [surfaceDocument(input.library, fill as any)], files };
  };
  install();
  const findings = resolve(input).surfaces!.check.findings;
  expect(findings.filter(row => row.code === "S4")).toEqual([]);
  expect(findings.some(row => row.code === "S5" && row.message === "unsupported composes: components.button")).toBe(true);
  expect(findings.some(row => row.code === "S5" && row.message === "underreported composes: components.button")).toBe(true);
  (input.catalog.surfaces!.slots[0]!.contract as any).allowedComposes = ["components.button"];
  fill.composes = ["components.button"];
  install();
  expect(resolve(input).surfaces!.check.findings.some(row => row.code === "S5" && /unsupported|underreported/.test(row.message))).toBe(false);
});

async function packageInput(underreport: boolean | "measurement" = false) {
  const slot = app();
  const doc = structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot.id)!);
  const catalog = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces: { slots: [slot], fills: [doc], transforms: [], rules: [], materializations: [] } };
  const { library, componentOptions } = selectedPackageClosure(catalog);
  const input = { catalog, library, componentOptions, surfaceOptions: { packages: await readSurfacePackageEvidence([doc]), measurements: [] } };
  const fill = doc.frames["app-shell"]!;
  if (underreport) {
    fill.reads = { tokens: [], assets: [] };
    fill.composes = [];
    if (underreport === "measurement") fill.consumption = { ...fill.consumption, scannedReads: { themes: [], assets: [], components: [] }, scannedComposes: [] };
    else slot.contract.composes = [];
  }
  input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "frames.app-shell", source: "foundry" } }] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions });
  return input;
}

it("package resolution enforces measured actual use through the public engine", async () => {
  const findings = resolve(await packageInput(true)).surfaces!.check.findings;
  expect(findings.some(row => row.code === "S5" && row.message.startsWith("unsupported composes:") && row.message.includes("components.avatar"))).toBe(true);
  expect(findings.some(row => row.code === "S5" && row.message.startsWith("underreported composes:"))).toBe(true);
});

it("the public package engine accepts the measured app-shell with its declared contract", async () => {
  const result = resolve(await packageInput()).surfaces!;
  expect(result.check.ok).toBe(true);
  expect(result.check.findings.filter(row => row.severity === "error")).toEqual([]);
  expect(result.files).toEqual([]);
});

it("refuses a forged empty package snapshot even when its caller-controlled catalog descriptor agrees", async () => {
  const result = resolve(await packageInput("measurement")).surfaces!;
  expect(result.check.ok).toBe(false);
  expect(result.check.findings.some(row => row.code === "S8" && row.message === "package consumption snapshot differs from canonical measurement")).toBe(true);
  expect(result.check.findings.some(row => row.code === "S5" && row.message.startsWith("underreported composes:") && row.message.includes("components.avatar"))).toBe(true);
  expect(result.check.findings.some(row => row.code === "S5" && row.message.startsWith("underreported tokens:"))).toBe(true);
});

it("keeps the measurement scanner's observed facts separate from broad allowed reads", () => {
  const slot = app();
  const report = buildSurfaceConsumption({ tokens: [], assets: [], components: [], sections: [], frames: [slot], fills: [{ id: "test", slot: slot.id, source: "test" }], sourceScans: [{ fill: "test", files: [{ path: "src/plain.ts", content: "export const Plain = 1;" }] }], themeCss: "" });
  expect(report.fills[0]!.scannedReads).toEqual({ tokens: [], assets: [], components: [] });
  expect(report.fills[0]!.scannedComposes).toEqual([]);
  expect(readFileSync(new URL("../catalog/slots/frames.json", import.meta.url), "utf8")).toContain("frames.app-shell");
});

it("refuses missing or mismatched package measurement identities", () => {
  expect(() => measuredSurfaceConsumption("frames.unknown", { package: "@clossys/designer", version: "0.12.0", export: "./frames#AppFrame" })).toThrow("measurement unavailable");
  expect(() => measuredSurfaceConsumption("frames.app-shell", { package: "@clossys/designer", version: "0.12.1", export: "./frames#AppFrame" })).toThrow("measurement unavailable");
});

it("recalculates all current descriptor measurements and canonical importer output from actual source", () => {
  const output = execFileSync(process.execPath, ["scripts/generate-surface-consumption.mjs", "--check"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", timeout: 60_000 });
  expect(JSON.parse(output)).toMatchObject({ descriptors: 62, measured: 62, measurement: "source-only lower-bound", runtime: "unmeasured" });
}, 65_000);
