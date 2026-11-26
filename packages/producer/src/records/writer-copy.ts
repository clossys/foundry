/**
 * The consumer's pinned Writer copy, read on the Producer side: every record of every pinned record body of every
 * Writer copy slot (`writer-copy-slots.ts`: Writer's tree data, never an id prefix) whose bytes match its pin, keyed by record id in any namespace the consumer
 * registers (`studio.<key>`, `site.<key>`, ...), resolved by the Writer's own resolver. This is how the Producer turns a Writer key into text where it writes
 * text itself (the content-map projection, a plain-text response, a frame's title); Studio resolves
 * the same keys in the browser through `studio/lib/studio-copy.ts` (not shipped).
 *
 * A key the pinned Writer copy does not hold throws: there is no literal fallback. Whether a value
 * is a key is decided by registration (`has`), never by a namespace prefix.
 *
 * Pin = approval (owner Producer round 2): a key under an owner pin (`pinApproved`: basis picked or
 * bulk) is editorially approved; a key under a planner or agent pin stays a draft, a confirm item,
 * until the owner pins it. `pipeline/status.ts` (`writerKeysUnapproved`) reads the same rule.
 */
import { createHash } from "node:crypto";
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { createCopyResolver } from "@clossys/writer/resolve";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "@clossys/writer";
import { parseFrontmatter, pinApproved } from "./slot-model/index.js";
import { parseCandidateName } from "./candidate.js";
import { candidateStamp, readCandidate, readPins, readSlotRecordText } from "./slots.js";
import { writerCopyPins, writerCopySlots } from "./writer-copy-slots.js";

/**
 * The shape of a Writer key: `<namespace>.<key>`, lower case, dot or dash joined, in any namespace.
 * It tells a key-shaped value from a literal; only registration in the pinned Writer copy makes it a key.
 */
export const WRITER_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z0-9]+(?:[.-][a-z0-9]+)*)+$/;

export interface WriterCopy {
  /** The source locale: the first locale of the pinned Writer candidates. */
  readonly locale: string;
  /** Every key the pinned Writer copy holds. */
  readonly ids: readonly string[];
  /** Whether the pinned Writer copy holds this key. */
  has(id: string): boolean;
  /** Whether this key's pin is the owner's approval (pin = approval); false for a planner or agent pin, or a key not held. */
  approved(id: string): boolean;
  /** The key's text, ICU arguments filled; throws on a key the pinned copy does not hold. */
  text(id: string, values?: Readonly<Record<string, string | number | boolean>>): string;
}

type Values = Readonly<Record<string, string | number | boolean>>;

/**
 * The copy keys a Writer slot's own contract declares (its slot.json `contract.copy.fields[].key`). A slot with no
 * slot.json, or no copy contract, declares none; an unreadable slot.json throws (no guess at its contract).
 */
export function contractCopyKeys(dir: string): ReadonlySet<string> {
  const text = readSlotRecordText(dir, "slot.json");
  if (text === undefined) return new Set();
  const contract = (JSON.parse(text) as { contract?: unknown }).contract;
  const copy = typeof contract === "object" && contract !== null ? (contract as { copy?: unknown }).copy : undefined;
  const fields = typeof copy === "object" && copy !== null ? (copy as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(fields)) return new Set();
  return new Set(fields.flatMap(field => typeof field === "object" && field !== null && typeof (field as { key?: unknown }).key === "string" ? [(field as { key: string }).key] : []));
}

/**
 * A slot-owned row key in the Writer id grammar (lower case, dash joined): a camelCase contract key folds to its
 * kebab-case form (`siteName` is stored as `site-name`), a lower-case key is itself. The contract and the pinned bytes
 * keep the key as written; only the registered id folds, so no re-pin.
 */
