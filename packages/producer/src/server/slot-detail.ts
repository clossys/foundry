/** Detail-only projection. Slot metadata, candidates and pins have one reader. */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { hasSlotModel, listSlots, pinHistory, readCandidate, readIa, readSlot, slotIndex, usedBy } from "../records/slots.js";
import { CANDIDATE_NAME, parseFrontmatter, validateCandidate, type SlotAgent } from "../records/slot-model/index.js";

export interface DetailCandidate {
  name: string; version: number; sha256: string; pinned: boolean;
  content: string; source: unknown; issues: string[];
  specimen?: string;
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
  const doc = readSlot(consumer, agent, id);
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
    let specimen: string | undefined;
    // The existing specimen substrate renders library artifacts. Use it only
    // when the candidate's actual registry payload matches that artifact.
    if (agent === "designer" && name.endsWith(".json")) {
      const element = CANDIDATE_NAME.exec(name)![1]!;
      for (const file of ["registry-item.json", `${element}.json`]) {
        try {
          const { meta: _candidateMeta, ...payload } = JSON.parse(candidate.bytes);
          const { meta: _libraryMeta, ...installed } = JSON.parse(readFileSync(join(consumer, "library", id, element, `v${version}`, file), "utf8"));
          if (isDeepStrictEqual(payload, installed)) specimen = `${id}/${element}`;
        } catch { /* No matching render artifact: keep the candidate's content visible. */ }
      }
    }
    return { name, version, sha256: candidate.sha256,
      pinned: entry.pin?.candidate === name, content, source,
      ...(specimen ? { specimen } : {}),
      issues: validateCandidate(doc.kind, id, name, candidate.bytes).map(issue => `${issue.code}: ${issue.message}`) };
  });
  const pinCandidate = candidates.find(candidate => candidate.pinned);
  const ia = readIa(consumer, agent)!;
  const node = ia.nodes.find(row => row.id === entry.position.l1);
  const group = node?.children.find(row => row.id === entry.position.l2);
  const refs = [...new Set([...doc.inputs, ...doc.uses])];
  return {
    agent, id, kind: doc.kind, trail: [node?.label, group?.label].filter((label): label is string => !!label),
    contract: doc.contract, inputs: doc.inputs, uses: doc.uses, usedBy: usedBy(consumer, id),
    links: refs.flatMap(ref => { const target = index.get(ref); return target ? [{ agent: target.agent, id: ref }] : []; }),
    candidates, shown: (pinCandidate ?? candidates.at(-1))?.name, pin: entry.pin,
    history: pinHistory(consumer, agent, id),
    checks: [
      { label: "Candidate recorded", ok: candidates.length > 0, detail: `${candidates.length} candidates` },
      { label: "Pin names a recorded candidate", ok: !!pinCandidate, detail: entry.pin?.candidate ?? "No pin" },
      { label: "Pin matches candidate bytes", ok: !!pinCandidate && pinCandidate.sha256 === entry.pin?.sha256, detail: entry.pin ? (pinCandidate?.sha256 === entry.pin.sha256 ? entry.pin.sha256 : "Pin hash does not match candidate bytes") : "No pin" },
      ...candidates.map(candidate => ({ label: candidate.name, ok: !candidate.issues.length, detail: candidate.issues.join("; ") || "Candidate format valid" })),
      ...refs.map(ref => ({ label: ref, ok: index.has(ref), detail: index.has(ref) ? "Slot reference resolves" : "Unknown slot reference" })),
    ],
  };
}
