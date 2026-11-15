/**
 * Copy is derived, never hand-authored (writer.md 2 Copy, 9.4.3). One `<unit>.copy` slot per live Designer unit in
 * the 58-unit target list that declares `contract.copy.fields`; L1 by Designer layer, L2 = the unit's Designer L2,
 * mark inherited, fields projected with a sha256 digest. A target unit with no fields yet is an awaiting leaf: placed
 * and frozen, not a slot, until the Designer line declares fields (request up the chain).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AwaitingLeaf, GroupL1, GroupSlot, GroupTree, WriterMark, WriterRef, WriterTreeFinding } from "../catalog/ia/target.js";

export const COPY_TARGET_UNITS = [
  "components.command", "components.breadcrumbs", "components.sidebar", "components.media-player", "components.dialog", "components.sheet",
  "sections.section-header", "sections.pagination", "sections.table-of-contents",
  "sections.hero", "sections.page-header", "sections.features", "sections.pricing", "sections.call-to-action", "sections.testimonials", "sections.logo-cloud", "sections.people",
  "sections.content", "sections.article", "sections.sectioned-document", "sections.media", "sections.gallery", "sections.faq", "sections.steps", "sections.timeline",
  "sections.link-index", "sections.resource-list", "sections.task-list", "sections.data-table", "sections.data-grid", "sections.stats", "sections.usage", "sections.account-summary",
  "sections.comparison", "sections.status-list", "sections.activity-feed", "sections.audit-log", "sections.explorer", "sections.filter-builder",
  "sections.form", "sections.sign-in-form", "sections.wizard", "sections.chat", "sections.settings", "sections.access-matrix", "sections.column-mapper",
  "sections.empty-state", "sections.error-state", "sections.notices", "sections.consent",
  "frames.site-header", "frames.site-footer", "frames.app-header", "frames.app-sidebar",
  "assets.lockup", "assets.mark", "assets.image", "assets.video",
] as const;

const DESIGNER_LAYERS = ["components", "sections", "frames", "assets"] as const;
type DesignerLayer = (typeof DESIGNER_LAYERS)[number];
const COPY_L1: Readonly<Record<DesignerLayer, { id: string; label: string }>> = {
  components: { id: "copy/component-text", label: "Component text" },
  sections: { id: "copy/section-copy", label: "Section copy" },
  frames: { id: "copy/frame-copy", label: "Frame copy" },
  assets: { id: "copy/asset-text", label: "Asset text" },
};
const FIELD_KEYS = ["key", "kind", "role", "required", "maxLength", "dir"] as const;
const VOICE_INPUTS = ["formality", "warmth", "energy", "person", "mood", "sentence-length", "reading-level", "capitalization", "punctuation", "preferred-terms", "avoid-terms", "avoid-patterns"]
  .map((name): WriterRef => ({ to: `writer/lexicon.${name}`, rel: "input" }));
const DIRECTOR_INPUTS: WriterRef[] = [
  { to: "director/advantage.proposition.promise", key: "Promise" },
  { to: "director/advantage.proposition.proof", key: "Proof" },
  { to: "director/advantage.proposition.proof", key: "Never-claim" },
  { to: "director/identity.naming.name", key: "Name" },
];

export interface DesignerCopyField { key: string; kind: string; role: string; required: boolean; maxLength: Record<string, number>; dir: string }
export interface DesignerSlot { id: string; layer?: string; contract?: { copy?: { sourceLocale?: string; fields?: DesignerCopyField[] }; [key: string]: unknown } }
export interface DesignerPlacement {
  layer: DesignerLayer;
  nodes: { id: string; label: string; children: { id: string; label: string; leaves: string[] }[] }[];
  starter: string[];
  parked?: string[];
  retired: string[];
}
export interface DesignerCopyInput { placements: DesignerPlacement[]; slots: DesignerSlot[]; retired: Set<string> }

/** Reads the Designer catalog from the sibling package source (the same URL works from src/ and dist/). */
export function loadDesignerCopyInput(root: URL = new URL("../../../designer/src/catalog/", import.meta.url)): DesignerCopyInput {
  const read = (path: string): any => JSON.parse(readFileSync(new URL(path, root), "utf8"));
  const placements = DESIGNER_LAYERS.map(layer => read(`ia/${layer}.json`) as DesignerPlacement);
  const slots = DESIGNER_LAYERS.flatMap(layer => read(`slots/${layer}.json`) as DesignerSlot[]);
  return { placements, slots, retired: new Set(placements.flatMap(placement => placement.retired ?? [])) };
}

const projectFields = (fields: readonly DesignerCopyField[]): DesignerCopyField[] =>
  fields.map(field => Object.fromEntries(FIELD_KEYS.filter(key => key in field).map(key => [key, structuredClone(field[key])])) as unknown as DesignerCopyField);
export const fieldsSha256 = (fields: readonly DesignerCopyField[]): string => createHash("sha256").update(JSON.stringify(projectFields(fields))).digest("hex");

