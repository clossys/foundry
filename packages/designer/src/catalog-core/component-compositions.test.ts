import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { productionCompositionFixture } from "./__fixtures__/date-picker-composition.js";
import { applyComponentLibraryChange } from "./changeset-components.js";
import { componentInputsHash, componentLibraryHash, componentOf } from "./resolve-components.js";
import { assertComponentImportClosure } from "./emit-components.js";
import { checkComponentProfile, componentSourceHash, componentTokensHash } from "./check-components.js";
import { validateInstalledComponentRule } from "./component-rule-validation.js";
import { sha256 } from "./digest.js";

const direct = ["components.calendar", "components.date-field", "components.popover"];
const RELATIVE_SPECIFIER = /\b(?:from|import)\s*["'](\.\.?\/[^"']*)["']/g;
describe("composition rule templates", () => {
  it("emit no relative module specifier with a file extension", () => {
    const offending = loadComponentCompositionRules().flatMap(rule => rule.files.flatMap(file =>
      [...file.content.matchAll(RELATIVE_SPECIFIER)].map(match => match[1]!).filter(specifier => /\.(?:js|tsx?)$/.test(specifier)).map(specifier => `${rule.id} ${file.path} -> ${specifier}`)));
    expect(offending).toEqual([]);
  });
  it("commits each template's output receipts from the bytes compose installs (UPDATE_COMPONENT_COMPOSITION_FILLS=1 rewrites them)", () => {
    for (const rule of loadComponentCompositionRules()) {
      // compose installs rule.files verbatim (changeset-components install); receipts are recomputed from them only.
      const receipts = rule.template.outputSha256!.map(receipt => ({ path: receipt.path, sha256: sha256(rule.files.find(file => file.path === receipt.path)!.content) }));
      // Only Foundry-sourced templates are written here; shadcn@aria templates belong to regenerate.mjs.
      if (process.env.UPDATE_COMPONENT_COMPOSITION_FILLS === "1" && rule.template.source === "foundry") {
        const path = resolve(import.meta.dirname, `../catalog/fills/foundry/${rule.slot}.json`);
        let bytes = readFileSync(path, "utf8");
        for (const [index, receipt] of rule.template.outputSha256!.entries()) {
          const old = `"sha256": "${receipt.sha256}"`;
          if (bytes.split(old).length !== 2) throw new Error(`${rule.slot}: receipt ${receipt.path} is not uniquely addressable`);
          bytes = bytes.replace(old, `"sha256": "${receipts[index]!.sha256}"`);
        }
        writeFileSync(path, bytes);
      }
      const committed = JSON.parse(readFileSync(resolve(import.meta.dirname, `../catalog/fills/${rule.template.source}/${rule.slot}.json`), "utf8")).components[rule.slot.slice(11)].outputSha256;
      expect(committed, rule.id).toEqual(receipts);
    }
  });
});
describe("production date-picker composition", () => {
  it("registers one fresh materialized source template with exact direct inputs", () => {
    const rules = loadComponentCompositionRules();
    // Consumed NativeAction adds one native composition; parked date inputs retain their existing @1 rule.
    expect(rules.map(rule => rule.id)).toEqual(["compose:date-picker@1", "compose:native-action@1", "compose:file-trigger@1"]);
    expect(rules[0]).toMatchObject({ id: "compose:date-picker@1", kind: "compose", slot: "components.date-picker", inputs: direct });
    expect(rules[0]!.template.impl).toEqual({ kind: "source", entry: "components/date-picker/date-picker.tsx", export: "DatePicker" });
    expect(rules[0]!.template).not.toHaveProperty("origin");
    expect(rules[0]!.template.reads).toEqual({ tokens: [], assets: ["assets.icon-date"], components: direct });
    expect(rules[0]!.files.map(file => file.path).sort()).toEqual(["components/date-picker/date-picker.tsx", "notices/date-picker.md"]);
    rules[0]!.template.props = [];
    expect(loadComponentCompositionRules()[0]!.template.props).toContain("triggerLabel");
  });
  it("installs the real rule with consumer ownership, exact provenance and unchanged inputs", () => {
    const { catalog, library } = productionCompositionFixture(); const before = structuredClone(library);
    const output = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "compose", slot: "components.date-picker", rule: "compose:date-picker@1" }] });
    const installed = output.fills.find(doc => componentOf(doc).slot === "components.date-picker")!;
    expect(installed.components["date-picker"]!.origin).toEqual({ kind: "composed", rule: "compose:date-picker@1", reads: direct, inputsHash: componentInputsHash(library, direct) });
    expect(installed.$extensions["com.clossys.fill"]).toMatchObject({ source: "consumer", builtOn: direct, originKinds: ["composed"], conforms: [], evidence: [] });
    expect(library).toEqual(before);
    const candidate = { $extensions: { "com.clossys.fill": { ...installed.$extensions["com.clossys.fill"], source: "foundry" } }, components: { "date-picker": { ...catalog.rules![0]!.template } } };
    const adopting = { ...catalog, fills: [...catalog.fills, candidate] };
    expect(() => applyComponentLibraryChange(adopting, { ...library, adoptedAt: "2026-10-24" }, { baseHash: componentLibraryHash({ ...library, adoptedAt: "2026-10-24" }), changes: [{ op: "adopt", slot: "components.date-picker", source: "foundry" }] })).toThrow(/compos/);
  });
  it("hashes shared receipts and transitive selections deterministically without unrelated slots", () => {
    const { library } = productionCompositionFixture(); const original = componentInputsHash(library, direct);
    expect(componentInputsHash({ ...library, files: [...library.files].reverse(), fills: [...library.fills].reverse() }, [...direct].reverse())).toBe(original);
    const changed = structuredClone(library);
    const shared = changed.files.find(file => file.path === "components/_parts/utils/index.ts")!;
    shared.content += "\n";
    expect(() => componentInputsHash(changed, direct)).toThrow(/hash/);
    for (const doc of changed.fills) for (const receipt of componentOf(doc).outputSha256 ?? []) if (receipt.path === shared.path) receipt.sha256 = sha256(shared.content);
    expect(componentInputsHash(changed, direct)).not.toBe(original);
    const transitive = structuredClone(library); componentOf(transitive.fills.find(doc => componentOf(doc).slot === "components.select")!).props = ["changed"];
    expect(componentInputsHash(transitive, direct)).not.toBe(original);
    const unrelated = structuredClone(library); const extra = structuredClone(unrelated.fills[0]!); extra.$extensions["com.clossys.fill"].slot = "components.unrelated"; extra.components = { unrelated: { ...componentOf(unrelated.fills[0]!), slot: "components.unrelated" } }; unrelated.fills = [...unrelated.fills, extra];
    expect(componentInputsHash(unrelated, direct)).toBe(original);
    expect(() => componentInputsHash({ ...library, files: [...library.files, library.files[0]!] }, direct)).toThrow(/duplicate/);
  });
  it("keeps real selected closure blocked by its absent generated facades", () => {
    const { library } = productionCompositionFixture();
    expect(() => assertComponentImportClosure(library.files.filter(file => file.path === "components/select/select.tsx"), {})).toThrow(/^components: missing import \.\.\/icon\/index$/);
  });
  it("K8 accepts exact registered source provenance only in its current consumer context", () => {
    const { catalog, library } = productionCompositionFixture();
    const installed = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "compose", slot: "components.date-picker", rule: "compose:date-picker@1" }] });
    const check = (context = { rules: catalog.rules!, library: installed }) => checkComponentProfile({
      slots: catalog.slots, fills: installed.fills.map(componentOf), observations: {}, tokens: {}, assets: ["assets.icon-date"], installedRac: { version: "", instance: "" }, compositions: context,
    }).findings.filter(finding => finding.subject === "components.date-picker" && finding.code === "K8");
    expect(check()).toEqual([]);
    const stale = structuredClone(catalog.rules!); stale[0]!.template.props = [];
    expect(check({ rules: stale, library: installed }).length).toBeGreaterThan(0);
    expect(check({ rules: [], library: installed }).length).toBeGreaterThan(0);
    const forged = checkComponentProfile({ slots: catalog.slots, fills: installed.fills.map(componentOf), observations: {}, tokens: {}, assets: [], installedRac: { version: "", instance: "" } });
    expect(forged.findings.some(f => f.subject === "components.date-picker" && f.code === "K8")).toBe(true);
  });

  it("rejects unreceipted owned bytes, missing notices and foreign rule output", () => {
    const { catalog, library } = productionCompositionFixture();
    const installed = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "compose", slot: "components.date-picker", rule: "compose:date-picker@1" }] });
    const picker = componentOf(installed.fills.find(doc => componentOf(doc).slot === "components.date-picker")!);
    const extra = { ...installed, files: [...installed.files, { path: "components/date-picker/extra.tsx", content: "export const copied = true;" }] };
    expect(() => validateInstalledComponentRule(picker, { rules: catalog.rules!, library: extra })).toThrow(/unreceipted/);
    const missing = { ...installed, files: installed.files.filter(file => file.path !== "notices/date-picker.md") };
    expect(() => validateInstalledComponentRule(picker, { rules: catalog.rules!, library: missing })).toThrow(/hash|notice/);
    const foreign = structuredClone(catalog); foreign.rules![0]!.files[0]!.path = "components/calendar/copied.tsx";
    expect(() => applyComponentLibraryChange(foreign, library, { baseHash: componentLibraryHash(library), changes: [{ op: "compose", slot: "components.date-picker", rule: "compose:date-picker@1" }] })).toThrow();
  });
  it("delegates focus only to an observed fresh direct child's matching member", () => {
    const { catalog, library } = productionCompositionFixture();
    const installed = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "compose", slot: "components.date-picker", rule: "compose:date-picker@1" }] });
    const tokens = { "tokens.focus-ring.default": { property: "--ring", light: "black" } };
    const measurement = { state: "default", mode: "light" as const, ground: "base", roles: ["group"], keyboard: ["ArrowUp", "ArrowDown", "Escape"], axeViolations: [], focusTokens: [], focusOwner: "components.date-field", forcedColors: { foreground: "CanvasText", background: "Canvas" }, target: { width: 24, height: 24 }, contrast: [] };
    const files = loadComponentCompositionRules()[0]!.files;
    const observation = { files, sourceHash: componentSourceHash(files), tokensHash: componentTokensHash(tokens), root: "rac:DatePicker" as const, forwardsRef: true, forwardsRenderProps: true, rac: { version: "1.21.1", instance: "test", dependency: "source" as const }, calls: [{ target: "components.date-field", contextRoot: "rac:DateField", props: [], members: [] }], measurements: [], memberObservations: Object.fromEntries(["single", "range"].map(selection => [`selection.${selection}`, { root: selection === "single" ? "rac:DatePicker" as const : "rac:DateRangePicker" as const, forwardsRef: true, forwardsRenderProps: true, calls: [{ target: "components.date-field", contextRoot: "rac:DateField", props: [], members: [] }], measurements: [measurement, { ...measurement, mode: "dark" as const }] }])) };
    const childFiles = [{ path: "DateField.tsx", content: 'import {DateField} from "react-aria-components";' }];
    const child = { ...observation, files: childFiles, sourceHash: componentSourceHash(childFiles), root: "rac:DateField" as const, memberObservations: undefined, measurements: [measurement, { ...measurement, mode: "dark" as const }].map(value => ({ ...value, focusOwner: undefined, focusTokens: ["tokens.focus-ring.default"] })) };
    const input = { slots: catalog.slots, fills: installed.fills.map(componentOf), observations: { "components.date-picker": observation, "components.date-field": child }, tokens, assets: ["assets.icon-date"], installedRac: { version: "1.21.1", instance: "test" }, compositions: { rules: catalog.rules!, library: installed } };
    const field = input.fills.find(fill => fill.slot === "components.date-field")!; field.reads.tokens = [...field.reads.tokens, "tokens.focus-ring"];
    // Keep the current consumer descriptor in the exact provenance domain.
    componentOf(installed.fills.find(doc => componentOf(doc).slot === field.slot)!).reads.tokens = field.reads.tokens;
    const picker = input.fills.find(fill => fill.slot === "components.date-picker")!;
    (picker as typeof picker & { origin: { inputsHash: string } }).origin.inputsHash = componentInputsHash(installed, direct);
    const focusErrors = () => checkComponentProfile(input).findings.filter(f => f.subject === "components.date-picker" && /Focus-visible/.test(f.message));
    expect(focusErrors()).toEqual([]);
    input.compositions.rules = [];
    expect(focusErrors().length).toBeGreaterThan(0);
    input.compositions.rules = catalog.rules!;
    for (const mutate of [() => { child.sourceHash = "stale"; }, () => { observation.memberObservations["selection.range"]!.measurements[0]!.focusOwner = "components.button"; }, () => { child.measurements[0]!.focusTokens = []; }]) {
      const sourceHash = child.sourceHash; const focusOwner = observation.memberObservations["selection.range"]!.measurements[0]!.focusOwner; const focusTokens = child.measurements[0]!.focusTokens;
      mutate(); expect(focusErrors().length).toBeGreaterThan(0); child.sourceHash = sourceHash; observation.memberObservations["selection.range"]!.measurements[0]!.focusOwner = focusOwner; child.measurements[0]!.focusTokens = focusTokens;
    }
  });
});
