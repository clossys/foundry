/**
 * Slot display labels. A slot's label is the Writer's name for it: the pinned `strings.names`
 * record `<agent>.item.<slot id>`. A slot the Writer has not named yet shows its id without the
 * L0 prefix the IA already shows (`context.market.size` reads "Market size"); the id itself is
 * never the label.
 */
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { parseFrontmatter, type SlotAgent } from "./slot-model/index.js";
import { readCandidate, readPin } from "./slots.js";

const NAMES = "strings.names";
const cache = new Map<string, { key: string; names: ReadonlyMap<string, string> }>();

/** The pinned Writer names, keyed by record context; empty without a valid pin. */
function pinnedNames(consumer: string): ReadonlyMap<string, string> {
  let pin;
  try { pin = readPin(consumer, "writer", NAMES); } catch { return new Map(); }
  if (!pin) return new Map();
  const key = `${pin.candidate}#${pin.sha256}`;
  const hit = cache.get(consumer);
  if (hit?.key === key) return hit.names;
  const names = new Map<string, string>();
  try {
    const candidate = readCandidate(consumer, "writer", NAMES, pin.candidate);
    // A drifted candidate is not the pinned one; its names are not read.
    if (candidate.sha256 === pin.sha256) {
      const parsed = parseFrontmatter(candidate.bytes);
      if (parsed.ok) {
        const locales = parsed.value.fields.locales as readonly string[];
        for (const row of parseWriterSlotBody(parsed.value.body, locales)) {
          if (row.locale === locales[0] && typeof row.record.text === "string" && row.record.text.trim()) names.set(row.record.context, row.record.text.trim());
        }
      }
    }
  } catch { /* unreadable names: every slot falls back */ }
  cache.set(consumer, { key, names });
  return names;
}

/** The id without its L0 prefix, humanised: the fallback when the Writer has no name. */
export function slotIdLabel(id: string): string {
  const rest = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
  const words = rest.replace(/[.-]+/g, " ").trim();
  return words ? words.replace(/^\w/, c => c.toUpperCase()) : id;
}

/** The display label of one slot. `consumer` is the consumer root (`<root>/clossys`). */
export function slotLabel(consumer: string, agent: SlotAgent | string, id: string): string {
  return pinnedNames(consumer).get(`${agent}.item.${id}`) ?? slotIdLabel(id);
}
