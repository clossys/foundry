import type { SectionedViewTopicGroup, SectionedViewTopicListBlock } from "./index.js";
export const group: SectionedViewTopicGroup = { id: "group", label: { id: "label" }, items: [] };
export const grouped: SectionedViewTopicListBlock = { type: "topic-list", groups: [group] };
export const flat: SectionedViewTopicListBlock = { type: "topic-list", items: [], columns: 2 };
// @ts-expect-error exactly one form
export const both: SectionedViewTopicListBlock = { type: "topic-list", items: [], groups: [] };
// @ts-expect-error one form required
export const neither: SectionedViewTopicListBlock = { type: "topic-list" };
// @ts-expect-error columns belongs to flat form
export const columns: SectionedViewTopicListBlock = { type: "topic-list", groups: [], columns: 2 };
// @ts-expect-error labels remain CopyRefs
export const text: SectionedViewTopicGroup = { id: "g", label: "Category", items: [] };
