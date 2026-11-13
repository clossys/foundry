/**
 * `clossys migrate director-refs`: re-cite pinned Writer candidates at the pinned Director version
 * when the cited Director cell moved to a new version whose Direction is unchanged.
 *
 * A pinned Writer candidate cites Director cells as `director:<cell>@<version>` (frontmatter
 * `source.ref`, record `evidence`/`strategy`, record `directorSources`). When the Director pin moves
 * from version N to M and the cell's `## Direction` section is byte-identical between the two
 * candidates, the Writer copy is still derived from the same Direction: the citation is all that is
 * stale. The plan then holds a new Writer candidate whose bytes differ only in those refs (copy text
 * proved identical by the Writer's own slot-body parser), which `apply` writes through
 * `writeCandidate` and picks through `clossys pick --by agent:<seat>`.
 *
 * Anything else is refused per slot and reported: a changed Direction (the copy must be re-drafted
 * by the Writer skill), a cited version with no candidate, moved Direction lines under a
 * record-level `directorSources` line ref, or a ref that would change copy text. A Writer slot an
 * owner picked (basis picked) gets the candidate but no pick: the owner decides it.
 */
import { agentModule } from "../server/cells.js";
import { readPinned, type PinnedCandidate } from "../records/pinned.js";
import { CANDIDATE_NAME, parseFrontmatter, pinStatus } from "../records/slot-model/index.js";
import { readCandidate, readSlotEntry } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";

export interface DirectorRefBump { readonly cell: string; readonly from: number; readonly to: number }
export interface DirectorRefsBump {
  readonly slot: string;
  /** The pinned Writer candidate being re-cited. */
  readonly from: string;
  /** Candidate name stem the new version is written under (`studio` for `studio-v1.md`). */
  readonly stem: string;
  readonly refs: readonly DirectorRefBump[];
  /** The re-cited candidate bytes. */
  readonly bytes: string;
  /** True when an owner picked the Writer slot: the candidate is written, the owner pins it. */
  readonly ownerPick: boolean;
}
export interface DirectorRefsRefusal { readonly slot: string; readonly cell: string; readonly from: number; readonly to: number; readonly reason: string }
export interface DirectorRefsPlan {
  readonly bumps: readonly DirectorRefsBump[];
  readonly refusals: readonly DirectorRefsRefusal[];
}
export interface DirectorRefsApplied {
  readonly slot: string;
  readonly candidate: string;
  /** The pick line, or the owner decision still needed. */
  readonly outcome: string;
  readonly picked: boolean;
}

const REF = /director:([a-z0-9][a-z0-9.-]*)@([1-9][0-9]*)(?![0-9])/g;

