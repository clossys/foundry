/**
 * R08 Immutability and naming, over every candidate of every slot:
 * - R08.1 the name is `<leaf>-v<n>.<ext>`: `<leaf>` is the slot id's last dot-segment or a record the slot's
 *   contract declares (slot-model candidateStemIssue), `ext` is the kind's extension, and n is never reused, retired
 *   candidates included;
 * - R08.2 the file's bytes are the bytes it was created with, proven twice:
 *   - by the ledger: sha256(file bytes) equals the slot ledger's `submit` event sha256 for that name,
 *     carried through later `migrate` events (records/ledger.ts expectedCandidateSha, the same sha R14.1
 *     holds the file to); a file without a submit event, or under an unreadable ledger, fails;
 *   - by git: a candidate with any change after the commit that added it (or an uncommitted edit)
 *     fails, unless a recorded format-only migration explains that change: a `migrated` event in the
 *     migration manifest (records/migrations.ts) for the same file whose blob ids before and after
 *     equal the change's. An unrecorded edit, before or after a migration, still fails, and so does an
 *     unreadable or invalid manifest. The scan includes merge commits' diffs against their first
 *     parent (git.ts): the add is the last side-line `A`, else a merge's `A` (a merge-only candidate),
 *     and a merge change after it counts as an edit when it brings a byte state no earlier change had
 *     (a conflict resolution or an evil merge), not when it only carries a side-line change in.
 * R08.3 (variants ride the vary tag, never the stem) is pending.
 */
import { AGENT_KIND, CANDIDATE_NAME, KIND_EXT, candidateStemIssue } from "../../records/slot-model/index.js";
import { expectedCandidateSha, ledgerEventsOf } from "../../records/ledger.js";
import { LOOP_KIND } from "../../loop/agent-loops.js";
import type { CandidateRecord, ConstitutionContext, PathChange, Row, RuleModule, SlotRecord } from "../types.js";
import { allSlots, isObject, pending, row, slotDoc } from "./shared.js";

/** The extensions a slot's candidates may use: its kind's, else its agent's kinds'. */
function allowedExtensions(agent: string, kind: unknown): Set<string> {
  // A loop slot (Producer's, or an agent's own, foundry-build-0048 U9a) holds JSON loop versions.
  if (kind === LOOP_KIND) return new Set(["json"]);
  if (typeof kind === "string" && kind in KIND_EXT) return new Set([KIND_EXT[kind as keyof typeof KIND_EXT]]);
  const kinds = (AGENT_KIND as Record<string, readonly string[] | string | undefined>)[agent];
  const list = Array.isArray(kinds) ? kinds : typeof kinds === "string" ? [kinds] : [];
  return new Set(list.flatMap(item => (item in KIND_EXT ? [KIND_EXT[item as keyof typeof KIND_EXT]] : [])));
}

export function naming(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const doc = slotDoc(slot);
    const extensions = allowedExtensions(slot.agent, isObject(doc) ? doc.kind : undefined);
    const versions = new Map<number, string[]>();
    const retiredNames = new Set(slot.retired.filter(entry => CANDIDATE_NAME.test(entry.name)).map(entry => entry.name));
    for (const record of slot.retired) {
      const value = record.value;
      if (isObject(value) && typeof value.candidate === "string") retiredNames.add(value.candidate);
    }
    for (const name of [...slot.candidates.map(candidate => candidate.name), ...retiredNames]) {
      const match = CANDIDATE_NAME.exec(name);
      if (match) versions.set(Number(match[2]), [...(versions.get(Number(match[2])) ?? []), name]);
    }
    for (const candidate of slot.candidates) {
      const match = CANDIDATE_NAME.exec(candidate.name);
      const defects: string[] = [];
      if (!match) defects.push("name is not <leaf>-v<n>.<ext>");
      else {
        const stemIssue = candidateStemIssue(slot.id, isObject(doc) ? doc.contract : undefined, match[1]!);
        if (stemIssue) defects.push(`stem ${match[1]} ${stemIssue}`);
        if (extensions.size && !extensions.has(match[3]!)) defects.push(`.${match[3]} is not this kind's extension (.${[...extensions].join("/.")})`);
        const sharing = versions.get(Number(match[2]))!.filter(other => other !== candidate.name);
        if (sharing.length) defects.push(`v${match[2]} is also used by ${sharing.sort().join(", ")}${retiredNames.has(sharing[0]!) ? " (retired)" : ""}`);
        if (retiredNames.has(candidate.name)) defects.push("name was retired and is written again");
      }
      if (defects.length) rows.push(row("R08", "R08.1", slot, defects.join("; "), candidate.path, candidate.name));
    }
  }
  return rows;
}

