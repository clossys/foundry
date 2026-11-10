/** Detail-only projection. Slot metadata, candidates and pins have one reader. */
import { join } from "node:path";
import { copyRef, type CopyRef, type CopyText } from "./copy-ref.js";
import { iaLabel, slotLabel } from "../records/slot-labels.js";
import { cardState, recordSpecimenInput, type RecordSpecimenInput, type SlotCardState } from "./slot-gallery.js";
import { hasSlotModel, inspectSlot, listSlots, pinHistory, readSlotEntry, readCandidate, readIa, readiness, slotIndex, usedByPlaced, type BlockReason } from "../records/slots.js";
import { CANDIDATE_NAME, parseFrontmatter, pinStatus, validateCandidate, type PinStatus, type SlotAgent, type SlotModelIssue } from "../records/slot-model/index.js";
import { parseJson } from "../errors.js";
import { specimenPreviewIssue } from "../specimen/library-source.js";
import { pinnedWriterCopy } from "./specimen-tree.js";

export interface DetailCandidate {
  name: string; version: number; sha256: string; pinned: boolean;
  content: string; source: unknown;
  /** Each validator finding as a Writer copy reference; the validator's own message is data. */
  issues: CopyRef[];
  specimen?: string;
  /** A Director brief or Writer strings candidate, as the specimen section's record rows (rendered inline, no frame). */
  record?: RecordSpecimenInput;
  /**
   * True for every candidate that is not the valid pin: it renders from its own bytes for review,
   * and no page uses it (pages install pins only).
   */
  preview: boolean;
}
export interface SlotDetail {
  agent: SlotAgent; id: string; kind: string; trail: string[];
  /** The slot's display label, from the one label resolver (src/records/slot-labels.ts). */
  name: string;
  contract: Readonly<Record<string, unknown>>; inputs: readonly string[]; uses: readonly string[];
  usedBy: { agent: SlotAgent; id: string }[];
  links: { agent: SlotAgent; id: string }[];
  candidates: DetailCandidate[]; shown?: string;
  pin: ReturnType<typeof listSlots>[number]["pin"];
  /** The pin's review status: `confirm` when its basis is bulk or planner. Absent without a pin. */
  status?: PinStatus;
  /** The loader's slot state: pinned, not-needed, or rejected (an error state). */
  state: SlotCardState;
  history: ReturnType<typeof pinHistory>;
  /** Each check names its words by Writer copy key; ids, candidate names and issues stay data. */
  checks: { label: CopyText; ok: boolean; detail: CopyText }[];
}

/** The Writer key that says why an input blocks a slot: every reason has words (type-enforced). */
const BLOCK_COPY: Record<BlockReason, string> = {
  "inputs-undeclared": "studio.check-block-inputs-undeclared",
  missing: "studio.missing",
  unpinned: "studio.unpinned",
  "invalid-pin": "studio.check-block-invalid-pin",
  "missing-candidate": "studio.check-block-missing-candidate",
  "hash-drift": "studio.check-pin-hash-mismatch",
  "invalid-candidate": "studio.error.candidate-invalid",
  "invalid-slot": "studio.check-block-invalid-slot",
};
const blockCopy = (reason: BlockReason) => copyRef(BLOCK_COPY[reason]);

/** The codes validateCandidate emits. */
export type CandidateIssueCode = Extract<SlotModelIssue["code"], `candidate-${string}`>;
/** One Writer key per candidate validator code; the validator's message is the `{message}` value. */
export const CANDIDATE_ISSUE_COPY: Record<CandidateIssueCode, string> = {
  "candidate-name": "studio.candidate-issue.candidate-name",
  "candidate-invalid": "studio.candidate-issue.candidate-invalid",
  "candidate-source": "studio.candidate-issue.candidate-source",
  "candidate-status": "studio.candidate-issue.candidate-status",
};
const issueCopy = (issue: SlotModelIssue): CopyRef => {
  const key = (CANDIDATE_ISSUE_COPY as Partial<Record<string, string>>)[issue.code];
  if (!key) throw new Error(`candidate validator code ${issue.code} has no Writer key`);
  return copyRef(key, { message: issue.message });
};

