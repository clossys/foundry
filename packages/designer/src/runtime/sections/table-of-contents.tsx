import { TableOfContents } from "../../blocks/TableOfContents.js";
import type { TableOfContentsItem } from "../../blocks/TableOfContents.js";
import { numberField, recordsOf, refuseUnmapped, requireSlot, slotValue, stringField, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.table-of-contents";
/**
 * The landmark's accessible name. The contract has `anatomy.header: null` and no copy slot, so no content can
 * carry it (owner item: a `label` copy slot or an anatomy header on sections.table-of-contents); until then the
 * renderer owns it, like any other accessible name.
 */
const LANDMARK_LABEL = "On this page";

/** headings -> TableOfContents.items (id, label, level 2 or 3); active-id -> currentId. */
export const tableOfContentsInputs: SectionInputs = { slots: ["headings", "active-id", "label"], members: [] };

export const renderTableOfContents: SectionRenderer = input => {
  refuseUnmapped(input, tableOfContentsInputs);
  const items = recordsOf(LEAF, "headings", requireSlot(input, LEAF, "headings")).map((row, index): TableOfContentsItem => {
    const id = stringField(row, "id"), text = stringField(row, "label") ?? stringField(row, "heading"), level = numberField(row, "level");
    if (!id || !text) throw new TypeError(`${LEAF}: heading ${index} needs an id and a label`);
    if (level !== undefined && level !== 2 && level !== 3 && level !== 4) throw new TypeError(`${LEAF}: heading ${id} level must be 2, 3 or 4`);
    return level === 2 || level === 3 || level === 4 ? { id, label: text, level } : { id, label: text };
  });
  return <TableOfContents label={textOf(slotValue(input, "label")) ?? LANDMARK_LABEL} items={items} nested={items.some(item => item.level === 4)} currentId={textOf(slotValue(input, "active-id"))} trackCurrent={input.sectionHost?.trackCurrent === true} onCurrentChange={typeof input.sectionHost?.onActiveChange === "function" ? input.sectionHost.onActiveChange as (id: string) => void : undefined} onNavigate={typeof input.sectionHost?.navigate === "function" ? input.sectionHost.navigate as (id: string) => void : undefined} />;
};