/** The raw `## Direction` section of a candidate body (heading to the next `## ` heading). */
export function directionSection(bytes: string): string {
  const parsed = parseFrontmatter(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  const lines = parsed.value.body.split("\n");
  const start = lines.findIndex(line => line.trim() === "## Direction");
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

interface DirectorVersion { readonly bytes: string; readonly lines: readonly number[] }
interface DirectorIndex {
  readonly pinned: ReadonlyMap<string, PinnedCandidate>;
  /** `<cell>@<version>` → that version's candidate (same name stem as the pinned one), or a reason it is unreadable. */
  version(cell: string, version: number): Promise<DirectorVersion | string>;
}

async function directorIndex(consumer: string): Promise<DirectorIndex> {
  const director = await agentModule("director", "index.js");
  const pinned = new Map(readPinned(consumer, "director").pinned.map(candidate => [candidate.id, candidate]));
  const cache = new Map<string, DirectorVersion | string>();
  return {
    pinned,
    async version(cell, version) {
      const key = `${cell}@${version}`;
      if (cache.has(key)) return cache.get(key)!;
      const pin = pinned.get(cell);
      const match = pin ? CANDIDATE_NAME.exec(pin.name) : null;
      const entry = readSlotEntry(consumer, "director", cell);
      const name = match ? `${match[1]}-v${version}.${match[3]}` : undefined;
      let result: DirectorVersion | string;
      if (!pin || !match || !entry) result = "the Director cell is not pinned";
      else if (!entry.candidates.includes(name!)) result = `no Director candidate ${name} for the cited version`;
      else {
        const bytes = readCandidate(consumer, "director", cell, name!).bytes;
        try {
          const parsed = director.slotCandidateCell({ id: cell, version, updated: pin.pin.at.slice(0, 10), path: name, bytes }) as { direction: { line: number }[] };
          result = { bytes, lines: parsed.direction.map(bullet => bullet.line) };
        } catch (error) { result = `cited Director candidate is unreadable: ${error instanceof Error ? error.message : String(error)}`; }
      }
      cache.set(key, result);
      return result;
    },
  };
}

interface Rows { readonly ids: string[]; readonly texts: unknown[]; readonly sources: string[] }
async function writerRows(bytes: string): Promise<Rows> {
  const parser = await agentModule("writer", "slot-body.js");
  const parsed = parseFrontmatter(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  const locales = Array.isArray(parsed.value.fields.locales) ? parsed.value.fields.locales.filter((locale): locale is string => typeof locale === "string") : [];
  const rows = parser.parseWriterSlotBody(parsed.value.body, locales) as { locale: string; record: Record<string, unknown> }[];
  return {
    ids: rows.map(row => `${row.locale}/${String(row.record.id)}`),
    texts: rows.map(row => row.record.text),
    sources: rows.flatMap(row => Array.isArray(row.record.directorSources)
      ? (row.record.directorSources as unknown[]).flatMap(source => source && typeof source === "object" && typeof (source as { ref?: unknown }).ref === "string" ? [(source as { ref: string }).ref] : [])
      : []),
  };
}

/** Plan every pinned Writer slot whose Director citations are older than the Director pins. Reads only. */
export async function planDirectorRefs(consumer: string): Promise<DirectorRefsPlan> {
  const director = await directorIndex(consumer);
  const bumps: DirectorRefsBump[] = [], refusals: DirectorRefsRefusal[] = [];
  for (const candidate of readPinned(consumer, "writer").pinned) {
    const stale = new Map<string, DirectorRefBump>();
    for (const match of candidate.bytes.matchAll(REF)) {
      const cell = match[1]!, from = Number(match[2]);
      const to = director.pinned.get(cell)?.version;
      if (to !== undefined && from < to) stale.set(`${cell}@${from}`, { cell, from, to });
    }
    if (!stale.size) continue;
    const refuse = (ref: DirectorRefBump, reason: string) => refusals.push({ slot: candidate.id, ...ref, reason });
    const before = refusals.length;
    let rows: Rows | undefined;
    try { rows = await writerRows(candidate.bytes); }
    catch (error) { refuse([...stale.values()][0]!, `the pinned Writer candidate is unreadable: ${error instanceof Error ? error.message : String(error)}`); continue; }
    for (const ref of stale.values()) {
      const cited = await director.version(ref.cell, ref.from);
      const pinned = await director.version(ref.cell, ref.to);
      if (typeof cited === "string") { refuse(ref, cited); continue; }
      if (typeof pinned === "string") { refuse(ref, pinned); continue; }
      if (directionSection(cited.bytes) !== directionSection(pinned.bytes)) { refuse(ref, "Direction changed between the cited and the pinned version: re-draft the copy with the Writer skill"); continue; }
      const moved = cited.lines.join(",") !== pinned.lines.join(",");
      if (moved && rows.sources.includes(`director:${ref.cell}@${ref.from}`)) refuse(ref, "Direction lines moved under a record directorSources line ref: re-draft the copy with the Writer skill");
    }
    if (refusals.length > before) continue;
    const bytes = candidate.bytes.replace(REF, (token, cell: string, version: string) => {
      const ref = stale.get(`${cell}@${version}`);
      return ref ? `director:${cell}@${ref.to}` : token;
    });
    const after = await writerRows(bytes);
    if (JSON.stringify(after.ids) !== JSON.stringify(rows.ids) || JSON.stringify(after.texts) !== JSON.stringify(rows.texts)) {
      for (const ref of stale.values()) refuse(ref, "re-citing would change copy text (a ref sits inside a copy record)");
      continue;
    }
    const stem = CANDIDATE_NAME.exec(candidate.name)![1]!;
    bumps.push({ slot: candidate.id, from: candidate.name, stem, refs: [...stale.values()], bytes, ownerPick: pinStatus(candidate.pin.basis) === "pinned" });
  }
  return { bumps, refusals };
}

/**
 * Write each planned candidate (an existing candidate with the same bytes is reused, so a re-run
 * after an interruption writes nothing twice) and pick it through `pick` (`clossys pick`'s handler)
 * unless an owner picked the slot.
 */
export async function applyDirectorRefs(
  consumer: string,
  plan: DirectorRefsPlan,
  pick: (slot: string, candidate: string) => Promise<{ exitCode: number; message: string }>,
): Promise<DirectorRefsApplied[]> {
  const applied: DirectorRefsApplied[] = [];
  for (const bump of plan.bumps) {
    const entry = readSlotEntry(consumer, "writer", bump.slot)!;
    const existing = entry.candidates.find(name => readCandidate(consumer, "writer", bump.slot, name).bytes === bump.bytes);
    const candidate = existing ?? writeCandidate(consumer, "writer", bump.slot, bump.stem, bump.bytes).name;
    if (bump.ownerPick) {
      applied.push({ slot: bump.slot, candidate, picked: false, outcome: `owner decision needed: clossys pin writer/${bump.slot} ${candidate} --basis picked (the slot holds an owner pick)` });
      continue;
    }
    const result = await pick(bump.slot, candidate);
    applied.push({ slot: bump.slot, candidate, picked: result.exitCode === 0, outcome: result.message });
  }
  return applied;
}

