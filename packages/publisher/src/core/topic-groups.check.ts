import type { SectionedViewItemGroup, SectionedViewItemsBlock } from "./sectioned-view.js";
const ref = { id: "fixture.copy" };
export const group: SectionedViewItemGroup = { id: "one", label: ref, items: ["one", "two"] };
export const grouped: SectionedViewItemsBlock = { type: "items", recipe: "topics", columns: 2, groups: [group], items: [{ id: "one", heading: ref }, { id: "two", heading: ref }] };
export const flat: SectionedViewItemsBlock = { type: "items", arrangement: "rows", columns: 1, items: [{ id: "one", heading: ref }] };
// @ts-expect-error Group labels participate in CopyRef provenance.
export const literal: SectionedViewItemGroup = { id: "one", label: "Category", items: [] };
// @ts-expect-error Groups refer to flat item ids; they never nest item objects.
export const nested: SectionedViewItemGroup = { id: "one", label: ref, items: [{ id: "one", heading: ref }] };
// @ts-expect-error The raw topic-list block contract is retired.
export const retired: SectionedViewItemsBlock = { type: "topic-list", groups: [group] };
