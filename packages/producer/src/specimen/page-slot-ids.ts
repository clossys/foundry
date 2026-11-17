/** Page discovery for installed specimens; record bytes stay with pageRecordFromCell. */
import { join } from "node:path";
import { hasSlotModel, listSlots, readSlot, viewPlacedAt } from "../records/slots.js";

const pageOrder = (a: string, b: string) => a === "page.home" ? -1 : b === "page.home" ? 1 : a.localeCompare(b);

/** Native IA membership is authoritative even when no page has an installable pin. */
export async function specimenPageSlotIds(root: string): Promise<string[]> {
  const consumer = join(root, "clossys");
  if (hasSlotModel(consumer)) {
    return listSlots(consumer, "publisher").filter(entry => {
      if (!entry.pin || !entry.candidates.includes(entry.pin.candidate)) return false;
      try {
        const doc = readSlot(consumer, "publisher", entry.id);
        return viewPlacedAt(doc, entry.id, "publisher", entry.position) && doc.kind === "page";
      } catch { return false; }
    }).map(entry => entry.id).sort(pageOrder);
  }
  return [];
}