function locate(input: DesignerCopyInput, unit: string) {
  for (const placement of input.placements) {
    for (const l1 of placement.nodes) {
      for (const l2 of l1.children) {
        if (!l2.leaves.includes(unit)) continue;
        const mark: WriterMark = placement.starter.includes(unit) ? "starter" : (placement.parked ?? []).includes(unit) ? "parked" : "other-live";
        return { layer: placement.layer, l2, mark };
      }
    }
  }
  return undefined;
}

export function deriveCopyTree(input: DesignerCopyInput): GroupTree {
  const nodes: GroupL1[] = [], slots: GroupSlot[] = [], awaiting: AwaitingLeaf[] = [];
  const bySlot = new Map(input.slots.map(slot => [slot.id, slot]));
  for (const unit of COPY_TARGET_UNITS) {
    const where = locate(input, unit);
    if (!where) throw new Error(`Writer derive: Designer does not place ${unit}`);
    const head = COPY_L1[where.layer];
    let l1 = nodes.find(node => node.id === head.id);
    if (!l1) { l1 = { id: head.id, label: head.label, children: [] }; nodes.push(l1); }
    const l2Id = `${head.id}/${where.l2.id.split("-").slice(1).join("-")}`;
    let l2 = l1.children.find(node => node.id === l2Id);
    if (!l2) { l2 = { id: l2Id, label: where.l2.label, leaves: [] }; l1.children.push(l2); }
    const id = `${unit}.copy`;
    l2.leaves.push(id);
    const copy = bySlot.get(unit)?.contract?.copy;
    const fields = copy?.fields ?? [];
    if (input.retired.has(unit)) { awaiting.push({ id, unit: `designer/${unit}`, mark: where.mark, reason: "Designer unit is retired" }); continue; }
    if (!fields.length) { awaiting.push({ id, unit: `designer/${unit}`, mark: where.mark, reason: "Designer unit declares no copy.fields yet" }); continue; }
    slots.push({
      id, kind: "copy", mark: where.mark, inputs: [...VOICE_INPUTS, ...DIRECTOR_INPUTS].map(ref => ({ ...ref })),
      contract: {
        unit: `designer/${unit}`,
        copy: { sourceLocale: copy?.sourceLocale ?? "en", fields: projectFields(fields) },
        fieldsSha256: fieldsSha256(fields),
        candidate: "clossys.copy-candidate/1",
      },
    });
  }
  return { schema: "clossys.writer-ia/1", group: "copy", label: "Copy", nodes, slots, awaiting };
}

/** Both directions: every live Designer unit with copy fields has exactly one Copy slot, and every Copy slot has fields. */
export function checkCopyAgainstDesigner(tree: GroupTree, input: DesignerCopyInput): WriterTreeFinding[] {
  const findings: WriterTreeFinding[] = [];
  const fail = (message: string) => { findings.push({ code: "COPY", group: "copy", message: `COPY: ${message}` }); };
  const bySlot = new Map(input.slots.map(slot => [slot.id, slot]));
  const unitOf = (slot: GroupSlot) => String(slot.contract?.unit ?? "").replace(/^designer\//, "");
  for (const slot of tree.slots) {
    const unit = unitOf(slot);
    const fields = bySlot.get(unit)?.contract?.copy?.fields ?? [];
    if (slot.id !== `${unit}.copy`) fail(`${slot.id} names unit designer/${unit}; the slot id must be <unit>.copy`);
    if (input.retired.has(unit)) fail(`${slot.id} is a Copy slot for retired Designer unit ${unit}`);
    else if (!fields.length) fail(`${slot.id} is a Copy slot with no Designer copy field (designer/${unit})`);
    else if (slot.contract?.fieldsSha256 !== fieldsSha256(fields) || JSON.stringify(slot.contract?.copy?.fields) !== JSON.stringify(projectFields(fields))) {
      fail(`${slot.id} is stale against designer/${unit} copy.fields; run the Copy derive`);
    }
  }
  for (const slot of input.slots) {
    if (input.retired.has(slot.id) || !(slot.contract?.copy?.fields?.length)) continue;
    const count = tree.slots.filter(entry => unitOf(entry) === slot.id).length;
    if (count !== 1) fail(`designer/${slot.id} declares copy fields and has ${count} Copy slots`);
  }
  for (const leaf of tree.awaiting ?? []) {
    const unit = leaf.unit.replace(/^designer\//, "");
    if (!input.retired.has(unit) && (bySlot.get(unit)?.contract?.copy?.fields?.length ?? 0) > 0) fail(`${leaf.id} awaits fields, but designer/${unit} now declares them; run the Copy derive`);
  }
  let expected: GroupTree | undefined;
  try { expected = deriveCopyTree(input); } catch (error) { fail((error as Error).message); }
  if (expected && JSON.stringify(expected) !== JSON.stringify(tree)) fail("copy.json is not the derivation of the current Designer catalog; run the Copy derive");
  return findings;
}
