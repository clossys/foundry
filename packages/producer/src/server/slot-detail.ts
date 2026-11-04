/** Detail-only projection. Slot metadata, candidates and pins have one reader. */
import { join } from "node:path";
import { recordSpecimenInput, type RecordSpecimenInput } from "./slot-gallery.js";
import { hasSlotModel, inspectSlot, listSlots, pinHistory, readCandidate, readIa, readiness, slotIndex, usedByPlaced } from "../records/slots.js";
import { CANDIDATE_NAME, parseFrontmatter, validateCandidate, type SlotAgent } from "../records/slot-model/index.js";

export interface DetailCandidate {
  name: string; version: number; sha256: string; pinned: boolean;
  content: string; source: unknown; issues: string[];
  specimen?: string;
  /** A Director brief or Writer strings pin, as the specimen section's record rows (rendered inline, no frame). */
  record?: RecordSpecimenInput;
}
export interface SlotDetail {
  agent: SlotAgent; id: string; kind: string; trail: string[];
  contract: Readonly<Record<string, unknown>>; inputs: readonly string[]; uses: readonly string[];
  usedBy: { agent: SlotAgent; id: string }[];
  links: { agent: SlotAgent; id: string }[];
  candidates: DetailCandidate[]; shown?: string;
  pin: ReturnType<typeof listSlots>[number]["pin"];
  history: ReturnType<typeof pinHistory>;
  checks: { label: string; ok: boolean; detail: string }[];
}

/** Undefined means no such IA slot; an empty IA slot still returns a full detail. */
export function slotDetail(root: string, agent: SlotAgent, id: string): SlotDetail | undefined {
  const consumer = join(root, "clossys");
  if (!hasSlotModel(consumer)) return undefined;
  const entry = listSlots(consumer, agent).find(slot => slot.id === id);
  if (!entry) return undefined;
  // A schema-valid document that is not the one its IA position names keeps an honest detail:
  // no preview, no readiness clearance, and a failing placement check.
  const { doc, placed } = inspectSlot(consumer, agent, id);
  const index = slotIndex(consumer);
  const candidates = entry.candidates.map(name => {
    const candidate = readCandidate(consumer, agent, id, name);
    let content = candidate.bytes, source: unknown;
    if (name.endsWith(".md")) {
      const parsed = parseFrontmatter(candidate.bytes);
      if (parsed.ok) { content = parsed.value.body; source = parsed.value.fields.source; }
    } else {
      try { source = JSON.parse(candidate.bytes).meta?.source; } catch { /* validation records malformed JSON */ }
    }
    const version = Number(CANDIDATE_NAME.exec(name)![2]);
    const issues = validateCandidate(doc.kind, id, name, candidate.bytes).map(issue => `${issue.code}: ${issue.message}`);
    const element = CANDIDATE_NAME.exec(name)![1]!;
    if (agent === "designer" && doc.kind === "element" && !issues.length) {
      const item = JSON.parse(candidate.bytes);
      if (item.name !== element || (item.meta?.element?.id !== undefined && item.meta.element.id !== element)
        || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== id)) issues.push("candidate-identity: element identity differs from the candidate name or slot");
    }
    let specimen: string | undefined;
    // The specimen source reads these same native bytes. Only the exact valid pin
    // grants a preview; legacy selections and installed artifacts are irrelevant.
    const validPin = placed && !issues.length && entry.pin?.candidate === name && entry.pin.sha256 === candidate.sha256;
    if (validPin && agent === "designer" && doc.kind === "element" && name.endsWith(".json")) {
      specimen = `${id}/${element}`;
    }
    const record = validPin && ((agent === "director" && doc.kind === "brief") || (agent === "writer" && doc.kind === "strings")) ? recordSpecimenInput(consumer, agent, id, name) : undefined;
    return { name, version, sha256: candidate.sha256,
      pinned: entry.pin?.candidate === name, content, source,
      ...(specimen ? { specimen } : {}), ...(record ? { record } : {}),
      issues };
  });
  const pinCandidate = candidates.find(candidate => candidate.pinned);
  const ia = readIa(consumer, agent)!;
  const node = ia.nodes.find(row => row.id === entry.position.l1);
  const group = node?.children.find(row => row.id === entry.position.l2);
  const refs = [...new Set([...doc.inputs, ...doc.uses])];
  const inputReadiness = placed ? readiness(consumer, agent, id, index) : { ready: false, blockedBy: [{ slot: id, reason: "invalid-slot" as const }] };
  return {
    agent, id, kind: doc.kind, trail: [node?.label, group?.label].filter((label): label is string => !!label),
    contract: doc.contract, inputs: doc.inputs, uses: doc.uses, usedBy: usedByPlaced(consumer, id),
    links: refs.flatMap(ref => { const target = index.get(ref); return target ? [{ agent: target.agent, id: ref }] : []; }),
    candidates, shown: (pinCandidate ?? candidates.at(-1))?.name, pin: entry.pin,
    history: pinHistory(consumer, agent, id),
    checks: [
      { label: "Candidate recorded", ok: candidates.length > 0, detail: `${candidates.length} candidates` },
      { label: "Pin names a recorded candidate", ok: !!pinCandidate, detail: entry.pin?.candidate ?? "No pin" },
      { label: "Pin matches candidate bytes", ok: !!pinCandidate && pinCandidate.sha256 === entry.pin?.sha256, detail: entry.pin ? (pinCandidate?.sha256 === entry.pin.sha256 ? entry.pin.sha256 : "Pin hash does not match candidate bytes") : "No pin" },
      ...candidates.map(candidate => ({ label: candidate.name, ok: !candidate.issues.length, detail: candidate.issues.join("; ") || "Candidate format valid" })),
      { label: "Slot record matches its IA position", ok: placed, detail: placed ? "Slot record matches its IA position" : "Slot record does not match its IA position" },
      { label: "Inputs ready", ok: inputReadiness.ready, detail: inputReadiness.ready ? "Inputs ready" : "Inputs blocked" },
      ...inputReadiness.blockedBy.map(({ slot, reason }) => ({ label: slot, ok: false, detail: reason })),
      ...refs.map(ref => ({ label: ref, ok: index.has(ref), detail: index.has(ref) ? "Slot reference resolves" : "Unknown slot reference" })),
    ],
  };
}
