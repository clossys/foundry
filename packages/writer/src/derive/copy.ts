/**
 * Copy is derived, never hand-authored (writer.md 2 Copy, 9.4.3). One `<unit>.copy` slot per live Designer unit in
 * the Copy leaf freeze (copyTargetUnits) that declares `contract.copy.fields`; L1 by Designer layer, L2 = the unit's Designer L2,
 * mark inherited, fields projected with a sha256 digest. A target unit with no fields yet is an awaiting leaf: placed
 * and frozen, not a slot, until the Designer line declares fields (request up the chain).
 *
 * Page metadata (writer.md 2 Copy, last row; foundry-build-0033) is derived from the Publisher directory: one L2 per
 * live publication, holding `publication.<id>.meta` (site name, default share) and one `page.<id>.meta` (title,
 * description, share) per live page whose `records.meta` names it. A parked publication or page has no meta slot.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AwaitingLeaf, GroupL1, GroupSlot, GroupTree, WriterMark, WriterRef, WriterTreeFinding } from "../catalog/ia/target.js";

const DESIGNER_LAYERS = ["components", "sections", "frames", "assets"] as const;

/**
 * The Designer units Copy holds, in order: the Designer-unit leaves of the Copy leaf freeze (its `leafIds`, then each
 * amendment's removes and adds), each `<unit>.copy`. Membership is the freeze's data (a new unit is a recorded
 * amendment, a SLOT-CREATE request answered by Writer), never a list in this module; the rest is Designer data.
 */
export function copyTargetUnits(freeze: { leafIds: readonly string[]; amendments?: readonly { remove?: readonly string[]; add?: readonly string[] }[] }): string[] {
  const ids = [...freeze.leafIds];
  for (const amendment of freeze.amendments ?? []) {
    for (const id of amendment.remove ?? []) { const at = ids.indexOf(id); if (at >= 0) ids.splice(at, 1); }
    for (const id of amendment.add ?? []) if (!ids.includes(id)) ids.push(id);
  }
  const layer = new RegExp(`^(?:${DESIGNER_LAYERS.join("|")})\\.`);
  return ids.filter(id => id.endsWith(".copy") && layer.test(id)).map(id => id.slice(0, -".copy".length));
}
const COPY_FREEZE = new URL("../../src/catalog/ia/copy.leaf-freeze.json", import.meta.url);
/** The shipped Copy freeze's Designer units (copyTargetUnits over `src/catalog/ia/copy.leaf-freeze.json`). */
export const COPY_TARGET_UNITS: readonly string[] = Object.freeze(copyTargetUnits(JSON.parse(readFileSync(COPY_FREEZE, "utf8"))));

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
/** The Publisher directory, as far as Page metadata reads it (`@clossys/publisher`). */
export interface PublisherPage { kind: string; publication: string; parked?: boolean; records?: { meta?: string; [key: string]: unknown } }
export interface PublisherDirectory {
  nodes: { id: string; label: string; parked?: boolean; children: { id: string; label: string; publication: string; parked?: boolean; leaves: string[] }[] }[];
  slots: Record<string, PublisherPage>;
}
export interface DesignerCopyInput { placements: DesignerPlacement[]; slots: DesignerSlot[]; retired: Set<string>; directory: PublisherDirectory }

/** Reads the Designer catalog and the Publisher directory from the sibling package sources (the same URLs work from src/ and dist/). */
export function loadDesignerCopyInput(
  root: URL = new URL("../../../designer/src/catalog/", import.meta.url),
  publisher: URL = new URL("../../../publisher/src/catalog/ia/directory.json", import.meta.url),
): DesignerCopyInput {
  const read = (path: string): any => JSON.parse(readFileSync(new URL(path, root), "utf8"));
  const placements = DESIGNER_LAYERS.map(layer => read(`ia/${layer}.json`) as DesignerPlacement);
  const slots = DESIGNER_LAYERS.flatMap(layer => read(`slots/${layer}.json`) as DesignerSlot[]);
  const directory = JSON.parse(readFileSync(publisher, "utf8")) as PublisherDirectory;
  return { placements, slots, retired: new Set(placements.flatMap(placement => placement.retired ?? [])), directory };
}

const META_FIELDS = JSON.parse(readFileSync(new URL("../../src/derive/meta-fields.json", import.meta.url), "utf8")) as { page: DesignerCopyField[]; publication: DesignerCopyField[] };
/** Page metadata fields (Publisher `meta.title`, `meta.description`, `meta.og.*`; writer.md: title, description, share), read from the meta-fields data file. */
export const PAGE_META_FIELDS: readonly DesignerCopyField[] = Object.freeze(META_FIELDS.page);
/** Publication metadata fields (writer.md: site name, default share), read from the meta-fields data file. */
export const PUBLICATION_META_FIELDS: readonly DesignerCopyField[] = Object.freeze(META_FIELDS.publication);
export const PAGE_METADATA_L1 = { id: "copy/page-metadata", label: "Page metadata" } as const;
const META_REF = /^writer\/(page\.([a-z0-9]+(?:-[a-z0-9]+)*)\.meta)#([a-z0-9]+(?:-[a-z0-9]+)*\.meta)$/;

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
  derivePageMetadata(input.directory, nodes, slots);
  return { schema: "clossys.writer-ia/1", group: "copy", label: "Copy", nodes, slots, awaiting };
}

