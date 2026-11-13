/**
 * The Writer's wording findings (R2F-W1): what the Writer's own slot suite (`runWriterSlotSuite`, the
 * `writer-slots` suite of `clossys check --suites`) says about the wording of the pinned Writer copy, per
 * slot, with the rewrite the Writer has drafted for it.
 *
 * A wording finding is a report, never a block (Producer skill rule "Only wiring blocks"): a voice
 * pattern or banned phrase (W-VOICE), a brand spelling (W-BRAND) or a translation-headroom warning
 * (W-ROOM) on a pinned record's text. Each one is the owner's to settle, through the Writer's interview:
 *
 *   rewrite   the newest other candidate of the slot (the Writer's re-draft, submitted through
 *             `clossys next writer/<slot> --submit`) that holds every affected record with new text the
 *             same suite finds no wording issue in. With one, the owner is asked: rewrite (recommended),
 *             keep as is, or own words. With none, the Writer drafts one first and nothing is asked.
 *   settled   a pin the owner chose for this slot alone (basis `picked`) or an owner-confirmed agent pick:
 *             the owner has decided this copy, so its findings are not asked again.
 *
 * Read-only and deterministic: no model call. The copy is read by the Writer's own parser and checked
 * by the Writer's own suite; this module only selects and groups.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Cell } from "@clossys/director";
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { resolveAgent } from "../agents.js";
import { parseFrontmatter } from "./slot-model/index.js";
import type { PinDoc } from "./slot-model/types.js";
import { listSlots, readCandidate } from "./slots.js";

/** The Writer slot-suite checks that are about wording (a report): voice, brand spelling, translation headroom. */
export const WORDING_CHECKS = Object.freeze(["W-VOICE", "W-BRAND", "W-ROOM"]);

export interface WordingFinding {
  readonly record: string;
  readonly locale: string;
  readonly check: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  /** The pinned record's text. */
  readonly current: string;
}
export interface WordingRewrite {
  /** The candidate holding the rewrite. */
  readonly candidate: string;
  /** The rewritten text of each affected record (record and locale of a finding). */
  readonly texts: readonly { readonly record: string; readonly locale: string; readonly text: string }[];
}
export interface WordingRow {
  readonly slot: string;
  readonly pin: PinDoc;
  readonly findings: readonly WordingFinding[];
  readonly rewrite: WordingRewrite | null;
}
export interface WriterWording {
  readonly rows: readonly WordingRow[];
  /** Why the suite could not run (the Writer package is not built, say); then no row is derived. */
  readonly unavailable: string | null;
}

interface SuiteSlot { slot: string; path: string; locales: string[]; rows: { locale: string; record: Record<string, unknown> }[] }
interface SuiteFinding { check: string; severity: "error" | "warning"; slot: string; record?: string; locale?: string; message: string }
interface WriterChecks {
  runWriterSlotSuite(input: { slots: readonly SuiteSlot[]; director?: unknown }): { findings: SuiteFinding[] };
  directorVoiceFromCells(cells: Cell[]): unknown;
}

const require_ = createRequire(import.meta.url);
let checks: WriterChecks | null = null;
/** The Writer's own slot-suite module from its installed build (synchronous: the interview is). */
function writerChecks(): WriterChecks {
  checks ??= require_(join(resolveAgent("writer").packageRoot, "dist", "slot-contracts", "checks.js")) as WriterChecks;
  return checks;
}

/** One candidate of a Writer slot as the suite reads it, or null when it does not parse. */
function suiteSlot(consumer: string, slot: string, name: string): SuiteSlot | null {
  try {
    const candidate = readCandidate(consumer, "writer", slot, name);
    const parsed = parseFrontmatter(candidate.bytes);
    if (!parsed.ok) return null;
    const locales = parsed.value.fields.locales;
    if (!Array.isArray(locales) || !locales.length || !locales.every(locale => typeof locale === "string")) return null;
    const rows = parseWriterSlotBody(parsed.value.body, locales as string[]) as unknown as SuiteSlot["rows"];
    return { slot, path: `agents/writer/${slot}/candidates/${name}`, locales: locales as string[], rows };
  } catch { return null; }
}

