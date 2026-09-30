import { ImageResponse } from "next/og";
import { buildShareCard } from "@clossys/publisher/web";
import { requireCopy, siteShareCardCopyIds, siteShareCardText } from "./site-copy";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "./site-records";

// The share card: the brand label, the tagline's approved copy and the
// alternative text's approved copy, drawn in Designer's default roles. Every
// word comes from the records and every colour and length from
// `buildShareCard`, which refuses anything it cannot use. The card is built
// when the module loads, so a missing copy id fails the build.
const facts = loadBrandFacts();
const card = buildShareCard(siteShareCardText(facts, requireCopy(createSiteCopyResolver(siteTarget()), siteShareCardCopyIds(facts))));

export const alt = card.shareCard.alt;
export const size = { width: card.width, height: card.height };
export const contentType = card.contentType;

export default function Image() {
  return new ImageResponse(card.element, size);
}
