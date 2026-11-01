import { reviewFixture, libraryFixture, at } from "../../../content/__fixtures__/review.js";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "../../../content/model.js";
import type { CopyField } from "../../../content/composition.js";
import type { CandidateStageEvidence, StageResult } from "../../../content/stage-engine.js";
import { createContentRevision } from "../../../content/revisions.js";
import { CONTENT_TREE } from "../../../content/taxonomy.js";
import { STAGE_STATUSES } from "../../../content/stages.js";

export const boardSlotIds = {
  site: "sl_boyi4ashca", admin: "sl_rkjigy5k5p", auth: "sl_wl546svpom", docs: "sl_2xv4y3uo7k",
} as const;

/** Four inventory slots with real snapshots; auth deliberately has no candidate. */
export function boardFixture(): ContentRegistry {
  const base = reviewFixture();
  const template = base.slots[0]!;
  const definitions = [
    [boardSlotIds.docs, "documents", "docs", "guide", "Guide slot", 0, "docs-main"],
    [boardSlotIds.auth, "websites", "auth", "sign-in", "Sign-in slot", 1, undefined],
    [boardSlotIds.admin, "websites", "admin", "workspace", "Workspace slot", 2, "admin-main"],
    [boardSlotIds.site, "websites", "site", "home", "Homepage slot", 3, "site-main"],
  ] as const;
  const slots: ContentSlot[] = definitions.map(([id, l1, l2, leaf, name, order, activeCandidateId]) => ({
    ...template, id, l1, l2, name, aliases: [`${l1}/${l2}/${leaf}`], position: { order, name: leaf },
    ...(activeCandidateId === undefined ? {} : { activeCandidateId }),
  }));
  // The base pointer must not survive the intentionally empty inventory slot.
  const empty = slots.find(slot => slot.id === boardSlotIds.auth)!;
  slots[slots.indexOf(empty)] = Object.fromEntries(Object.entries(empty).filter(([key]) => key !== "activeCandidateId")) as unknown as ContentSlot;
  const create = (id: string, slotId: ContentSlot["id"], name: string, active: boolean): ContentCandidate => {
    const { approval: _approval, ...template } = base.candidates[0]!;
    const content = {
      ...template.history[0]!.content, name,
      composition: { ...template.composition!, sections: template.composition!.sections.map(section => ({
        ...section, fields: [{ key: "heading", locale: "en", value: `${name} heading`, source: "writer" as const }],
      })) },
    };
    const snapshot = createContentRevision(content, "r1", at);
    return { ...template, ...content, id, slotId, state: active ? "active" : "draft", revision: "r1", history: [snapshot],
      ...(active ? { approval: { source: "owner" as const, by: "owner", at, revision: "r1" as const, digest: snapshot.digest } } : {}) };
  };
  const site = create("site-main", boardSlotIds.site, "Homepage approved", true);
  const updated = { ...site, name: "Homepage current" };
  const second = createContentRevision(updated, "r2", at);
  const current: ContentCandidate = { ...updated, revision: "r2", history: [...site.history, second], approval: { ...site.approval!, revision: "r2", digest: second.digest } };
  return { workspace: base.workspace, slots, candidates: [
    current,
    create("site-alternative", boardSlotIds.site, "Homepage alternative", false),
    create("admin-main", boardSlotIds.admin, "Workspace current", true),
    create("docs-main", boardSlotIds.docs, "Guide current", true),
  ] };
}

/** The UI copy has explicit Writer provenance and deliberately differs from model names. */
export function boardWriterCopy(registry: ContentRegistry): CopyField[] {
  const values: Record<string, string> = {
    "board.title": "Publishing workspace",
    "board.canvas": "Publishing content canvas",
    "board.instructions": "Browse the content stages.",
    "board.empty": "No content slots yet",
    "board.no-candidate": "Awaiting a candidate",
    "columns.slot": "Content slot", "columns.candidate": "Content candidate",
    "stages.define": "Definition", "stages.assemble": "Assembly", "stages.review": "Editorial review",
    "stages.approve": "Owner approval", "stages.publish": "Publication",
    "tree.websites": "Web experiences", "tree.websites.site": "Public website",
    "tree.websites.admin": "Administration", "tree.websites.auth": "Authentication",
    "tree.documents": "Written materials", "tree.documents.docs": "Documentation",
  };
  for (const node of CONTENT_TREE.nodes) {
    values[`tree.${node.id}`] ??= node.label;
    for (const child of node.children) values[`tree.${node.id}.${child.id}`] ??= child.label;
  }
  for (const status of STAGE_STATUSES) values[`statuses.${status}`] = `Stage: ${status}`;
  for (const slot of registry.slots) values[`slot.${slot.id}.name`] = `Writer: ${slot.name}`;
  for (const candidate of registry.candidates) values[`candidate.${candidate.id}.name`] = `Writer: ${candidate.name}`;
  return Object.entries(values).map(([key, value]) => ({ key, value, locale: "en", source: "writer" }));
}

export function boardEvidence(registry: ContentRegistry): CandidateStageEvidence[] {
  const done: StageResult = { status: "Done", findings: [] };
  return registry.candidates.map(candidate => ({
    candidateId: candidate.id, revision: candidate.revision, digest: candidate.history.at(-1)!.digest,
    words: candidate.id === "site-alternative" ? { status: "Needs input", findings: [{ path: "copy.heading", rule: "writer-source", message: "Writer must finish this alternative" }] } : done,
    visuals: done, assembly: done,
    review: candidate.id === "admin-main" ? { status: "Failing", findings: [{ path: "composition", rule: "review-reference", message: "Review found a broken reference" }] } : done,
    approval: done, release: done,
  }));
}

export const boardLibraries = libraryFixture;