export const writerKeyFold = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * The key a pinned row registers under. The slot's contract decides the namespace, not the dot: a row whose id is a
 * key its slot's contract declares (`declared`, `contractCopyKeys`) registers as `<slot>.<key>`, and so does an
 * undotted row id (a meta slot's `title` registers as `page.home.meta.title`), its key folded to the Writer id grammar
 * (`writerKeyFold`: a publication meta's `siteName` registers as `publication.site.meta.site-name`). Any other dotted
 * id is an authored global Writer id and registers as itself. Two slots holding one contract key (`navigation.label`
 * in the site header and the site footer) never collide, and a `<slot>#<key>` ref, in either form, resolves through
 * `<slot>.<key>` as install.ts `writerKeyOf` and pinned-publication.ts `keyOf` read it.
 */
export const writerRowKey = (slot: string, id: string, declared: ReadonlySet<string>): string => declared.has(id) || !id.includes(".") ? `${slot}.${writerKeyFold(id)}` : id;
/**
 * Keyed on every pin (its basis too: an owner re-pin of the same bytes approves) and on every pinned candidate file's stamp (`stamp`), so bytes that change in
 * place after a first read are re-read and re-hashed against their pin, never served stale.
 */
const cache = new Map<string, { key: string; stamp: string; copy: WriterCopy }>();

/**
 * Every Writer key that more than one pinned Writer copy slot records (source locale), with the slots that
 * record it, sorted. One slot owns a key: `writerCopy` refuses a duplicate, `owner.wiring` uses this to fail
 * an owner option whose answer would create one, and `clossys pin` refuses a Writer pin that would. `overlay` is
 * the pin about to be written: slot `slot` then holds `candidate` for `record` (every other record kept; a slot
 * without records holds only `candidate`). Unreadable or drifted candidates are left to `writerCopy`.
 */
export function writerCopyDuplicates(consumer: string, overlay?: { readonly slot: string; readonly record?: string; readonly candidate: string }): { id: string; slots: string[] }[] {
  const holders = new Map<string, string[]>();
  for (const entry of writerCopySlots(consumer)) {
    let names = entry.pin ? readPins(consumer, "writer", entry.id).map(pin => pin.candidate).filter(name => name.endsWith(".md")) : [];
    if (overlay?.slot === entry.id) names = [...names.filter(name => overlay.record !== undefined && parseCandidateName(name)?.name !== overlay.record), overlay.candidate];
    let declared: ReadonlySet<string>;
    try { declared = contractCopyKeys(entry.dir); } catch { continue; }
    for (const name of names) {
      let bytes: string;
      try { bytes = readCandidate(consumer, "writer", entry.id, name).bytes; } catch { continue; }
      const parsed = parseFrontmatter(bytes);
      if (!parsed.ok) continue;
      const locales = parsed.value.fields.locales as readonly string[];
      let rows: ReturnType<typeof parseWriterSlotBody>;
      try { rows = parseWriterSlotBody(parsed.value.body, locales); } catch { continue; }
      for (const row of rows) {
        if (row.locale !== locales[0] || typeof row.record.text !== "string") continue;
        const id = writerRowKey(entry.id, row.record.id, declared);
        const slots = holders.get(id) ?? [];
        if (!slots.includes(entry.id)) slots.push(entry.id);
        holders.set(id, slots);
      }
    }
  }
  return [...holders].filter(([, slots]) => slots.length > 1).map(([id, slots]) => ({ id, slots: slots.sort() })).sort((a, b) => a.id.localeCompare(b.id));
}

/** The pinned Writer copy of one consumer (`<root>/clossys`). */
export function writerCopy(consumer: string): WriterCopy {
  const pinned = writerCopyPins(consumer).map(({ entry, pin }) => ({ entry, pin, declared: contractCopyKeys(entry.dir) }));
  // Keyed on each slot's declared contract keys too: a contract edit re-keys its rows.
  const key = pinned.map(({ entry, pin, declared }) => `${entry.id}/${pin.candidate}@${pin.sha256}#${pin.basis}[${[...declared].join(",")}]`).join("|");
  // An unstampable candidate is never served from cache: the full read below raises its real error.
  const stamps = pinned.map(({ entry, pin }) => { try { return candidateStamp(consumer, "writer", entry.id, pin.candidate); } catch (error) { return { unreadable: error }; } });
  const stamp = stamps.map(row => typeof row === "string" ? row : "-").join("|");
  const hit = cache.get(consumer);
  if (hit?.key === key && hit.stamp === stamp && stamps.every(row => typeof row === "string")) return hit.copy;
  type Entry = { id: string; text: string; context: string; status: "draft" | "approved"; approval?: { approvedBy: "owner"; approvedAt: string; textFingerprint: string; fingerprintAlgorithm: typeof COPY_FINGERPRINT_ALGORITHM } };
  const entries: Entry[] = [];
  const approvedIds = new Set<string>();
  const seen = new Set<string>();
  let locale: string | undefined;
  for (const { entry, pin, declared } of pinned) {
    const candidate = readCandidate(consumer, "writer", entry.id, pin.candidate);
    if (candidate.sha256 !== pin.sha256) throw new Error(`Writer copy: ${entry.id} candidate drifted from its pin`);
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) throw new Error(`Writer copy: ${entry.id} candidate has no frontmatter`);
    const locales = parsed.value.fields.locales as readonly string[];
    const approved = pinApproved(pin.basis);
    locale ??= locales[0];
    for (const row of parseWriterSlotBody(parsed.value.body, locales)) {
      if (row.locale !== locale || typeof row.record.text !== "string") continue;
      const id = writerRowKey(entry.id, row.record.id, declared);
      if (seen.has(id)) throw new Error(`Writer copy: ${id} is recorded twice`);
      seen.add(id);
      if (approved) approvedIds.add(id);
      entries.push(approved
        ? { id, text: row.record.text, context: row.record.context, status: "approved",
            approval: { approvedBy: "owner", approvedAt: pin.at, textFingerprint: computeCopyFingerprint(row.record.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM } }
        : { id, text: row.record.text, context: row.record.context, status: "draft" });
    }
  }
  if (!locale) throw new Error("Writer copy: no pinned Writer strings");
  const registry = { id: "writer-copy", locale, revision: createHash("sha256").update(key).digest("hex"), source: { kind: "consumer", reference: "clossys/agents/writer" }, entries };
  // The preview target serves owner-approved keys and the planner or agent drafts alike; approval is `approved(id)`.
  const resolve = createCopyResolver(registry as never, { target: "preview" });
  const sourceLocale = locale;
  const copy: WriterCopy = {
    locale: sourceLocale,
    ids: [...seen],
    has: id => seen.has(id),
    approved: id => approvedIds.has(id),
    text: (id: string, values?: Values) => {
      const result = resolve({ id, locale: sourceLocale, ...(values ? { values } : {}) } as never) as { text: string } | undefined;
      if (!result) throw new Error(`Writer copy is unresolved: ${id}`);
      return result.text;
    },
  };
  cache.set(consumer, { key, stamp, copy });
  return copy;
}
