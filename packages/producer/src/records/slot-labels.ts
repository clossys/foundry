/**
 * Slot display labels. A slot's label is the Writer's name for it: the pinned `strings.names`
 * record `<agent>.item.<slot id>`. A slot the Writer has not named yet shows its id without the
 * L0 prefix the IA already shows (`context.market.size` reads "Market size"); the id itself is
 * never the label.
 */
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { parseFrontmatter, type SlotAgent } from "./slot-model/index.js";
import { readCandidate, readSlotEntry } from "./slots.js";

const NAMES = "strings.names";
const cache = new Map<string, { key: string; names: ReadonlyMap<string, string> }>();

/**
 * The pinned Writer names, keyed by record context; empty while the Writer has no `strings.names`
 * slot or no valid pin. A pinned candidate that cannot be read or parsed surfaces as an error.
 */
function pinnedNames(consumer: string): ReadonlyMap<string, string> {
  const pin = readSlotEntry(consumer, "writer", NAMES)?.pin;
  if (!pin) return new Map();
  const key = `${pin.candidate}#${pin.sha256}`;
  const hit = cache.get(consumer);
  if (hit?.key === key) return hit.names;
  const names = new Map<string, string>();
  const candidate = readCandidate(consumer, "writer", NAMES, pin.candidate);
  // A drifted candidate is not the pinned one; its names are not read (the pin check reports drift).
  if (candidate.sha256 === pin.sha256) {
    const parsed = parseFrontmatter(candidate.bytes);
    if (parsed.ok) {
      const locales = parsed.value.fields.locales as readonly string[];
      for (const row of parseWriterSlotBody(parsed.value.body, locales)) {
        if (row.locale === locales[0] && typeof row.record.text === "string" && row.record.text.trim()) names.set(row.record.context, row.record.text.trim());
      }
    }
  }
  cache.set(consumer, { key, names });
  return names;
}

/** The id without its L0 prefix, humanised: the fallback when the Writer has no name. */
export function slotIdLabel(id: string): string {
  const rest = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
  const words = rest.replace(/[.-]+/g, " ").trim();
  return words ? words.replace(/^\w/, c => c.toUpperCase()) : id;
}

/**
 * A record key (a lexicon rule, a cell tail, a layer) as words: the fallback label for a key the
 * Writer has not named. The one id-to-words rule outside the Writer names, kept here with the slot
 * fallback so no other module derives a label from an id.
 */
export function keyLabel(key: string): string {
  return key.replace(/[-_.]+/g, " ").trim().replace(/^\w/, c => c.toUpperCase());
}

/** The display label of one slot. `consumer` is the consumer root (`<root>/clossys`). */
export function slotLabel(consumer: string, agent: SlotAgent | string, id: string): string {
  return pinnedNames(consumer).get(`${agent}.item.${id}`) ?? slotIdLabel(id);
}

/** `slotLabel` for many slots at once: the Writer names are read once, for a whole gallery. */
export function slotLabels(consumer: string): (agent: SlotAgent | string, id: string) => string {
  const names = pinnedNames(consumer);
  return (agent, id) => names.get(`${agent}.item.${id}`) ?? slotIdLabel(id);
}
