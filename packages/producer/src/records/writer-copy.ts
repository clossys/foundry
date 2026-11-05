/**
 * The consumer's pinned Writer copy, read on the Producer side: every record of every pinned Writer
 * `strings.*` candidate whose bytes match its pin, keyed by record id (`studio.<key>`), resolved by
 * the Writer's own resolver. This is how the Producer turns a Writer key into text where it writes
 * text itself (the content-map projection, a plain-text response, a frame's title); Studio resolves
 * the same keys in the browser through `studio/lib/studio-copy.ts`.
 *
 * A key the pinned Writer copy does not hold throws: there is no literal fallback.
 */
import { createHash } from "node:crypto";
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { createCopyResolver } from "@clossys/writer/resolve";
import { parseFrontmatter } from "./slot-model/index.js";
import { candidateStamp, listSlots, readCandidate } from "./slots.js";

/** A Writer key: `<namespace>.<key>`, lower case, dot or dash joined. */
export const WRITER_KEY = /^studio\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export interface WriterCopy {
  /** The source locale: the first locale of the pinned Writer candidates. */
  readonly locale: string;
  /** Every key the pinned Writer copy holds. */
  readonly ids: readonly string[];
  /** Whether the pinned Writer copy holds this key. */
  has(id: string): boolean;
  /** The key's text, ICU arguments filled; throws on a key the pinned copy does not hold. */
  text(id: string, values?: Readonly<Record<string, string | number | boolean>>): string;
}

type Values = Readonly<Record<string, string | number | boolean>>;
/**
 * Keyed on every pin and on every pinned candidate file's stamp (`stamp`), so bytes that change in
 * place after a first read are re-read and re-hashed against their pin, never served stale.
 */
const cache = new Map<string, { key: string; stamp: string; copy: WriterCopy }>();

/** The pinned Writer copy of one consumer (`<root>/clossys`). */
export function writerCopy(consumer: string): WriterCopy {
  const pinned = listSlots(consumer, "writer").filter(entry => entry.pin && entry.id.startsWith("strings."));
  const key = pinned.map(entry => `${entry.id}@${entry.pin!.sha256}`).join("|");
  const stamp = pinned.map(entry => { try { return candidateStamp(consumer, "writer", entry.id, entry.pin!.candidate); } catch { return "-"; } }).join("|");
  const hit = cache.get(consumer);
  if (hit?.key === key && hit.stamp === stamp && !stamp.split("|").includes("-")) return hit.copy;
  const entries: { id: string; text: string; context: string; status: "draft" }[] = [];
  const seen = new Set<string>();
  let locale: string | undefined;
  for (const entry of pinned) {
    const candidate = readCandidate(consumer, "writer", entry.id, entry.pin!.candidate);
    if (candidate.sha256 !== entry.pin!.sha256) throw new Error(`Writer copy: ${entry.id} candidate drifted from its pin`);
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) throw new Error(`Writer copy: ${entry.id} candidate has no frontmatter`);
    const locales = parsed.value.fields.locales as readonly string[];
    locale ??= locales[0];
    for (const row of parseWriterSlotBody(parsed.value.body, locales)) {
      if (row.locale !== locale || typeof row.record.text !== "string" || !WRITER_KEY.test(row.record.id)) continue;
      if (seen.has(row.record.id)) throw new Error(`Writer copy: ${row.record.id} is recorded twice`);
      seen.add(row.record.id);
      entries.push({ id: row.record.id, text: row.record.text, context: row.record.context, status: "draft" });
    }
  }
  if (!locale) throw new Error("Writer copy: no pinned Writer strings");
  const registry = { id: "writer-copy", locale, revision: createHash("sha256").update(key).digest("hex"), source: { kind: "consumer", reference: "clossys/agents/writer" }, entries };
  // Studio previews the pinned drafts; a pin is not editorial approval (as in studio-copy.ts).
  const resolve = createCopyResolver(registry as never, { target: "preview" });
  const sourceLocale = locale;
  const copy: WriterCopy = {
    locale: sourceLocale,
    ids: [...seen],
    has: id => seen.has(id),
    text: (id: string, values?: Values) => {
      const result = resolve({ id, locale: sourceLocale, ...(values ? { values } : {}) } as never) as { text: string } | undefined;
      if (!result) throw new Error(`Writer copy is unresolved: ${id}`);
      return result.text;
    },
  };
  cache.set(consumer, { key, stamp, copy });
  return copy;
}
