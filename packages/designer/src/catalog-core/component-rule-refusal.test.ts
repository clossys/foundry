// @vitest-environment node
import { describe, expect, it } from "vitest";
import { productionCompositionFixture } from "./__fixtures__/date-picker-composition.js";
import { synthetic } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange } from "./changeset-components.js";
import { checkComponentProfile } from "./check-components.js";
import { componentImportClosureFindings } from "./component-import-closure.js";
import { emitComponents } from "./emit-components.js";
import { componentLibraryHash, componentOf, resolveComponents } from "./resolve-components.js";
import type { ComponentCandidate, ComponentLibrary, ComponentRule } from "./resolve-components.js";

/** Refusal side of the derived-rule exemption: a derived fill skips the upstream pin only while its rule proves it. */
const ICON = "components.icon";
function derivedIcon() {
  const { catalog, library } = productionCompositionFixture();
  const base: ComponentLibrary = { ...library, fills: library.fills.filter(doc => componentOf(doc).slot !== ICON) };
  const installed = applyComponentLibraryChange(catalog, base, { baseHash: componentLibraryHash(base), changes: [{ op: "derive", slot: ICON, rule: "derive:icon@1", inputs: [] }] });
  return { catalog, installed };
}
type Derived = ReturnType<typeof derivedIcon>;
const proofFailures = ({ catalog, installed }: Derived, rules: readonly ComponentRule[] = catalog.rules!) => checkComponentProfile({
  slots: catalog.slots, fills: installed.fills.map(componentOf), observations: {}, tokens: {}, assets: [], installedRac: { version: "", instance: "" }, compositions: { rules, library: installed },
}).findings.filter(finding => finding.subject === ICON && finding.code === "K8").map(finding => finding.message);
const iconOrigin = (installed: ComponentLibrary) => (componentOf(installed.fills.find(doc => componentOf(doc).slot === ICON)!) as ComponentCandidate & { origin: { kind: string; rule: string; inputsHash: string } }).origin;

describe("K8 derived fill refusal", () => {
  it("accepts the installed derive rule output with no upstream pin", () => {
    const derived = derivedIcon();
    expect(iconOrigin(derived.installed).kind).toBe("derived");
    expect(proofFailures(derived)).toEqual([]);
  });
  it("refuses an unknown rule id", () => {
    const derived = derivedIcon(); iconOrigin(derived.installed).rule = "derive:missing@1";
    expect(proofFailures(derived)).toContainEqual(expect.stringMatching(/^Registered composition proof failed: components: unknown or ambiguous registered rule$/));
  });
  it("refuses a rule whose kind is not derive", () => {
    const derived = derivedIcon();
    const rules = structuredClone(derived.catalog.rules!); rules.find(rule => rule.id === "derive:icon@1")!.kind = "compose";
    expect(proofFailures(derived, rules)).toContainEqual(expect.stringMatching(/^Registered composition proof failed: components: unknown or ambiguous registered rule$/));
  });
  it("refuses a rule registered for another slot", () => {
    const derived = derivedIcon();
    const rules = structuredClone(derived.catalog.rules!); rules.find(rule => rule.id === "derive:icon@1")!.slot = "components.badge";
    expect(proofFailures(derived, rules)).toContainEqual(expect.stringMatching(/^Registered composition proof failed: components: unknown or ambiguous registered rule$/));
  });
  it("refuses when the rule template descriptor hash changed", () => {
    const derived = derivedIcon();
    const rules = structuredClone(derived.catalog.rules!); const rule = rules.find(candidate => candidate.id === "derive:icon@1")!;
    rule.template.props = [...rule.template.props, "changedProp"];
    expect(proofFailures(derived, rules)).toContainEqual(expect.stringMatching(/^Registered composition proof failed: components: rule output hand-edit requires authored origin$/));
  });
  it("refuses a stale input-closure hash", () => {
    const derived = derivedIcon(); iconOrigin(derived.installed).inputsHash = "0".repeat(64);
    expect(proofFailures(derived)).toContainEqual(expect.stringMatching(/^Registered composition proof failed: components: stale rule inputs$/));
  });
});

describe("component import closure refusal", () => {
  const closure = (content: string) => {
    const path = "components/widget/widget.tsx";
    const fill = { slot: "components.widget", source: "consumer", impl: { kind: "source", entry: path, export: "Widget" }, outputSha256: [{ path, sha256: "0".repeat(64) }] } as unknown as ComponentCandidate;
    return componentImportClosureFindings({ catalog: { fills: [], rules: [] }, fills: new Map([[fill.slot, fill]]), files: [{ path, content }] });
  };
  it("refuses an import that escapes the library root", () => {
    expect(closure('import { x } from "../../../outside";\nexport const Widget = x;')).toEqual([
      { code: "K9", rule: "K9", subject: "components.widget", severity: "error", message: "Source import ../../../outside in components/widget/widget.tsx escapes the component library" },
    ]);
  });
  it("refuses an import that points to no selected file", () => {
    expect(closure('import { y } from "./missing";\nexport const Widget = y;')).toEqual([
      { code: "K9", rule: "K9", subject: "components.widget", severity: "error", message: "Source import ./missing in components/widget/widget.tsx resolves to no selected file" },
    ]);
  });
});

describe("component index glyph provider refusal", () => {
  it("refuses a package fill that reads assets with no registered glyph provider", () => {
    const input = synthetic();
    const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
    const profile = resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: input.check, packageExports: { "test-kit/components": ["Button"], "react-aria-components": ["Button"] } });
    expect(profile.check.ok).toBe(true);
    const component = Object.values(profile.components)[0]!;
    expect(component.impl.kind).toBe("package");
    expect(component.descriptor.pin?.package).not.toBe("@clossys/designer");
    component.reads.assets = ["assets.icon-close"];
    const glyphModule = { path: "adapters/glyphs.ts", glyphs: { "assets.icon-close": [["path", { d: "M6 6l12 12" }]] } };
    expect(() => emitComponents(profile, ["component-index"], { glyphModule } as Parameters<typeof emitComponents>[2])).toThrow("components: registered glyph provider package is unavailable");
  });
});
