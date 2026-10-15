import type { SectionedViewItemsBlock, SectionedViewMatrixBlock, SectionedViewItem, SectionedViewMedia, SectionedViewContentSection, SectionedViewHeroSection } from "./sectioned-view.js";
const ref = { id: "copy" };
const item: SectionedViewItem = { id: "one", heading: ref, meta: ref, badge: { label: ref, tone: "success" } };
const recipe: SectionedViewItemsBlock = { type: "items", recipe: "features", items: [item] };
const canonical: SectionedViewItemsBlock = { type: "items", arrangement: "rows", groups: [{ id: "group", label: ref, items: ["one"] }], items: [item] };
const lanes: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "one", label: ref }, { id: "two", label: ref }], items: [{ ...item, lane: "one" }] };
const matrix: SectionedViewMatrixBlock = { type: "matrix", sides: [{ id: "one", heading: ref, description: ref, points: [ref, ref] }] };
const frame: SectionedViewContentSection = { id: "band", kind: "content-section", size: "display", layout: "split-start", heading: ref, footnote: { link: { label: ref, href: "/learn" } } };
const hero: SectionedViewHeroSection = { id: "hero", kind: "hero", heading: ref, size: "compact" };
const scene: SectionedViewMedia = { type: "scene", label: ref, input: { template: "converge", seed: "stable", sources: { heading: ref, items: [{ id: "doc", format: "pdf", title: ref }] }, target: { heading: ref, title: ref, rows: [{ id: "row", label: ref, value: ref }] }, relations: [{ from: "doc", to: "row" }] } };
// @ts-expect-error Non-recipe input requires arrangement.
const missing: SectionedViewItemsBlock = { type: "items", items: [item] };
// @ts-expect-error Raw block names are retired, distinct from published section kinds.
const retired: SectionedViewItemsBlock = { type: "feature-grid", items: [item] };
// @ts-expect-error Closed Badge variants exclude accent.
const accent: SectionedViewItem = { ...item, badge: { label: ref, tone: "accent" } };
// @ts-expect-error Group members are item ids, never nested objects.
const nested: SectionedViewItemsBlock = { type: "items", arrangement: "rows", items: [item], groups: [{ id: "group", label: ref, items: [item] }] };
// @ts-expect-error Frame has no mediaSide escape hatch.
const mediaSide: SectionedViewContentSection = { ...frame, mediaSide: "start" };
// @ts-expect-error Hero size excludes standard.
const standard: SectionedViewHeroSection = { ...hero, size: "standard" };
// @ts-expect-error Empty footnotes have no visible copy.
const empty: SectionedViewContentSection = { ...frame, footnote: {} };
// @ts-expect-error Every Scene title is a CopyRef, never raw visible text.
const rawScene: SectionedViewMedia = { ...scene, input: { ...scene.input, sources: { ...scene.input.sources, items: [{ id: "doc", format: "pdf", title: "raw" }] } } };
void [recipe, canonical, lanes, matrix, frame, hero, scene, missing, retired, accent, nested, mediaSide, standard, empty, rawScene];

const record: SectionedViewMedia = { type: "record", id: "record", head: { title: ref }, caption: ref, groups: [{ id: "owner", label: ref, owner: { initials: ref, name: ref } }] };
// @ts-expect-error Ledger initials are visible CopyRefs; only Scene initials are structural strings.
const rawRecord: SectionedViewMedia = { ...record, groups: [{ id: "owner", label: ref, owner: { initials: "AB", name: ref } }] };
void [record, rawRecord];

// The public recipe table exposes the same deep immutability enforced at runtime.
import { SECTIONED_VIEW_ITEM_RECIPES } from "./sectioned-view.js";
// @ts-expect-error fixed axes are immutable
SECTIONED_VIEW_ITEM_RECIPES.features.fixed.reveal = "disclose";
// @ts-expect-error defaults are immutable
SECTIONED_VIEW_ITEM_RECIPES.features.defaults!.columns = 2;
// @ts-expect-error recipe properties cannot be replaced
SECTIONED_VIEW_ITEM_RECIPES.features.fixed = {};
