import { fixtureCompiler } from "./__fixtures__/compiler.js";
import { productionSettingsFromBinding } from "./production-settings.js";
import { describe, expect, it } from "vitest";
import { checkInstance } from "../../core/instance-binding.check.js";
import { FIXTURE_INSTANCE_LIBRARY as library, FIXTURE_INSTANCE_REGISTRIES as registries, STANDARD_INSTANCE_FIXTURES as instances } from "../instances/__fixtures__/standard-instances.js";
import { STANDARD_PACK_INSTANCES } from "./__fixtures__/standard-website.js";
import { instanceFixture, key, tileFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import type { FlowInstanceBinding as InstanceBinding } from "../../core/instance-binding.js";
import { derivePackPipeline, PUBLISH_STAGES, STANDARD_WEBSITE_LANES } from "./pipeline.js";

const configured = Object.fromEntries(instances.map(binding => [binding.instanceId, productionSettingsFromBinding(binding)]));

it.each(["non-owner", "invalid receipt", "frame", "layout", "malformed section", "malformed tile", "malformed frame slots", "missing grounds"] as const)("keeps skipped dependent checks pending after %s evidence is lost", mutation => {
  const f = mutation === "malformed tile" ? tileFixture() : instanceFixture();
  const expected = ["LK8"];
  if (mutation === "non-owner") f.fills.delete(key("sections.content", "default"));
  else if (mutation === "invalid receipt") f.fills.get(key("sections.content", "default"))!.library = "other";
  else if (mutation === "frame") { f.fills.delete(key(f.binding.frame.leaf, f.binding.frame.config)); expected.push("LK9"); }
  else if (mutation === "layout") {
    f.fills.get(key(f.binding.frame.leaf, f.binding.frame.config))!.headerGround = "opaque";
    f.fills.delete(key(f.binding.layout.leaf, f.binding.layout.config)); expected.push("LK9");
  } else if (mutation === "malformed section" || mutation === "malformed tile") {
    const fill = mutation === "malformed tile" ? f.binding.fills.tiles![0]! : f.binding.fills.body![0]!;
    delete (fill as { content?: unknown }).content;
    expected.push("LK6", "LK10");
    if (mutation === "malformed tile") expected.push("LK13");
  } else if (mutation === "malformed frame slots") {
    f.binding.frame.slotFills = { unknown: structuredClone(f.binding.fills.body![0]!) } as never;
    expected.push("LK6", "LK10");
  } else {
    f.fills.get(key(f.binding.frame.leaf, f.binding.frame.config))!.headerGround = "opaque";
    delete f.fills.get(key(f.binding.layout.leaf, f.binding.layout.config))!.leadGround;
    delete f.fills.get(key("sections.hero", "default"))!.bandGround;
    expected.splice(0, 1, "LK9");
  }
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler,
    { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  for (const code of expected) {
    expect(item.checks.find(check => check.code === code), code).toMatchObject({ status: "pending", findings: [] });
    expect(item.unavailableChecks).toContain(code);
  }
  expect(item.staticCoverage).toBe("unavailable");
  expect(item.wholeInstanceLK12).toBe("pending");
  expect(item.state).not.toBe("ready");
});

it.each(["LK8", "LK9"] as const)("retains known %s failures when other evidence is unavailable", code => {
  const f = instanceFixture();
  f.fills.delete(key(f.binding.frame.leaf, f.binding.frame.config));
  if (code === "LK8") f.fills.get(key("sections.content", "default"))!.headings = [1];
  else f.fills.get(key(f.binding.layout.leaf, f.binding.layout.config))!.leadGround = "inverse";
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler,
    { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.unavailableChecks).toContain(code);
  expect(item.checks.find(check => check.code === code)?.status).toBe("failed");
  expect(item.wholeInstanceLK12).toBe("pending");
  expect(item.state).not.toBe("ready");
});

it("does not substitute a later known section for a malformed first ground participant", () => {
  const f = instanceFixture();
  delete (f.binding.fills.lead![0]! as { content?: unknown }).content;
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler,
    { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.checks.find(check => check.code === "LK8")?.status).toBe("failed");
  expect(item.checks.find(check => check.code === "LK9")).toMatchObject({ status: "pending", findings: [] });
  expect(item.unavailableChecks).toContain("LK9");
  expect(item.state).not.toBe("ready");
});

it("projects every real static LK check and keeps whole-instance LK12 pending", () => {
  const f = instanceFixture();
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler, { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.checks.map(check => check.code)).toEqual(Array.from({ length: 16 }, (_, i) => `LK${i + 1}`));
  expect(item.checks.filter(check => check.code !== "LK12" && check.code !== "LK15").every(check => check.status === "passed")).toBe(true);
  expect(item.checks.find(check => check.code === "LK12")).toMatchObject({ status: "pending", findings: [] });
  expect(item.stages.find(stage => stage.name === "Ready")?.status).toBe("pending");
  expect(item.state).toBe("pending");
  expect(item.staticCoverage).toBe("complete");
  expect(item.wholeInstanceLK12).toBe("pending");
  expect(item.stateCoverage).toBe("checked");
});

it.each(["fill", "config", "content", "content type", "parser", "source"] as const)("re-evaluates host %s mutations without stale passing evidence", mutation => {
  const f = instanceFixture();
  const settings = { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) };
  let code: string;
  if (mutation === "fill") { f.fills.delete(key("sections.hero", "default")); code = "LK7"; }
  else if (mutation === "config") { settings[f.binding.instanceId] = { ...settings[f.binding.instanceId]!, layout: { ...f.binding.layout, config: "unknown" } }; code = "LK2"; }
  else if (mutation === "content") { f.content.clear(); code = "LK10"; }
  else if (mutation === "content type") { f.binding.fills.lead![0]!.content.title!.kind = "media"; code = "LK10"; }
  else if (mutation === "parser") code = "LK11";
  else { f.fills.get(key(f.binding.layout.leaf, f.binding.layout.config))!.renderer!.files["Layout.tsx"] = 'export const Layout = () => <div className="bg-red-500" />;'; code = "LK11"; }
  const item = derivePackPipeline([f.binding], f.library, f.registries, mutation === "parser" ? undefined : fixtureCompiler, settings).items[0]!;
  expect(item.checks.find(check => check.code === code)?.status).toBe("failed");
  expect(item.checks.find(check => check.code === "LK12")?.status).toBe("pending");
  expect(item.stages.find(stage => stage.name === "Ready")?.status).toBe("pending");
  expect(item.state).not.toBe("ready");
});

it("never treats a short-circuited or unavailable check as passing", () => {
  const f = instanceFixture();
  f.binding.layout.config = "unknown";
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler, { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.checks.find(check => check.code === "LK2")?.status).toBe("failed");
  expect(item.checks.find(check => check.code === "LK10")?.status).toBe("pending");
  expect(item.checks.find(check => check.code === "LK11")?.status).toBe("pending");
  expect(item.stages.find(stage => stage.name === "Fills")?.status).toBe("pending");
  expect(item.stages.find(stage => stage.name === "Ready")?.status).toBe("pending");
  expect(item.staticCoverage).toBe("short-circuited");
  expect(item.stateCoverage).toBe("unavailable");
});

it.each([undefined, []])("does not claim state support from absent or empty instance states: %s", states => {
  const f = instanceFixture();
  if (states === undefined) delete f.binding.states;
  else f.binding.states = states;
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler,
    { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.checks.find(check => check.code === "LK14")?.status).toBe("pending");
  expect(item.unavailableChecks).toContain("LK14");
  expect(item.staticCoverage).toBe("unavailable");
  expect(item.stateCoverage).toBe("not-requested");
  expect(item.state).not.toBe("ready");
});

describe("pack pipeline evidence", () => {
  it("keeps all eight Standard identities in their five lanes, outside closed bindings", () => {
    expect(STANDARD_WEBSITE_LANES.map(lane => [lane.label, lane.instanceIds.length])).toEqual([
      ["Landing", 1], ["Document", 3], ["Contact", 1], ["Showcase", 1], ["Status", 2],
    ]);
    expect(STANDARD_WEBSITE_LANES.flatMap(lane => lane.instanceIds).sort()).toEqual(STANDARD_PACK_INSTANCES.map(item => item.instanceId).sort());
    expect(instances.every(item => !("lane" in item))).toBe(true);
  });

  it("preserves About's actual LK1 before LK2 and never invents later proof", () => {
    const pack = derivePackPipeline(instances, library, registries, undefined, configured);
    const about = pack.items.find(item => item.binding.instanceId === "standard.about")!;
    expect(checkInstance(about.binding, library, registries).findings.map(finding => finding.code)).toEqual(["LK1", "LK2"]);
    expect(about.column).toBe("Frame");
    expect(about.stages.map(stage => [stage.name, stage.status])).toEqual([
      ["Configure", "passed"], ["Frame", "failed"], ["Layout", "failed"], ["Fills", "pending"], ["Content", "pending"], ["Checks", "failed"], ["Ready", "pending"], ["Export", "unknown"], ["Deploy", "unknown"],
    ]);
    expect(about.stages.find(stage => stage.name === "Checks")!.pending).toContain("LK12 rendered responsive evidence is unavailable");
    expect(pack.readyCount).toBe(0);
  });

  it("does not call content checked when missing section contracts skipped LK10", () => {
    const home = derivePackPipeline(instances, library, registries, undefined, configured).items[0]!;
    expect(home.stages.find(stage => stage.name === "Content")!.status).toBe("pending");
    expect(home.stages.find(stage => stage.name === "Content")!.pending.join(" ")).toContain("section contracts");
    expect(home.stages.find(stage => stage.name === "Fills")!.findings.some(finding => finding.code === "LK4")).toBe(true);
    expect(home.staticCoverage).toBe("unavailable");
    expect(home.unavailableChecks).toContain("LK10");
    expect(home.checks.find(check => check.code === "LK10")?.status).toBe("pending");
    expect(PUBLISH_STAGES).toEqual(["Configure", "Frame", "Layout", "Fills", "Content", "Checks", "Ready", "Export", "Deploy"]);
  });

  it("keeps duplicate IDs as separate rows and exposes LK15 pack closure", () => {
    const duplicate = derivePackPipeline([instances[0]!, instances[0]!], library, registries, undefined, configured);
    expect(new Set(duplicate.items.map(item => item.key)).size).toBe(2);
    expect(duplicate.items[1]!.findings.some(finding => finding.code === "LK15" && finding.path === "instanceId")).toBe(true);
    expect(duplicate.frameLeaves).toEqual([{ surface: "site", leaves: ["frames.site-shell"] }]);
    expect(derivePackPipeline([], library, registries).readyCount).toBe(0);
  });
  it.each(["format", "layout", "frame"] as const)("projects LK16 %s findings into Layout", path => {
    const f = instanceFixture();
    const registries = { ...f.registries, formats: f.registries.formats.map(format => format.id === f.binding.format ? {
      ...format, ...(path === "layout" ? { allowedCompositions: ["layouts.split" as const] } : {}),
      ...(path === "frame" ? { frames: ["frames.app-shell" as const] } : {}),
    } : format) };
    const binding = { ...f.binding, ...(path === "format" ? { format: "email.html" } : {}) } as InstanceBinding;
    const checked = checkInstance(binding, f.library, registries);
    const expected = checked.findings.filter(finding => finding.code === "LK16");
    expect(expected.some(finding => finding.path === path)).toBe(true);
    const item = derivePackPipeline([binding], f.library, registries, undefined, { [binding.instanceId]: productionSettingsFromBinding(binding) }).items[0]!;
    expect(item.column).toBe("Layout");
    expect(item.stages.find(stage => stage.name === "Layout")!.findings).toEqual(expected);
    expect(item.stages.filter(stage => stage.name !== "Layout").flatMap(stage => stage.findings).some(finding => finding.code === "LK16")).toBe(false);
    expect(item.stages.find(stage => stage.name === "Checks")!.pending).toContain("LK12 rendered responsive evidence is unavailable");
  });

});

it("gates unset→configured→unset presentation while retaining real source LK findings", () => {
  const about = instances.find(binding => binding.instanceId === "standard.about")!;
  const unset = derivePackPipeline([about], library, registries).items[0]!;
  expect(unset).toMatchObject({ column: "Configure", state: "to do", configured: false });
  expect(unset.findings.map(finding => finding.code)).toEqual(["LK1", "LK2", "LK15"]);
  expect(unset.stages.every(stage => stage.status === "pending" && stage.findings.length === 0)).toBe(true);
  const configured = derivePackPipeline([about], library, registries, undefined, { [about.instanceId]: productionSettingsFromBinding(about) }).items[0]!;
  expect(configured.column).toBe("Frame");
  expect(configured.findings).toEqual(unset.findings);
  expect(configured.sourceFindings).toEqual(unset.sourceFindings);
  expect(derivePackPipeline([about], library, registries).items[0]).toEqual(unset);
});

it("changes the effective binding without mutating source inputs or losing original refusal evidence", () => {
  const f = instanceFixture();
  f.binding.layout.config = "stack.default";
  const before = structuredClone(f.binding);
  const settings = { ...productionSettingsFromBinding(f.binding), layout: { leaf: "layouts.stack" as const, config: "stack.landing" } };
  const item = derivePackPipeline([f.binding], f.library, f.registries, undefined, { [f.binding.instanceId]: settings }).items[0]!;
  expect(item.binding.layout.config).toBe("stack.landing");
  expect(item.sourceBinding.layout.config).toBe("stack.default");
  expect(item.sourceFindings.some(finding => finding.code === "LK2")).toBe(true);
  expect(item.findings.some(finding => finding.code === "LK2")).toBe(false);
  expect(f.binding).toEqual(before);
});

it("asks about concrete required LK10 slots without inferring optional references or fake failures", () => {
  const f = instanceFixture();
  f.registries.sections[0]!.contract.slots.push({ name: "optional", type: "copy", required: false });
  delete f.binding.fills.lead![0]!.content.title;
  const item = derivePackPipeline([f.binding], f.library, f.registries, fixtureCompiler, { [f.binding.instanceId]: productionSettingsFromBinding(f.binding) }).items[0]!;
  expect(item.state).toBe("needs input");
  expect(item.column).toBe("Content");
  expect(item.inputRequests).toEqual([{ slot: "fills.lead.0.content.title", question: "Which content reference should fill required slot fills.lead.0.content.title?" }]);
  expect(item.findings.some(finding => finding.code === "LK10")).toBe(true);
  expect(item.stages.find(stage => stage.name === "Content")!.status).toBe("pending");
  expect(item.stages.some(stage => stage.status === "failed")).toBe(false);
});

it("derives unbuilt web delivery and unknown deployment without changing production checks", () => {
  const f = instanceFixture();
  const base = productionSettingsFromBinding(f.binding);
  const settings = { ...base, deliveries: [{ id: "static-site-bundle" as const }], deploymentSurface: "fixture.web-preview" };
  const item = derivePackPipeline([f.binding], f.library, f.registries, undefined, { [f.binding.instanceId]: settings }).items[0]!;
  expect(item.stages.slice(-2).map(stage => [stage.name, stage.status])).toEqual([["Export", "concept-only"], ["Deploy", "unknown"]]);
  expect(item.binding).not.toHaveProperty("deploymentSurface");
  expect(item.binding).not.toHaveProperty("deliveries");
  expect(item.stages.find(stage => stage.name === "Checks")?.pending).toContain("LK12 rendered responsive evidence is unavailable");
});
