import { instanceFixture, key } from "../../../../core/__fixtures__/instance-binding/fixtures.js";
import { productionSettingsFromBinding } from "../../production-settings.js";
import { projectAppInventory } from "../inventory.js";
import type { AppInventoryProjection, AppScopedStateDeclaration } from "../inventory.js";

export function scopedStates(scopeKind: "page" | "panel" = "page"): Record<"loading" | "empty" | "error", AppScopedStateDeclaration> {
  return {
    loading: { declared: true, applicability: "required", scopeKind, scope: scopeKind, condition: "Awaiting supplied records" },
    empty: { declared: false, applicability: "not-applicable", scopeKind: "none", scope: "none", condition: null },
    error: { declared: false, applicability: "not-applicable", scopeKind: "none", scope: "none", condition: null },
  };
}
export function genericProjection(): AppInventoryProjection {
  return { schemaVersion: 2, artifactType: "app-route-inventory", source: { head: "a".repeat(40), tree: "b".repeat(40) },
    pages: [{ id: "sample.record", label: "Sample record", path: "/#/samples/:sampleId", transport: "hash", pathParameters: ["sampleId"], lane: "Record", frame: "frames.app-shell", layoutConfig: "stack.landing", declaredStates: scopedStates() }],
    subrows: [
      { id: "sample.tab", label: "Overview", path: "/#/samples/:sampleId?tab=overview", transport: "hash", pathParameters: ["sampleId"], parentPageId: "sample.record", declaredStates: scopedStates("panel") },
      { id: "sample.child", label: "Details", path: "/#/samples/:sampleId?tab=overview&panel=details", transport: "hash", pathParameters: ["sampleId"], parentPageId: "sample.record", parentSubrowId: "sample.tab", declaredStates: scopedStates("panel") },
    ], missingDecisions: [{ id: "sample.dashboard", label: "Dashboard decision", lane: "Dashboard" }], nonAddressableTabs: [] };
}
export function appBindingFixture() {
  const f = instanceFixture();
  f.binding.instanceId = "sample.instance";
  f.binding.label = "Sample record";
  f.binding.surface = "app";
  f.binding.packIds = ["pack.app"];
  f.binding.path = "/#/samples/:sampleId";
  f.binding.frame = { leaf: "frames.app-shell", config: "page" };
  f.fills.get(key("sections.hero", "default"))!.headings = [2];
  const inventory = projectAppInventory(genericProjection());
  const pageBindings = [{ pageId: "sample.record", binding: f.binding }];
  const subrowBindings = [
    { subrowId: "sample.tab", parentPageId: "sample.record", fillPaths: ["fills.body.0"] },
    { subrowId: "sample.child", parentPageId: "sample.record", fillPaths: ["fills.body.0"] },
  ];
  const settings = { "sample.record": productionSettingsFromBinding(f.binding) };
  return { ...f, inventory, pageBindings, subrowBindings, settings };
}
