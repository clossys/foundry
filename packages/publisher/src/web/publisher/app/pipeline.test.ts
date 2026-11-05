import { expect, it } from "vitest";
import { key } from "../../../core/__fixtures__/instance-binding/fixtures.js";
import { fixtureCompiler } from "../__fixtures__/compiler.js";
import { deriveAppPipeline } from "./pipeline.js";
import { appBindingFixture } from "./__fixtures__/binding.js";

const derive = (f: ReturnType<typeof appBindingFixture>) => deriveAppPipeline({ ...f, compiler: fixtureCompiler });
it("runs App page bindings through the real pipeline and keeps subrows subordinate", () => {
  const f = appBindingFixture(), result = derive(f), page = result.pages[0]!;
  expect(page.pipeline?.staticCoverage).toBe("complete");
  expect(page.pipeline?.checks.filter(check => !["LK12", "LK15"].includes(check.code)).every(check => check.status === "passed")).toBe(true);
  expect(page.stages.find(stage => stage.name === "States")?.status).toBe("passed");
  expect(page.stages.find(stage => stage.name === "Ready")?.status).toBe("pending");
  expect(page.column).toBe("Checks");
  expect(result.pages).toHaveLength(1);
  expect(result.readyCount).toBe(0);
  expect(result.items[1]?.stages.map(stage => stage.name)).toEqual(["Fills", "Content", "Checks", "States", "Ready"]);
  expect(result.items[1]?.pipeline).toBe(page.pipeline);
  expect(result.frameLeaves).toEqual([{ surface: "app", leaves: ["frames.app-shell"] }]);
});
it("keeps missing bindings and unresolved host content as needs input", () => {
  const f = appBindingFixture();
  const missing = deriveAppPipeline({ inventory: f.inventory, settings: f.settings });
  expect(missing.pages[0]?.state).toBe("needs input");
  expect(missing.pages[0]?.inputRequests.some(request => request.slot === "binding")).toBe(true);
  expect(missing.pages[0]?.stages.find(stage => stage.name === "States")?.status).toBe("pending");
  delete f.binding.fills.body![0]!.content.title;
  const content = derive(f).pages[0]!;
  expect(content.state).toBe("needs input");
  expect(content.findings.some(finding => finding.code === "LK10")).toBe(true);
  expect(content.inputRequests.some(request => request.slot.includes("content.title"))).toBe(true);
});
it("preserves original findings when Configure selects another layout config", () => {
  const f = appBindingFixture();
  f.binding.layout.config = "unknown";
  const page = derive(f).pages[0]!;
  expect(page.pipeline?.sourceBinding.layout.config).toBe("unknown");
  expect(page.pipeline?.binding.layout.config).toBe("stack.landing");
  expect(page.pipeline?.sourceFindings.some(finding => finding.code === "LK2")).toBe(true);
  expect(page.findings.some(finding => finding.code === "LK2")).toBe(false);
});
it.each(["foreign page", "duplicate page", "duplicate instance", "surface", "pack", "path", "subrow owner", "subrow path", "duplicate subrow"])("rejects host mapping mutation: %s", mutation => {
  const f = appBindingFixture();
  if (mutation === "foreign page") f.pageBindings[0]!.pageId = "foreign";
  if (mutation === "duplicate page") f.pageBindings.push(f.pageBindings[0]!);
  if (mutation === "duplicate instance") {
    f.inventory = { ...f.inventory, routes: [...f.inventory.routes, { ...f.inventory.routes[0]!, id: "sample.other", path: "/#/other" }] };
    f.pageBindings.push({ pageId: "sample.other", binding: { ...f.binding, path: "/#/other" } });
  }
  if (mutation === "surface") f.binding.surface = "site";
  if (mutation === "pack") f.binding.packIds = ["pack.other"];
  if (mutation === "path") f.binding.path = "/foreign";
  if (mutation === "subrow owner") f.subrowBindings[0]!.parentPageId = "foreign";
  if (mutation === "subrow path") f.subrowBindings[0]!.fillPaths = ["fills.missing.0"];
  if (mutation === "duplicate subrow") f.subrowBindings.push(f.subrowBindings[0]!);
  expect(() => derive(f)).toThrow(/Invalid App/);
});
it.each([undefined, []])("never clears States from absent or empty binding states: %s", states => {
  const f = appBindingFixture();
  if (states === undefined) delete f.binding.states;
  else f.binding.states = states;
  const page = derive(f).pages[0]!;
  expect(page.pipeline?.stateCoverage).toBe("not-requested");
  expect(page.stages.find(stage => stage.name === "States")?.status).toBe("pending");
  expect(page.state).not.toBe("ready");
});
it("uses actual LK14 failure rather than a declaration as proof", () => {
  const f = appBindingFixture();
  f.fills.get(key("sections.content", "default"))!.states = [];
  const result = derive(f);
  expect(result.pages[0]?.stages.find(stage => stage.name === "States")?.status).toBe("failed");
  expect(result.items[1]?.stages.find(stage => stage.name === "States")?.status).toBe("failed");
});
it("retains undecided state applicability and missing declarations as needs input", () => {
  const f = appBindingFixture();
  const page = f.inventory.routes[0]!;
  f.inventory = { ...f.inventory, routes: [{ ...page, declaredStates: { ...page.declaredStates, loading: { ...page.declaredStates.loading, declared: false, applicability: "undecided", scopeKind: "none" } } }, ...f.inventory.routes.slice(1)] };
  const item = derive(f).pages[0]!;
  expect(item.state).toBe("needs input");
  expect(item.inputRequests.some(request => request.slot === "states.loading")).toBe(true);
  expect(item.stages.find(stage => stage.name === "States")?.status).toBe("pending");
});
it("does not promote a local-panel declaration into whole-page state support", () => {
  const f = appBindingFixture(), page = f.inventory.routes[0]!;
  f.inventory = { ...f.inventory, routes: [{ ...page, declaredStates: { ...page.declaredStates, loading: { ...page.declaredStates.loading, scopeKind: "panel" } } }, ...f.inventory.routes.slice(1)] };
  const result = derive(f);
  expect(result.pages[0]?.stages.find(stage => stage.name === "States")?.status).toBe("pending");
  expect(result.items[1]?.stages.find(stage => stage.name === "States")?.status).toBe("pending");
});
it.each(["unrelated path", "missing parent"])("rejects nested subrow ownership mutation: %s", mutation => {
  const f = appBindingFixture();
  if (mutation === "unrelated path") f.subrowBindings[1]!.fillPaths = ["fills.lead.0"];
  else f.subrowBindings = [f.subrowBindings[1]!];
  expect(() => derive(f)).toThrow("Invalid nested App subrow ownership");
});
it("keeps a legacy unknown state scope as needs input even with LK14 metadata", () => {
  const f = appBindingFixture(), page = f.inventory.routes[0]!;
  f.inventory = { ...f.inventory, routes: [{ ...page, declaredStates: { ...page.declaredStates, loading: { ...page.declaredStates.loading, scopeKind: undefined } } }, ...f.inventory.routes.slice(1)] };
  const result = derive(f).pages[0]!;
  expect(result.state).toBe("needs input");
  expect(result.stages.find(stage => stage.name === "States")?.status).toBe("pending");
});
it("does not clear States when every state is marked not applicable", () => {
  const f = appBindingFixture();
  f.inventory = { ...f.inventory, routes: f.inventory.routes.map(route => ({ ...route, declaredStates: Object.fromEntries(Object.entries(route.declaredStates).map(([name, declaration]) => [name, { ...declaration, applicability: "not-applicable" as const }])) as typeof route.declaredStates })) };
  const result = derive(f).pages[0]!;
  expect(result.stages.find(stage => stage.name === "States")?.status).toBe("pending");
  expect(result.state).not.toBe("ready");
});
it("keeps short-circuited state checks and subrows without ownership pending", () => {
  const f = appBindingFixture();
  f.settings["sample.record"].layout = { ...f.binding.layout, config: "unknown" };
  expect(derive(f).pages[0]?.stages.find(stage => stage.name === "States")?.status).toBe("pending");
  f.subrowBindings = [];
  const row = derive(f).items[1]!;
  expect(row.state).toBe("needs input");
  expect(row.stages.every(stage => stage.status !== "passed")).toBe(true);
});
it("resets Configure without losing source evidence or advancing subrows", () => {
  const f = appBindingFixture();
  const result = deriveAppPipeline({ ...f, settings: {}, compiler: fixtureCompiler });
  expect(result.items.every(item => item.state === "to do")).toBe(true);
  expect(result.items.every(item => item.stages.every(stage => stage.status === "pending"))).toBe(true);
  expect(result.pages[0]?.pipeline?.sourceBinding).toBe(f.binding);
});
