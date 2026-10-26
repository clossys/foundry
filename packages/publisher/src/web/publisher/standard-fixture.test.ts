import { productionSettingsFromBinding } from "./production-settings.js";
import { describe, expect, it } from "vitest";
import { checkInstance } from "../../core/instance-binding.check.js";
import { derivePackPipeline } from "./pipeline.js";
import { STANDARD_PACK_FIXTURE, STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "./__fixtures__/standard-website.js";
import { fixtureCompiler } from "./__fixtures__/compiler.js";
import { layoutSourceClosure } from "./__fixtures__/source-closure.mjs";

const renderers = { "layouts.stack": layoutSourceClosure("web/layouts/Stack.tsx"), "layouts.split": layoutSourceClosure("web/layouts/Split.tsx") };
const library = createStandardPackLibrary(renderers);
const configured = Object.fromEntries(STANDARD_PACK_INSTANCES.map(binding => [binding.instanceId, productionSettingsFromBinding(binding)]));

describe("Standard pack fixture qualification", () => {
  it("is explicitly fixture data with placeholder-only, fully bound actual slot types", () => {
    expect(STANDARD_PACK_FIXTURE.fixture).toBe(true);
    expect(STANDARD_PACK_REGISTRIES.formats).toHaveLength(6);
    expect(STANDARD_PACK_INSTANCES.every(instance => instance.format === "web.page.responsive")).toBe(true);
    expect(STANDARD_PACK_REGISTRIES.layouts.find(leaf => leaf.id === "layouts.stack")!.contract.configs.some(config => config.id === "stack.default")).toBe(false);
    expect(STANDARD_PACK_FIXTURE.staticQualification).toBe("unverified");
    for (const instance of STANDARD_PACK_INSTANCES) for (const fill of Object.values(instance.fills).flat()) {
      const section = STANDARD_PACK_REGISTRIES.sections.find(section => section.id === fill.section)!;
      for (const slot of section.contract.slots.filter(slot => slot.required)) expect(fill.content[slot.name]?.kind).toBe(slot.type);
      for (const ref of Object.values(fill.content)) {
        expect(ref.ref).toMatch(/^placeholder\./);
        expect(library.resolveContent(ref)).toEqual(ref);
      }
    }
  });

  it("runs the real renderer closure: About LK2, all other static checks valid, LK12 pending", () => {
    for (const instance of STANDARD_PACK_INSTANCES) {
      const result = checkInstance(instance, library, STANDARD_PACK_REGISTRIES, fixtureCompiler);
      expect(result.findings, instance.instanceId).toEqual(instance.instanceId === "standard.about" ? [{ code: "LK2", path: "layout", message: "Unknown config, member or widening override" }] : []);
      expect(result.pendingChecks).toEqual(["LK12"]);
    }
    const pack = derivePackPipeline(STANDARD_PACK_INSTANCES, library, STANDARD_PACK_REGISTRIES, fixtureCompiler, configured);
    expect(pack.items.map(item => item.column)).toEqual(["Checks", "Layout", "Checks", "Checks", "Checks", "Checks", "Checks", "Checks"]);
    expect(pack.readyCount).toBe(0);
  });

  it("detects an actual renderer mutation without converting it to pending or passing", () => {
    const broken = structuredClone(renderers);
    broken["layouts.stack"].files[broken["layouts.stack"].entry] += '\nexport const Regression = () => <div className="bg-red-500" />;';
    const result = checkInstance(STANDARD_PACK_INSTANCES[0], createStandardPackLibrary(broken), STANDARD_PACK_REGISTRIES, fixtureCompiler);
    expect(result.findings.some(finding => finding.code === "LK11")).toBe(true);
  });
});