/** Undefined means no such IA slot; an empty IA slot still returns a full detail. */
export function slotDetail(root: string, agent: SlotAgent, id: string): SlotDetail | undefined {
  const consumer = join(root, "clossys");
  if (!hasSlotModel(consumer)) return undefined;
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return undefined;
  // A schema-valid document that is not the one its IA position names keeps an honest detail:
  // no preview, no readiness clearance, and a failing placement check.
  const { doc, placed } = inspectSlot(consumer, agent, id);
  const index = slotIndex(consumer);
  // One pinned Writer scan per detail, shared by every candidate's preview check.
  let writerCopy: Readonly<Record<string, string>> | undefined;
  const writer = () => writerCopy ??= pinnedWriterCopy(consumer);
  const candidates = entry.candidates.map(name => {
    const candidate = readCandidate(consumer, agent, id, name);
    let content = candidate.bytes, source: unknown;
    if (name.endsWith(".md")) {
      const parsed = parseFrontmatter(candidate.bytes);
      if (parsed.ok) { content = parsed.value.body; source = parsed.value.fields.source; }
    } else {
      // Malformed JSON has no source; validateCandidate below records it as an issue.
      const parsed = parseJson(candidate.bytes);
      if (parsed.ok) source = (parsed.value as { meta?: { source?: unknown } } | null)?.meta?.source;
    }
    const version = Number(CANDIDATE_NAME.exec(name)![2]);
    const issues = validateCandidate(doc.kind, id, name, candidate.bytes).map(issueCopy);
    const element = CANDIDATE_NAME.exec(name)![1]!;
    if (agent === "designer" && doc.kind === "element" && !issues.length) {
      const item = JSON.parse(candidate.bytes);
      if (item.name !== element || (item.meta?.element?.id !== undefined && item.meta.element.id !== element)
        || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== id)) issues.push(copyRef("studio.check-candidate-identity"));
    }
    // Every placed, valid candidate renders from its own native bytes (the specimen route takes the
    // slot and the candidate). Only the exact valid pin is the pin; every other one is a preview.
    const validPin = placed && !issues.length && entry.pin?.candidate === name && entry.pin.sha256 === candidate.sha256;
    // A pinned candidate whose bytes drifted from its pin renders nothing: the pin check flags it.
    const renders = placed && !issues.length && (entry.pin?.candidate !== name || validPin);
    // A candidate whose preview inputs the specimen build refuses has no specimen to frame (the route answers 404 for it).
    const specimen = renders && agent === "designer" && doc.kind === "element" && name.endsWith(".json") && !specimenPreviewIssue(consumer, id, name, candidate.bytes, writer) ? `${id}/${element}` : undefined;
    const record = renders && ((agent === "director" && doc.kind === "brief") || (agent === "writer" && doc.kind === "strings")) ? recordSpecimenInput(consumer, agent, id, name) : undefined;
    return { name, version, sha256: candidate.sha256,
      pinned: entry.pin?.candidate === name, content, source,
      ...(specimen ? { specimen } : {}), ...(record ? { record } : {}),
      preview: !validPin, issues };
  });
  const pinCandidate = candidates.find(candidate => candidate.pinned);
  const ia = readIa(consumer, agent)!;
  const node = ia.nodes.find(row => row.id === entry.position.l1);
  const group = node?.children.find(row => row.id === entry.position.l2);
  const refs = [...new Set([...doc.inputs, ...doc.uses])];
  const inputReadiness = placed ? readiness(consumer, agent, id, index) : { ready: false, blockedBy: [{ slot: id, reason: "invalid-slot" as const }] };
  return {
    agent, id, name: slotLabel(consumer, agent, id), kind: doc.kind, trail: [node, group].flatMap(row => row ? [iaLabel(consumer, agent, row.id)] : []),
    contract: doc.contract, inputs: doc.inputs, uses: doc.uses, usedBy: usedByPlaced(consumer, id),
    links: refs.flatMap(ref => { const target = index.get(ref); return target ? [{ agent: target.agent, id: ref }] : []; }),
    candidates, shown: (pinCandidate ?? candidates.at(-1))?.name, pin: entry.pin, ...(entry.pin ? { status: pinStatus(entry.pin.basis) } : {}), state: cardState(entry),
    history: pinHistory(consumer, agent, id),
    checks: [
      { label: copyRef("studio.check-candidate-recorded"), ok: candidates.length > 0, detail: copyRef("studio.check-candidate-count", { count: candidates.length }) },
      { label: copyRef("studio.check-pin-names-candidate"), ok: !!pinCandidate, detail: entry.pin?.candidate ?? copyRef("studio.no-pin") },
      { label: copyRef("studio.check-pin-matches"), ok: !!pinCandidate && pinCandidate.sha256 === entry.pin?.sha256, detail: entry.pin ? (pinCandidate?.sha256 === entry.pin.sha256 ? entry.pin.sha256 : copyRef("studio.check-pin-hash-mismatch")) : copyRef("studio.no-pin") },
      ...candidates.flatMap(candidate => candidate.issues.length
        ? candidate.issues.map(issue => ({ label: candidate.name, ok: false, detail: issue }))
        : [{ label: candidate.name, ok: true, detail: copyRef("studio.check-candidate-format-valid") }]),
      { label: copyRef("studio.check-slot-placed"), ok: placed, detail: placed ? copyRef("studio.check-slot-placed") : copyRef("studio.check-slot-misplaced") },
      { label: copyRef("studio.check-inputs-ready"), ok: inputReadiness.ready, detail: inputReadiness.ready ? copyRef("studio.check-inputs-ready") : copyRef("studio.check-inputs-blocked") },
      ...inputReadiness.blockedBy.map(({ slot, reason }) => ({ label: slot, ok: false, detail: blockCopy(reason) })),
      ...refs.map(ref => ({ label: ref, ok: index.has(ref), detail: index.has(ref) ? copyRef("studio.check-reference-resolves") : copyRef("studio.check-reference-unknown") })),
    ],
  };
}
