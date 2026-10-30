import { expect, it } from "vitest";
import { projectAgentSpecimenPlan, type NativeAgentSpecimenPlan } from "./specimen-plan.js";

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
