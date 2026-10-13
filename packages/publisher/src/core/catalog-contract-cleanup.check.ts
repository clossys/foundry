import type { SectionedViewContentSection, SectionedViewItem, SectionedViewItemsBlock, SectionedViewMatrixSide, SectionedViewSpecimenKey } from "./sectioned-view.js";
const ref = { id: "example.copy" };
const section: SectionedViewContentSection = { id: "example", kind: "content-section", heading: ref, size: "standard" };
const item: SectionedViewItem = { id: "example", heading: ref };
const items: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", scale: "item", items: [item] };
const side: SectionedViewMatrixSide = { id: "example", heading: ref, description: ref, points: [ref, ref] };
const key: SectionedViewSpecimenKey = { label: ref, items: [] };
// @ts-expect-error Content alignment is derived.
const align: SectionedViewContentSection = { ...section, align: "center" };
// @ts-expect-error Compact remains a Hero size only.
const compact: SectionedViewContentSection = { ...section, size: "compact" };
// @ts-expect-error Items have no featured field.
const featured: SectionedViewItem = { ...item, featured: true };
// @ts-expect-error Items scale replaces emphasis.
const emphasis: SectionedViewItemsBlock = { ...items, emphasis: "item" };
// @ts-expect-error The flow recipe is folded into steps.
const flow: SectionedViewItemsBlock = { ...items, recipe: "flow" };
// @ts-expect-error Key placement is derived from the frame layout.
const placement: SectionedViewSpecimenKey = { ...key, side: "below" };
// @ts-expect-error A description is a lead, never a standalone Matrix body.
const description: SectionedViewMatrixSide = { id: "example", heading: ref, description: ref };
// @ts-expect-error Matrix points and visual cannot be combined.
const mixed: SectionedViewMatrixSide = { ...side, visual: { id: "panel", title: ref, parts: [] } };
void [section, item, items, side, key, align, compact, featured, emphasis, flow, placement, description, mixed];

const inverseGround: SectionedViewContentSection = { ...section, ground: "inverse" };
// @ts-expect-error Authored canonical ground is inverse or omitted.
const authoredBase: SectionedViewContentSection = { ...section, ground: "base" };
// @ts-expect-error Sunken is a resolved renderer ground, not an authored choice.
const authoredSunken: SectionedViewContentSection = { ...section, ground: "sunken" };
void [inverseGround, authoredBase, authoredSunken];