const metaSlot = (id: string, unit: string, record: string, placement: string, fields: readonly DesignerCopyField[], extra: readonly WriterRef[] = []): GroupSlot => ({
  id, kind: "copy", mark: "starter", inputs: [...VOICE_INPUTS, ...DIRECTOR_INPUTS, ...extra].map(ref => ({ ...ref })),
  contract: {
    unit,
    records: { [record]: { placement } },
    copy: { sourceLocale: "en", fields: projectFields(fields) },
    fieldsSha256: fieldsSha256(fields),
    candidate: "clossys.copy-candidate/1",
  },
});

/** Page metadata: one L2 per live publication; its `publication.<id>.meta`, then each live page's `page.<id>.meta`. */
function derivePageMetadata(directory: PublisherDirectory, nodes: GroupL1[], slots: GroupSlot[]): void {
  const l1: GroupL1 = { id: PAGE_METADATA_L1.id, label: PAGE_METADATA_L1.label, children: [] };
  for (const node of directory.nodes) {
    for (const child of node.children) {
      if (node.parked || child.parked) continue;
      const publication = child.publication;
      const leaves: string[] = [];
      const pubId = `publication.${publication}.meta`;
      leaves.push(pubId);
      slots.push(metaSlot(pubId, `publisher/${publication}`, `${publication}.meta`, `publisher/${publication}#meta`, PUBLICATION_META_FIELDS));
      for (const pageId of child.leaves) {
        const page = directory.slots[pageId];
        if (!page) throw new Error(`Writer derive: Publisher places ${pageId} with no slot`);
        if (page.parked || page.kind !== "page" || page.records?.meta === undefined) continue;
        const ref = META_REF.exec(page.records.meta);
        if (!ref || `page.${ref[2]}` !== pageId || ref[3] !== `${ref[2]}.meta`) throw new Error(`Writer derive: ${pageId} names meta ${page.records.meta}; expected writer/${pageId}.meta#${pageId.slice(5)}.meta`);
        leaves.push(ref[1]!);
        slots.push(metaSlot(ref[1]!, `publisher/${pageId}`, ref[3]!, `publisher/${pageId}#meta`, PAGE_META_FIELDS, [{ to: `writer/${pubId}`, rel: "input" }]));
      }
      l1.children.push({ id: `${l1.id}/${publication}`, label: publication, leaves });
    }
  }
  if (l1.children.length) nodes.push(l1);
}

/** Both directions: every live Designer unit with copy fields has exactly one Copy slot, and every Copy slot has fields. */
export function checkCopyAgainstDesigner(tree: GroupTree, input: DesignerCopyInput): WriterTreeFinding[] {
  const findings: WriterTreeFinding[] = [];
  const fail = (message: string) => { findings.push({ code: "COPY", group: "copy", message: `COPY: ${message}` }); };
  const bySlot = new Map(input.slots.map(slot => [slot.id, slot]));
  const unitOf = (slot: GroupSlot) => String(slot.contract?.unit ?? "").replace(/^designer\//, "");
  const isMeta = (slot: GroupSlot) => String(slot.contract?.unit ?? "").startsWith("publisher/");
  findings.push(...checkPageMetadata(tree, input.directory));
  for (const slot of tree.slots) {
    if (isMeta(slot)) continue;
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
    const count = tree.slots.filter(entry => !isMeta(entry) && unitOf(entry) === slot.id).length;
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

/**
 * Page metadata both ways: every live Publisher page whose `records.meta` names a Writer slot has exactly that one
 * `page.<id>.meta` slot, every live publication has one `publication.<id>.meta`, and no meta slot names a page or
 * publication that is parked, missing or has no meta ref.
 */
export function checkPageMetadata(tree: GroupTree, directory: PublisherDirectory): WriterTreeFinding[] {
  const findings: WriterTreeFinding[] = [];
  const fail = (message: string) => { findings.push({ code: "COPY", group: "copy", message: `COPY: ${message}` }); };
  const want = new Map<string, string>();
  for (const node of directory.nodes) for (const child of node.children) {
    if (node.parked || child.parked) continue;
    want.set(`publication.${child.publication}.meta`, `publisher/${child.publication}`);
    for (const pageId of child.leaves) {
      const page = directory.slots[pageId];
      if (!page || page.parked || page.kind !== "page" || page.records?.meta === undefined) continue;
      const slot = META_REF.exec(page.records.meta)?.[1];
      if (!slot) { fail(`publisher/${pageId} meta ref ${page.records.meta} does not name a writer/page.<id>.meta record`); continue; }
      want.set(slot, `publisher/${pageId}`);
    }
  }
  const meta = tree.slots.filter(slot => /^(?:page|publication)\./.test(slot.id) || String(slot.contract?.unit ?? "").startsWith("publisher/"));
  for (const [id, unit] of want) {
    const found = meta.filter(slot => slot.id === id);
    if (found.length !== 1) fail(`${unit} needs exactly one Page metadata slot ${id}; found ${found.length}`);
    else if (found[0]!.contract?.unit !== unit) fail(`${id} names unit ${String(found[0]!.contract?.unit)}; expected ${unit}`);
  }
  for (const slot of meta) if (!want.has(slot.id)) fail(`${slot.id} is a Page metadata slot with no live Publisher page or publication that names it`);
  return findings;
}
