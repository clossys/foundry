import { writerLabel } from "./copy.js";
import { validateCopyFields } from "../composition.js";
import type { ContentCandidate, ContentSlot } from "../model.js";
import { computeStageReport } from "../stage-engine.js";
import type { CandidateStageEvidence, StageKey, StageReport } from "../stage-engine.js";
import { CONTENT_TREE, loadContentTree } from "../taxonomy.js";
import type { ContentTree } from "../taxonomy.js";
import { validateContentRegistry } from "../validate.js";
import type { PublisherBoardGroup, PublisherBoardInput, PublisherBoardLane, PublisherBoardModel, PublisherBoardNeed, PublisherBoardRow } from "./types.js";

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const placementKey = (l1: string, l2: string): string => JSON.stringify([l1, l2]);

/** Derive presentation from immutable identities, exact Writer copy and supplied proof. */
export function buildPublisherBoard(input: PublisherBoardInput): PublisherBoardModel {
  const needs: PublisherBoardNeed[] = [];
  const needKeys = new Set<string>();
  const need = (target: PublisherBoardNeed["target"], ref: string, detail: string): void => {
    const identity = JSON.stringify([target, ref]);
    if (!needKeys.has(identity)) { needKeys.add(identity); needs.push({ target, ref, detail }); }
  };

  let tree: ContentTree = CONTENT_TREE;
  if (input.tree !== undefined) {
    try { tree = loadContentTree(input.tree); }
    catch (error) {
      need("publisher", "tree", error instanceof Error ? error.message : "Supply a valid content tree");
      tree = { schemaVersion: 1, nodes: [] };
    }
  }
  const registryFindings = validateContentRegistry(input.registry, tree);
  for (const finding of registryFindings) {
    // Placement is also reported below with the immutable slot identity.
    if (finding.rule !== "placement") need("publisher", finding.path, `${finding.rule}: ${finding.message}`);
  }

  const fields = Array.isArray(input.copy) ? input.copy : [];
  const invalidCopy = new Set<string>();
  for (const finding of validateCopyFields(input.copy, "copy")) {
    const match = /^copy\[(\d+)\]/.exec(finding.path);
    const field = match ? fields[Number(match[1])] : undefined;
    const ref = typeof field?.key === "string" && field.key.trim() ? field.key : finding.path;
    if (field) invalidCopy.add(JSON.stringify([field.locale, field.key]));
    need("writer", ref, `${finding.rule}: ${finding.message}`);
  }
  const copyForLocale = new Map<string, typeof fields>();
  for (const field of fields) {
    if (field?.locale !== input.locale || typeof field.key !== "string") continue;
    copyForLocale.set(field.key, [...(copyForLocale.get(field.key) ?? []), field]);
  }
  const text = (key: string): string => {
    const matches = copyForLocale.get(key) ?? [];
    const field = matches[0];
    const value = matches.length === 1 && !invalidCopy.has(JSON.stringify([input.locale, key])) ? writerLabel(field, input.locale, input.copyResolver) : undefined;
    if (value === undefined) {
      need("writer", key, `Supply one nonempty Writer value for ${key} in locale ${input.locale}`);
      return "";
    }
    return value;
  };
  const labels: PublisherBoardModel["labels"] = {
    title: text("board.title"), canvas: text("board.canvas"), instructions: text("board.instructions"), empty: text("board.empty"),
    slot: text("columns.slot"), candidate: text("columns.candidate"),
    stages: { define: text("stages.define"), assemble: text("stages.assemble"), review: text("stages.review"), approve: text("stages.approve"), publish: text("stages.publish") },
  };

  const candidates = Array.isArray(input.registry?.candidates) ? input.registry.candidates : [];
  const slots = Array.isArray(input.registry?.slots) ? input.registry.slots : [];
  const candidateIds = new Set(candidates.map(candidate => candidate?.id));
  const evidenceById = new Map<string, CandidateStageEvidence[]>();
  for (const evidence of input.evidence ?? []) {
    const id = evidence?.candidateId;
    if (typeof id !== "string" || !candidateIds.has(id)) {
      need("publisher", `evidence.${id ?? "unknown"}`, "Supply evidence for an existing candidate identity");
      continue;
    }
    evidenceById.set(id, [...(evidenceById.get(id) ?? []), evidence]);
  }
  for (const [id, proofs] of evidenceById) if (proofs.length > 1) {
    need("publisher", `evidence.${id}`, "Supply exactly one evidence record for this candidate");
  }

  const reports = new Map<ContentCandidate, StageReport | null>();
  for (const candidate of candidates) {
    const proofs = evidenceById.get(candidate?.id) ?? [];
    try { reports.set(candidate, computeStageReport(candidate, proofs.length === 1 ? proofs[0] : undefined)); }
    catch (error) {
      need("publisher", `candidate.${candidate?.id ?? "unknown"}`, error instanceof Error ? error.message : "Supply a candidate identity and pinned revision");
      reports.set(candidate, null);
    }
  }

  const row = (slot: ContentSlot, candidate: ContentCandidate | null): PublisherBoardRow => {
    const report = candidate ? reports.get(candidate) ?? null : null;
    const candidateLabel = text(candidate ? `candidate.${candidate.id}.name` : "board.no-candidate");
    const cell = (stage: StageKey): PublisherBoardRow["cells"][StageKey] => {
      const status = report?.stages[stage].status ?? null;
      return { status, label: status === null ? candidate ? "" : text("board.no-candidate") : text(`statuses.${status}`) };
    };
    return {
      id: JSON.stringify([slot.id, candidate?.id ?? null]), slotId: slot.id, candidateId: candidate?.id ?? null,
      slotLabel: text(`slot.${slot.id}.name`), candidateLabel, revision: candidate?.revision ?? null,
      active: candidate !== null && slot.activeCandidateId === candidate.id && candidate.state === "active", report,
      cells: { define: cell("define"), assemble: cell("assemble"), review: cell("review"), approve: cell("approve"), publish: cell("publish") },
    };
  };

  const placements = new Map<string, { l1: string; l2: string; slots: ContentSlot[] }>();
  for (const slot of slots) {
    if (!slot || typeof slot.id !== "string" || typeof slot.l1 !== "string" || typeof slot.l2 !== "string") continue;
    const key = placementKey(slot.l1, slot.l2);
    const placement: { l1: string; l2: string; slots: ContentSlot[] } = placements.get(key) ?? { l1: slot.l1, l2: slot.l2, slots: [] };
    placement.slots.push(slot);
    placements.set(key, placement);
    if (!tree.nodes.some(node => node.id === slot.l1 && node.children.some(child => child.id === slot.l2))) {
      need("publisher", `slot.${slot.id}.placement`, "Place this slot in a declared content tree group");
    }
  }
  const group = (l1: string, l2: string): PublisherBoardGroup | undefined => {
    const key = placementKey(l1, l2);
    const placement = placements.get(key);
    if (!placement) return undefined;
    placements.delete(key);
    const ordered = [...placement.slots].sort((left, right) => (left.position?.order ?? 0) - (right.position?.order ?? 0) || compare(left.id, right.id));
    const rows = ordered.flatMap(slot => {
      const matches = candidates.filter(candidate => candidate?.slotId === slot.id).sort((left, right) => compare(left.id, right.id));
      return matches.length ? matches.map(candidate => row(slot, candidate)) : [row(slot, null)];
    });
    return { id: key, l2, label: text(`tree.${l1}.${l2}`), rows };
  };
  const lanes: PublisherBoardLane[] = [];
  for (const node of tree.nodes) {
    const groups = node.children.flatMap(child => {
      const value = group(node.id, child.id);
      return value ? [value] : [];
    });
    if (groups.length) lanes.push({ id: node.id, label: text(`tree.${node.id}`), groups });
  }
  // Keep unresolved placements inspectable while the host explains their Needs.
  const unresolved = [...placements.values()].sort((left, right) => compare(left.l1, right.l1) || compare(left.l2, right.l2));
  for (const placement of unresolved) {
    const value = group(placement.l1, placement.l2)!;
    const existingIndex = lanes.findIndex(lane => lane.id === placement.l1);
    if (existingIndex >= 0) {
      const lane = lanes[existingIndex]!;
      lanes[existingIndex] = { ...lane, groups: [...lane.groups, value] };
    } else lanes.push({ id: placement.l1, label: text(`tree.${placement.l1}`), groups: [value] });
  }
  return { locale: input.locale, ready: needs.length === 0, needs, labels, lanes };
}
