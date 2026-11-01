/** Page discovery for installed specimens; record bytes stay with pageRecordFromCell. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasSlotModel, listSlots, readSlot } from "../records/slots.js";
import { validateSlotDoc } from "../records/slot-model/index.js";

const pageOrder = (a: string, b: string) => a === "page.home" ? -1 : b === "page.home" ? 1 : a.localeCompare(b);

/** Native IA membership is authoritative even when no page has an installable pin. */
export async function specimenPageSlotIds(root: string): Promise<string[]> {
  const consumer = join(root, "clossys");
  if (hasSlotModel(consumer)) {
    return listSlots(consumer, "publisher").filter(entry => {
      if (!entry.pin || !entry.candidates.includes(entry.pin.candidate)) return false;
      try {
        const doc = readSlot(consumer, "publisher", entry.id);
        return !validateSlotDoc(doc).length && doc.id === entry.id && doc.agent === "publisher" && doc.kind === "page"
          && doc.ia.l0 === entry.position.l0 && doc.ia.l1 === entry.position.l1
          && doc.ia.l2 === entry.position.l2 && doc.ia.order === entry.position.order;
      } catch { return false; }
    }).map(entry => entry.id).sort(pageOrder);
  }
  let tree: { active?: Record<string, number> } | undefined;
  try { tree = JSON.parse(await readFile(join(consumer, "agents", "publisher", "tree.json"), "utf8")); } catch { return []; }
  return Object.keys(tree?.active ?? {}).filter(id => /^page\.[a-z0-9][a-z0-9-]*$/.test(id)).sort(pageOrder);
}
