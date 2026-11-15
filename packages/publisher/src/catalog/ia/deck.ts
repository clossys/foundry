/**
 * Deck checks (foundry-build-0027). A deck page assembles slides on Designer's deck frame: every frame and section it
 * names is a live Designer slot that ships a package default, and every slide renders on the `slide` medium of its
 * section (one construct, two media). Words stay in Writer records; `checkPageOption` covers record refs and inline copy.
 */
import type { DesignerCatalog, LayoutSlot, PageOption } from "./tree.js";

export const DECK_FRAME = "designer/frames.deck";
const unit = (ref: string): string => ref.replace(/^designer\//, "");

export function checkDeck(pageId: string, page: PageOption, layout: LayoutSlot | undefined, designer: DesignerCatalog): string[] {
  const findings: string[] = [];
  const add = (message: string) => findings.push(`${pageId}: ${message}`);
  if (layout?.frame !== DECK_FRAME) add(`layout frame ${String(layout?.frame)} is not ${DECK_FRAME}`);
  else if (!designer.live.has(unit(DECK_FRAME))) add(`frame ${DECK_FRAME} is not in the Designer catalog`);
  else if (!designer.withDefault.has(unit(DECK_FRAME))) add(`frame ${DECK_FRAME} has no Designer package default`);
  if ((layout?.chrome ?? []).length) add("a deck has no chrome");
  if (!page.sections.length) add("a deck places at least one slide");
  for (const section of page.sections) {
    if (!section.use.startsWith("designer/sections.")) add(`${section.role} places ${section.use}, not a Designer section`);
    else if (!designer.live.has(unit(section.use))) add(`${section.role} places ${section.use}, which the Designer catalog does not have`);
    else if (!designer.withDefault.has(unit(section.use))) add(`${section.role} places ${section.use}, which has no Designer package default`);
    if (section.variant?.medium !== "slide") add(`${section.role} must render on the slide medium (variant.medium slide)`);
  }
  return findings;
}
