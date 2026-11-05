/**
 * Display labels. A label is the Writer's name for a registry id, read from the pinned
 * `strings.names` records:
 *
 *   `<agent>.item.<slot id>`   a slot (`director.item.context.market.size`);
 *   `<agent>.ia.<IA id>`       an IA node, group or layer (`designer.ia.themes.colors`).
 *
 * There is no fallback: an id the Writer has not named throws, so a slot or IA group added without
 * its name fails the projection that would show it (`check:copy-source` names every missing one
 * before that). No other module turns an id into words.
 */
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { parseFrontmatter, type SlotAgent } from "./slot-model/index.js";
import { readCandidate, readPin } from "./slots.js";

const NAMES = "strings.names";
const cache = new Map<string, { key: string; names: ReadonlyMap<string, string> }>();

/** The pinned Writer names, keyed by record context; empty without a valid pin. */
export function pinnedNames(consumer: string): ReadonlyMap<string, string> {
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
  } catch { /* unreadable names: every label below throws */ }
  cache.set(consumer, { key, names });
  return names;
}

/** The Writer name context of a slot. */
export const slotNameKey = (agent: SlotAgent | string, id: string) => `${agent}.item.${id}`;
/** The Writer name context of an IA node, group or layer. */
export const iaNameKey = (agent: SlotAgent | string, id: string) => `${agent}.ia.${id}`;

const named = (names: ReadonlyMap<string, string>, context: string): string => {
  const name = names.get(context);
  if (name === undefined) throw new Error(`No Writer name for ${context} (pinned writer/${NAMES})`);
  return name;
};

/** The display label of one slot. `consumer` is the consumer root (`<root>/clossys`). */
export function slotLabel(consumer: string, agent: SlotAgent | string, id: string): string {
  return named(pinnedNames(consumer), slotNameKey(agent, id));
}

/** `slotLabel` for many slots at once: the Writer names are read once, for a whole gallery. */
export function slotLabels(consumer: string): (agent: SlotAgent | string, id: string) => string {
  const names = pinnedNames(consumer);
  return (agent, id) => named(names, slotNameKey(agent, id));
}

/** The display label of one IA node, group or layer. */
export function iaLabel(consumer: string, agent: SlotAgent | string, id: string): string {
  return named(pinnedNames(consumer), iaNameKey(agent, id));
}
