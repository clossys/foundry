import { RecordCards } from "../../blocks/RecordCards.js";
import type { RecordCardsLayout, RecordCardsRecord } from "../../blocks/RecordCards.js";
import { isImageResource } from "../../catalog-assets/media.js";
import { editorialMetadata } from "./page-header-metadata.js";
import { isObject, memberOf, recordsOf, refuseUnmapped, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.cards";
type BadgeVariant = NonNullable<NonNullable<RecordCardsRecord["badge"]>["variant"]>;
const LAYOUTS: readonly RecordCardsLayout[] = ["grid", "list"];
const BADGES: readonly BadgeVariant[] = ["neutral", "success", "warning", "danger", "info"];

/** records -> RecordCards.records; layout.grid / layout.list -> RecordCards.layout. */
export const cardsInputs: SectionInputs = { slots: ["records"], members: ["layout.grid", "layout.list"] };

export const renderCards: SectionRenderer = input => {
  refuseUnmapped(input, cardsInputs);
  const config = input.selection.config;
  if (config !== null && config !== "post" && config !== "post-featured" && config !== "case-study") throw new TypeError(`${LEAF}: unsupported editorial configuration ${config}`);
  const records = recordsOf(LEAF, "records", requireSlot(input, LEAF, "records")).map((row, index): RecordCardsRecord => {
    const id = stringField(row, "id"), title = stringField(row, "title");
    if (!id || !title) throw new TypeError(`${LEAF}: record ${index} needs an id and a title`);
    const description = stringField(row, "description"), href = stringField(row, "href"), meta = stringField(row, "meta");
    const badge = isObject(row.badge) ? row.badge : undefined, badgeLabel = stringField(badge, "label"), variant = stringField(badge, "variant");
    if (variant !== undefined && !(BADGES as readonly string[]).includes(variant)) throw new TypeError(`${LEAF}: record ${id} badge variant ${variant} is not a Badge variant`);
    const image = row.image;
    if (image !== undefined && (!isObject(image) || image.slot !== "assets.image" || !isImageResource(image))) throw new TypeError(`${LEAF}: record ${id} requires an assets.image resource`);
    return {
      id, title,
      ...(description ? { description } : {}),
      ...(href ? { href } : {}),
      ...(meta ? { meta } : {}),
      ...(image !== undefined ? { image: image as unknown as NonNullable<RecordCardsRecord["image"]> } : {}),
      editorial: editorialMetadata(row.editorial),
      ...(badgeLabel ? { badge: { label: badgeLabel, ...(variant ? { variant: variant as BadgeVariant } : {}) } } : {}),
    };
  });
  const layout = memberOf(input, "layout");
  if (layout !== undefined && !(LAYOUTS as readonly string[]).includes(layout)) throw new TypeError(`${LEAF}: layout.${layout} is not a RecordCards layout`);
  return <RecordCards records={records} config={config ?? undefined} locale={input.locale} layout={(layout ?? "grid") as RecordCardsLayout} />;
};
