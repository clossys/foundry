import {
  desugarRecipe,
  resolveSectionedViewDocument,
  validateSectionedViewDocument,
  type SectionedViewDocument,
  type SectionedViewItemsBlock,
  type SectionedViewSceneDocument,
} from "@clossys/publisher/core";
import {
  createCopyResolver,
  type CopyRef,
  type CopyRegistry,
  type CopyRegistryEntry,
} from "@clossys/writer";

// Replace this local registry with your own reviewed copy registry.
const copy = {
  heading: "Example", detail: "Sample content.", label: "Ready",
  source: "Source document", result: "Result", value: "40 / 100",
  previous: "30 / 100", initials: "AB",
  figure: "Sample panel showing labeled details and status.",
  scene: "Sample documents connect to a shared result with labeled rows and clear relationships.",
};
const ref = (key: keyof typeof copy): CopyRef => ({ id: `example.${key}` });
const registry = {
  id: "canonical-example", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "example-v1" },
  entries: Object.entries(copy).map(([key, text]) => ({
    id: `example.${key}`, text, context: "Canonical README example", status: "approved",
  } satisfies CopyRegistryEntry)),
} satisfies CopyRegistry;
const resolveCopy = createCopyResolver(registry);

const items = ["one", "two", "three"].map((id) => ({
  id, heading: ref("heading"), description: ref("detail"),
}));
const raw = {
  type: "items", arrangement: "columns", columns: 3,
  order: "none", reveal: "all", treatment: "plain", scale: "item", items,
} satisfies SectionedViewItemsBlock;
const recipe = { type: "items", recipe: "features", items } satisfies SectionedViewItemsBlock;
export const rawAxes = desugarRecipe(raw);
const { recipe: recipeName, ...canonicalRecipeAxes } = desugarRecipe(recipe);
export const recipeAxes = canonicalRecipeAxes;

export const document = {
  id: "canonical-guide",
  sections: [
    { id: "raw", kind: "content-section", heading: ref("heading"),
      size: "standard", layout: "stacked", block: raw },
    { id: "recipe", kind: "content-section", heading: ref("heading"),
      size: "standard", layout: "stacked", block: recipe },
    { id: "matrix", kind: "content-section", heading: ref("heading"),
      size: "display", layout: "stacked", block: {
        type: "matrix", recipe: "comparison", featured: "after",
        sides: ["before", "after"].map((id) => ({
          id, label: ref("label"), heading: ref("heading"), description: ref("detail"),
          points: [ref("source"), ref("result")],
        })),
      } },
    { id: "specimen", kind: "content-section", heading: ref("heading"),
      size: "standard", layout: "split-start", media: {
        type: "specimen", label: ref("figure"), panel: {
          id: "sample", title: ref("heading"), badge: { label: ref("label"), tone: "info" },
          parts: [{ id: "measurement", type: "meter", label: ref("label"),
            value: 40, scaleMax: 100, tone: "success", valueText: ref("value"),
            previous: 30, previousText: ref("previous") }],
        },
      } },
    { id: "record", kind: "content-section", heading: ref("heading"),
      size: "standard", layout: "split-end", media: {
        type: "record", id: "sample-record", head: { title: ref("heading") }, columns: 1,
        groups: [
          { id: "details", label: ref("label"), rows: [{ id: "row", label: ref("label"), detail: ref("detail") }] },
          { id: "owner", label: ref("label"), owner: { initials: ref("initials"), name: ref("heading") } },
        ], caption: ref("detail"),
      } },
    { id: "scene", kind: "content-section", heading: ref("heading"),
      size: "display", layout: "stacked", media: {
        type: "scene", label: ref("scene"), input: {
          template: "converge", seed: "example-scene",
          sources: { heading: ref("heading"), items: ["a", "b", "c"].map((id) => ({
            id, format: "pdf", title: ref("source"),
          } satisfies SectionedViewSceneDocument)) },
          target: { heading: ref("heading"), title: ref("result"), rows: ["one", "two"].map((id) => ({
            id, label: ref("label"), value: ref("value"),
          })) },
          relations: [{ from: "a", to: "one" }, { from: "b", to: "one" }, { from: "c", to: "two" }],
        },
      } },
  ],
} satisfies SectionedViewDocument;

export const findings = validateSectionedViewDocument(document);
if (findings.some((finding) => finding.severity === "error")) {
  throw new Error(findings.map((finding) => finding.rule).join(", "));
}
export const resolved = resolveSectionedViewDocument(document, resolveCopy);
// resolved.resolutions retains the registry revision and source for every CopyRef.

void recipeName;
