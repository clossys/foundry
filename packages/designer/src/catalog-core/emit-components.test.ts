// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { synthetic, syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange, materializeSourceFill } from "./changeset-components.js";
import { assertComponentIdentifier, assertPackageSpecifier, componentLibraryHash, componentMaterializationReport, resolveComponents } from "./resolve-components.js";
import type { ComponentCandidateDocument } from "./resolve-components.js";
import { assertComponentImportClosure, emitComponents } from "./emit-components.js";
import { stableStringify } from "./stable.js";
import { sha256 } from "./digest.js";
import { componentSourceHash } from "./check-components.js";

const golden = (name: string) => readFileSync(resolve(import.meta.dirname, "__golden__/components", name), "utf8");
const packageExports = { "test-kit/components": ["Button"], "react-aria-components": ["Button"] };
function typecheckSynthetic(files: readonly { path: string; content: string }[]): readonly string[] {
  const root = resolve(import.meta.dirname, "__synthetic_codegen__");
  const virtual = new Map(files.filter(file => /\.tsx?$/.test(file.path)).map(file => [resolve(root, file.path), file.content]));
  virtual.set(resolve(root, "surfaces.d.ts"), 'declare module "test-kit/components" { export const Button: import("react").ComponentType<Record<string, unknown>>; }\ndeclare module "react-aria-components" { export const Button: import("react").ComponentType<Record<string, unknown>>; }\n');
  const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
  const host = ts.createCompilerHost(options);
  const originalFile = host.fileExists.bind(host), originalRead = host.readFile.bind(host), originalSource = host.getSourceFile.bind(host), originalDirectory = host.directoryExists!.bind(host);
  host.fileExists = path => virtual.has(path) || originalFile(path);
  host.readFile = path => virtual.get(path) ?? originalRead(path);
  host.directoryExists = path => path.startsWith(root) || originalDirectory(path);
  host.getSourceFile = (path, languageVersion, onError, create) => virtual.has(path) ? ts.createSourceFile(path, virtual.get(path)!, languageVersion) : originalSource(path, languageVersion, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
}
function packageProfile() {
  const input = synthetic();
  const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
  return resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: input.check, packageExports });
}
describe("SYNTHETIC component code generation; no shipped conformance claims", () => {
  it("matches the all-package synthetic golden and parses every emitted TypeScript module", () => {
    const profile = packageProfile(); expect(profile.check.ok).toBe(true);
    const files = emitComponents(profile, ["component-index"]);
    expect(stableStringify(files)).toBe(golden("synthetic-package.json"));
    for (const file of files) expect(ts.transpileModule(file.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
    expect(typecheckSynthetic(files)).toEqual([]);
  });
  it("matches a labeled mixed synthetic golden; source and package origins remain separate", async () => {
    const input = syntheticSource();
    const pkg = synthetic();
    const badge = structuredClone(pkg.doc);
    badge.$extensions["com.clossys.fill"].id = "test-kit/components.badge"; badge.$extensions["com.clossys.fill"].slot = "components.badge";
    badge.components = { badge: { ...pkg.candidate, slot: "components.badge" } };
    const catalog = { ...input.catalog, slots: [...input.catalog.slots, { ...input.catalog.slots[0]!, id: "components.badge" }], fills: [badge, input.doc] };
    const bundle = await materializeSourceFill(input.candidate, async () => input.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [input.file, input.notice], blockers: [] }) }]);
    const library = applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }, { op: "adopt", slot: "components.badge", source: "test-kit" }] }, [bundle]);
    const evidence = { ...input.check, observations: { ...input.check.observations, "components.badge": pkg.check.observations["components.button"] } };
    const profile = resolveComponents({ catalog, library, values: input.check, evidence, packageExports });
    expect(profile.check.ok).toBe(true);
    const files = emitComponents(profile, ["component-index"]);
    expect(stableStringify(files)).toBe(golden("synthetic-mixed.json"));
    expect(typecheckSynthetic(files)).toEqual([]);
    for (let seed = 1; seed <= 5; seed++) {
      let state = seed;
      const shuffle = <T,>(items: readonly T[]): T[] => {
        const result = [...items];
        for (let index = result.length - 1; index > 0; index--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const other = state % (index + 1); [result[index], result[other]] = [result[other]!, result[index]!]; }
        return result;
      };
      const permuted = resolveComponents({ catalog: { ...catalog, slots: shuffle(catalog.slots), fills: shuffle(catalog.fills) }, library: { ...library, fills: shuffle(library.fills), files: shuffle(library.files) }, values: input.check, evidence, packageExports });
      expect(emitComponents(permuted, ["component-index"])).toEqual(files);
    }
  });
  it("identifier guard rejects generated-code injection", () => {
    expect(() => assertComponentIdentifier('Button;throw Error("injected")')).toThrow(/identifier/);
  });
  it("specifier guard rejects generated-code injection", () => {
    expect(() => assertPackageSpecifier('test-kit/components";throw Error("injected")')).toThrow(/specifier/);
  });
  it("closes named imports and rejects unsupported mapping grammar or unavailable observations", () => {
    expect(() => assertComponentImportClosure([{ path: "components/calendar/calendar.tsx", content: 'import { buttonVariants } from "../button/index.js";' }, { path: "components/button/index.ts", content: 'export { Button } from "test-kit/components";' }], packageExports)).toThrow(/unavailable named import/);
    const profile = packageProfile();
    profile.components["components.button"]!.descriptor.propMap = { "variant.primary": "Button[arbitrary()]" };
    profile.components["components.button"]!.propMap = profile.components["components.button"]!.descriptor.propMap;
    expect(() => emitComponents(profile, ["component-index"])).toThrow(/unsupported propMap/);
    const missing = packageProfile(); missing.check = { ok: false, findings: [] };
    expect(() => emitComponents(missing, ["component-index"])).toThrow(/checks failed/);
    expect(JSON.parse(emitComponents(missing, ["components-consumption"])[0]!.content).status).toBe("blocked");
  });
  it("emits a runtime-pending selection with the same code and never reports it as observations-pass", () => {
    const observed = packageProfile(), input = synthetic();
    const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
    const pending = resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: { ...input.check, observations: {} }, packageExports });
    expect(pending.check.ok).toBe(true);
    expect(pending.check.findings.length).toBeGreaterThan(0);
    expect(pending.check.findings.every(finding => finding.severity === "notice")).toBe(true);
    const status = (profile: typeof observed) => JSON.parse(emitComponents(profile, ["components-consumption"])[0]!.content).status;
    expect(status(pending)).toBe("runtime-pending");
    expect(status(observed)).toBe("observations-pass");
    expect(emitComponents(pending, ["component-index"])).toEqual(emitComponents(observed, ["component-index"]));
  });
  it.each(["select", "combo-box", "calendar", "popover", "checkbox"])("owns exactly one %s facade in a checker-approved SYNTHETIC selected layout", async leaf => {
    // Synthetic Button protocol under the selected path layout: this proves the
    // generator's ownership/dispatch algorithm, never these real components.
    const input = syntheticSource(), slot = `components.${leaf}`;
    const name = leaf.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    const file = { path: `components/${leaf}/${leaf}.tsx`, content: `import { Button } from "react-aria-components"; export { Button as ${name}${leaf === "calendar" ? ", Button as RangeCalendar" : ""} };\n` };
    const candidate = input.candidate;
    candidate.slot = slot; candidate.impl = { kind: "source", entry: file.path, export: name };
    candidate.propMap = Object.fromEntries(candidate.members.map(member => [member, `${name}.${member.replace(".", "=")}`]));
    const contract = structuredClone(input.catalog.slots[0]!); contract.id = slot;
    if (leaf === "calendar") {
      candidate.members = [...candidate.members, "selection.single", "selection.range"];
      candidate.propMap = { ...candidate.propMap, "selection.single": name, "selection.range": "RangeCalendar" };
      if (contract.contract.members.mode === "closed") contract.contract.members.names = [...candidate.members];
    }
    candidate.outputSha256 = [file, input.notice].map(file => ({ path: file.path, sha256: sha256(file.content) }));
    input.doc.components = { [leaf]: candidate };
    Object.assign(input.doc.$extensions["com.clossys.fill"], { id: `test-kit/${slot}`, slot });
    const catalog = { ...input.catalog, slots: [contract] };
    const observed = input.check.observations["components.button"]!;
    observed.files = [file, input.notice]; observed.sourceHash = componentSourceHash(observed.files); observed.outputSha256 = candidate.outputSha256;
    const checks = { ...input.check, slots: [contract], fills: [candidate], observations: { [slot]: observed } };
    const bundle = await materializeSourceFill(candidate, async () => input.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [file, input.notice], blockers: [] }) }]);
    const library = applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot, source: candidate.source }] }, [bundle]);
    const profile = resolveComponents({ catalog, library, values: checks, evidence: checks, packageExports });
    expect(profile.check.ok, JSON.stringify(profile.check.findings)).toBe(true);
    const files = emitComponents(profile, ["component-index"]), path = `components/${leaf}/index.ts`;
    expect(files.filter(file => file.path === path)).toHaveLength(1);
    if (leaf === "calendar") {
      expect(files.find(file => file.path === path)!.content).toContain('"range"');
      expect(files.find(file => file.path === path)!.content).toContain("RangeCalendar as Impl");
    }
    const withStoredIndex = { ...profile, files: [...profile.files, { path, content: `export { ${name} } from "./${leaf}.js";` }] };
    expect(() => emitComponents(withStoredIndex, ["component-index"])).toThrow(/generated entrypoint conflicts/);
  });
  it("still refuses raw namespace/wildcard syntax and unavailable selected subparts", () => {
    const path = "components/select/select.tsx";
    expect(() => assertComponentImportClosure([{ path, content: 'import * as React from "react"; export const Select = React.Fragment;' }], { react: ["Fragment"] })).toThrow(/unsupported import syntax/);
    expect(() => assertComponentImportClosure([{ path, content: 'export * from "react";' }], { react: ["Fragment"] })).toThrow(/wildcard/);
    expect(() => assertComponentImportClosure([
      { path: "components/calendar/calendar.tsx", content: 'import { SelectTrigger } from "../select/index.js";' },
      { path: "components/select/index.ts", content: 'export { Select } from "test-kit/components";' },
    ], { "test-kit/components": ["Select"] })).toThrow(/unavailable named import SelectTrigger/);
  });
});

describe("real source materialization remains blocked", () => {
  it("reports 24 of 26 descriptors blocked and refuses real button, select and calendar adoption", () => {
    const directory = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
    const fills = readdirSync(directory).filter(path => path !== "components.coverage.json").map(path => JSON.parse(readFileSync(resolve(directory, path), "utf8")) as ComponentCandidateDocument);
    const input = synthetic();
    const report = componentMaterializationReport({ ...input.catalog, fills });
    expect(stableStringify(report)).toBe(golden("real-blocked.json"));
    expect(report.blockedCount).toBe(24); expect(report.descriptorCount).toBe(26);
    for (const slot of ["components.button", "components.select", "components.calendar"]) {
      const catalog = { ...input.catalog, slots: [{ ...input.catalog.slots[0]!, id: slot }], fills };
      expect(() => applyComponentLibraryChange(catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot, source: "shadcn@aria" }] })).toThrow(/blocked materialization/);
    }
  });
});