/** The keys (`<path> <from blob> <to blob>`) of the changes recorded migrations explain. */
function migratedChanges(ctx: ConstitutionContext): Set<string> {
  return new Set((ctx.migrations?.events ?? []).map(event => `${event.file} ${event.from.blob} ${event.to.blob}`));
}

export function editedInPlace(ctx: ConstitutionContext): Row[] {
  const history = ctx.history();
  if (!history.available) return [{ rule: "R08", check: "R08.2", agent: "*", slot: "*", reason: `cannot prove immutability: ${history.error ?? "no git history"}`, path: "." }];
  const rows: Row[] = [];
  if (ctx.migrations?.error !== undefined) rows.push({ rule: "R08", check: "R08.2", agent: "*", slot: "*", reason: `migration manifest invalid, it explains no change: ${ctx.migrations.error}`, path: ctx.migrations.path });
  const migrated = migratedChanges(ctx);
  const explained = (path: string, change: PathChange) => change.from !== undefined && change.to !== undefined && migrated.has(`${path} ${change.from} ${change.to}`);
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    const changes = history.changes.get(candidate.path) ?? [];
    const added = addIndex(changes);
    const later = added < 0 ? [] : changes.slice(added + 1).filter((change, offset) => isEdit(changes, added + 1 + offset) && !explained(candidate.path, change));
    const reasons: string[] = [];
    if (changes.length && added < 0) reasons.push("history has no commit that added it");
    if (later.length) reasons.push(`edited in ${later.length} commit${later.length === 1 ? "" : "s"} after the commit that added it (${changes[added]?.commit.slice(0, 9) ?? "?"}); latest ${later[later.length - 1]!.commit.slice(0, 9)}`);
    if (history.dirty.has(candidate.path)) reasons.push("has uncommitted edits");
    const ledger = ledgerReason(slot, candidate);
    if (ledger) reasons.push(ledger);
    if (reasons.length) rows.push(row("R08", "R08.2", slot, reasons.join("; "), candidate.path, candidate.name));
  }
  return rows;
}

/** The change that added the path: the last side-line (non-merge) `A`, else the last merge `A` (a merge-only file). */
export function addIndex(changes: readonly PathChange[]): number {
  for (let i = changes.length - 1; i >= 0; i--) if (changes[i]!.status === "A" && !changes[i]!.merge) return i;
  for (let i = changes.length - 1; i >= 0; i--) if (changes[i]!.status === "A") return i;
  return -1;
}

/**
 * Whether the change at `index` (after the add) edits the bytes: a side-line M/T always does; a merge
 * change does unless it only carries in a byte state an earlier change already had (its `to` blob is
 * an earlier change's `to`). A merge change without blob ids counts.
 */
export function isEdit(changes: readonly PathChange[], index: number): boolean {
  const change = changes[index]!;
  if (!change.merge) return change.status === "M" || change.status === "T";
  if (change.status === "D") return false;
  return change.to === undefined || !changes.slice(0, index).some(earlier => earlier.to === change.to);
}

/** Why the candidate's bytes do not match its slot ledger's submit event, or undefined when they do. */
function ledgerReason(slot: SlotRecord, candidate: CandidateRecord): string | undefined {
  if (!slot.ledger) return "the slot has no ledger.json, so no submit event proves its bytes";
  if (slot.ledger.error !== undefined) return `the slot ledger is unreadable (${slot.ledger.error}), so no submit event proves its bytes`;
  const events = ledgerEventsOf(slot.ledger.value);
  if (!events) return "the slot ledger is not {schema, events}, so no submit event proves its bytes";
  const expected = expectedCandidateSha(events, candidate.name);
  if (!expected.submitted) return "the slot ledger has no submit event for it";
  if (expected.sha256 !== candidate.sha256) return `sha256 ${candidate.sha256.slice(0, 12)} differs from its submit event's ${String(expected.sha256).slice(0, 12)}`;
  return undefined;
}

export const R08: RuleModule = {
  rule: "R08",
  checks: {
    "R08.1": naming,
    "R08.2": editedInPlace,
    "R08.3": pending("R08", "R08.3", "W2-B", "variants ride the vary tag; a stem never carries a variant"),
  },
};
