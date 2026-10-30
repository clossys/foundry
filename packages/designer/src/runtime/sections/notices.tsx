import { NoticeList } from "../../blocks/NoticeList.js";
import type { NoticeListItem } from "../../blocks/NoticeList.js";
import { recordsOf, refuseUnmapped, requiredAnatomy, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.notices";
type BannerVariant = NonNullable<NoticeListItem["tone"]>;
const TONES: readonly BannerVariant[] = ["info", "success", "warning", "danger"];

/**
 * notices -> NoticeList.notices, each a Foundry Banner. The region label is the header channel's heading. A notice action needs components.link, which the contract does not allow, so it is refused.
 */
export const noticesInputs: SectionInputs = { slots: ["notices"], members: [] };

export const renderNotices: SectionRenderer = input => {
  refuseUnmapped(input, noticesInputs);
  const label = requiredAnatomy(input, LEAF, "heading");
  const notices = recordsOf(LEAF, "notices", requireSlot(input, LEAF, "notices")).map((row, index): NoticeListItem => {
    const id = stringField(row, "id"), message = stringField(row, "message");
    if (!id || !message) throw new TypeError(`${LEAF}: notice ${index} needs an id and a message`);
    if (row.action !== undefined) throw new TypeError(`${LEAF}: notice ${id} has an action, but the contract allows only components.banner (NEED: components.link)`);
    const tone = stringField(row, "tone"), title = stringField(row, "title");
    if (tone !== undefined && !(TONES as readonly string[]).includes(tone)) throw new TypeError(`${LEAF}: notice ${id} tone ${tone} is not a Banner variant`);
    return { id, message, ...(tone ? { tone: tone as BannerVariant } : {}), ...(title ? { title } : {}), ...(row.dismissible === false ? { dismissible: false } : {}) };
  });
  return <NoticeList label={label} notices={notices} />;
};
