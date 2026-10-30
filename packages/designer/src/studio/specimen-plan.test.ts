import { expect, it } from "vitest";
import { bindAgentSpecimenPlan, projectAgentSpecimenPlan, type NativeAgentSpecimenPlan } from "./specimen-plan.js";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { contentSpecimenNeeds } from "./specimen-content.js";

// Structural fixtures use the published native host source-plan shape, with no Producer import.
function plan(items: NativeAgentSpecimenPlan["items"]): NativeAgentSpecimenPlan {
  return { cellId: "cell", items, expectedVariantIds: items.map(item => String(item.id)), issues: [] };
}
it("preserves complete native Director passages and caller identities", () => {
  const value = "A full passage.\n\n" + "Produced content remains intact. ".repeat(100);
  const result = projectAgentSpecimenPlan({ agent: "director", plan: plan([{ id: "cell:direction:1", kind: "director", title: "Direction", value }]) });
  expect(result.issues).toEqual([]);
  expect(result.cell.kind).toBe("passage");
  expect(result.cell.items).toEqual([{ id: "cell:direction:1", label: "Direction", value: { passage: value } }]);
});
it("converts actual native Writer roles without changing produced copy", () => {
  for (const role of ["headline", "body", "cta", "nav", "error", "empty"]) {
    const result = projectAgentSpecimenPlan({ agent: "writer", plan: plan([{ id: role, kind: "writer", role, context: "source context", locale: "ar", value: "Produced copy" }]) });
    expect(result.issues).toEqual([]);
    expect(result.cell.items[0]?.value).toEqual({ role, context: "source context", locale: "ar", dir: "rtl", ...(role === "body" ? { passage: "Produced copy" } : { text: "Produced copy" }) });
  }
});
it("derives Publisher 1x2 axes from actual native page and viewport records, preserving source ids", () => {
  const items = [{ id: "desktop", width: 1440, height: 900 }, { id: "mobile", width: 390, height: 844 }].map(viewport => ({ id: `cell:${viewport.id}`, kind: "publisher", page: { id: "native-page", title: "Native page" }, viewport }));
  const result = projectAgentSpecimenPlan({ agent: "publisher", plan: plan(items) });
  expect(result.issues).toEqual([]);
  expect(result.cell.items.map(item => item.id)).toEqual(["cell:desktop", "cell:mobile"]);
  expect(result.cell.axes?.map(axis => axis.values.length)).toEqual([1, 2]);
  expect(result.cell.items.map(item => item.coordinates)).toEqual([{ page: "native-page", viewport: "desktop" }, { page: "native-page", viewport: "mobile" }]);
});
it("preserves missing source and omitted variant failures without inventing Designer data", () => {
  const missing = projectAgentSpecimenPlan({ agent: "designer", plan: { cellId: "cell", items: [], expectedVariantIds: [], issues: ["The Designer specimen source capability is not available."] } });
  expect(missing.issues).toContain("The Designer specimen source capability is not available.");
  expect(missing.cell.items).toEqual([]);
  const partial = projectAgentSpecimenPlan({ agent: "director", plan: { ...plan([{ id: "first", kind: "director", title: "First", value: "Passage" }]), expectedVariantIds: ["first", "missing"] } });
  expect(partial.issues).toContain("One or more native source variants have no specimen item.");
});

it("requires explicit native registration even when static source and component capabilities are available", () => {
  const catalog = loadCatalog();
  const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "binding-fixture", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
  // UNIT port metadata is eligible for dispatch only; this fixture supplies no loaded page or DOM proof.
  const context: DesignerSpecimenContext = { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values, components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules }, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [{ id: "page", route: "/", previewUrl: "/preview/site/pages/home.html", emitted: true, stage: "preview" }], renderViewport: () => null } };
  const nativePlan = plan([{ id: "cell:desktop", kind: "publisher", page: { id: "page" }, viewport: { id: "desktop", width: 1440, height: 900 } }]);
  const props = { context, need: () => null, labels: { showAllVariants: (count: number) => String(count) } };
  const projection = projectAgentSpecimenPlan({ agent: "publisher", plan: nativePlan });
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", { ...props, items: projection.cell.items, axes: projection.cell.axes })).toEqual([]);
  const result = bindAgentSpecimenPlan({ agent: "publisher", plan: nativePlan, props, nativeRegistered: () => false });
  expect(result.registered).toBe(false);
  expect(result.variantIds).toEqual([]);
  expect(result.issues).toEqual(["The bound leaf has no selected native registration."]);
});