const key = (record: string, locale: string) => `${record}\u0000${locale}`;
const textOf = (slot: SuiteSlot, record: string, locale: string): string | undefined => {
  const row = slot.rows.find(each => each.locale === locale && String(each.record.id) === record);
  return typeof row?.record.text === "string" ? row.record.text : undefined;
};
const wording = (finding: SuiteFinding) => WORDING_CHECKS.includes(finding.check) && finding.record !== undefined && finding.locale !== undefined;
/** The owner already decided this slot's copy: picked for it alone, or an agent pick the owner confirmed. */
export const ownerSettled = (pin: PinDoc) => pin.basis === "picked" || (pin.basis === "agent" && pin.confirmed !== undefined);

/** Every pinned Writer slot with wording findings the owner has not settled, and the Writer's rewrite of each. */
export function writerWording(consumer: string, directorCells: readonly Cell[] = []): WriterWording {
  let api: WriterChecks;
  try { api = writerChecks(); }
  catch (error) { return { rows: [], unavailable: `the Writer slot suite does not load: ${error instanceof Error ? error.message : String(error)}` }; }
  const director = directorCells.length ? api.directorVoiceFromCells([...directorCells]) : undefined;
  const entries = listSlots(consumer, "writer").filter(entry => entry.pin);
  const pinned = new Map<string, SuiteSlot>();
  for (const entry of entries) { const slot = suiteSlot(consumer, entry.id, entry.pin!.candidate); if (slot) pinned.set(entry.id, slot); }
  // The lexicon slots carry the avoid, brand and pattern rules every check reads.
  const lexicon = [...pinned.values()].filter(slot => slot.slot.startsWith("lexicon."));
  const run = (slots: readonly SuiteSlot[]) => api.runWriterSlotSuite({ slots, ...(director ? { director } : {}) }).findings.filter(wording);
  const bySlot = new Map<string, SuiteFinding[]>();
  for (const finding of run([...pinned.values()])) bySlot.set(finding.slot, [...(bySlot.get(finding.slot) ?? []), finding]);
  const rows: WordingRow[] = [];
  for (const entry of entries) {
    const found = bySlot.get(entry.id);
    const slot = pinned.get(entry.id);
    if (!found?.length || !slot || ownerSettled(entry.pin!)) continue;
    const findings = found.map(finding => ({ record: finding.record!, locale: finding.locale!, check: finding.check, severity: finding.severity, message: finding.message, current: textOf(slot, finding.record!, finding.locale!) ?? "" }));
    const affected = [...new Map(findings.map(finding => [key(finding.record, finding.locale), finding])).values()];
    // The rewrite: the newest other candidate that rewrites every affected record and clears its wording findings.
    let rewrite: WordingRewrite | null = null;
    for (const name of [...entry.candidates].reverse()) {
      if (name === entry.pin!.candidate) continue;
      const other = suiteSlot(consumer, entry.id, name);
      if (!other) continue;
      const texts = affected.map(finding => ({ record: finding.record, locale: finding.locale, text: textOf(other, finding.record, finding.locale) }));
      if (texts.some((row, at) => row.text === undefined || row.text === affected[at]!.current)) continue;
      const left = new Set(run([...lexicon.filter(each => each.slot !== entry.id), other]).filter(finding => finding.slot === entry.id).map(finding => key(finding.record!, finding.locale!)));
      if (affected.some(finding => left.has(key(finding.record, finding.locale)))) continue;
      rewrite = { candidate: name, texts: texts as WordingRewrite["texts"] };
      break;
    }
    rows.push({ slot: entry.id, pin: entry.pin!, findings, rewrite });
  }
  return { rows, unavailable: null };
}
