import treeData from "./tree.json" with { type: "json" };
import type { InstanceBinding, SectionPlacement, RegionPageBinding, SectionFill } from "../core/instance-binding.js";

export interface ContentTreeChild {
  readonly id: string;
  readonly label: string;
  readonly frame?: string;
}
export interface ContentTreeNode {
  readonly id: string;
  readonly label: string;
  readonly children: readonly ContentTreeChild[];
}
export interface ContentTree {
  readonly schemaVersion: 1;
  readonly nodes: readonly ContentTreeNode[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function assertFields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid content tree at ${path}: unknown field`);
}

/** Validate editable placement data and return an immutable copy in presentation order. */
export function loadContentTree(input: unknown = treeData): ContentTree {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.nodes)) {
    throw new Error("Invalid content tree: expected schemaVersion 1 and nodes");
  }
  assertFields(input, ["schemaVersion", "nodes"], "tree");
  const groupIds = new Set<string>();
  const nodes = input.nodes.map((node: unknown, index: number): ContentTreeNode => {
    const path = `nodes[${index}]`;
    if (!record(node) || !text(node.id) || !text(node.label) || !Array.isArray(node.children)) {
      throw new Error(`Invalid content tree at ${path}: expected id, label and children`);
    }
    assertFields(node, ["id", "label", "children"], path);
    if (groupIds.has(node.id)) throw new Error(`Invalid content tree at ${path}: duplicate group id`);
    groupIds.add(node.id);
    const childIds = new Set<string>();
    const children = node.children.map((child: unknown, childIndex: number): ContentTreeChild => {
      const childPath = `${path}.children[${childIndex}]`;
      if (!record(child) || !text(child.id) || !text(child.label) || (child.frame !== undefined && !text(child.frame))) {
        throw new Error(`Invalid content tree at ${childPath}: expected id, label and optional frame`);
      }
      assertFields(child, ["id", "label", "frame"], childPath);
      if (childIds.has(child.id)) throw new Error(`Invalid content tree at ${childPath}: duplicate child id`);
      childIds.add(child.id);
      return Object.freeze({ id: child.id, label: child.label, ...(child.frame === undefined ? {} : { frame: child.frame }) });
    });
    return Object.freeze({ id: node.id, label: node.label, children: Object.freeze(children) });
  });
  return Object.freeze({ schemaVersion: 1, nodes: Object.freeze(nodes) });
}

export const CONTENT_TREE = loadContentTree();
/** Compatibility view derived from the editable tree. */
export const CONTENT_TAXONOMY: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(CONTENT_TREE.nodes.map(node => [node.id, Object.freeze(node.children.map(child => child.id))])),
);
export type ContentL1 = string;
export type ContentL2 = string;
export type ContentPlacement = { readonly l1: string; readonly l2: string };

/** Consumer-owned in-page skeleton, one level below the publication's route map.
 * A repeated placement may name its stable data key; no catalog IA is inferred. */
export interface PageOutlinePlacement extends SectionPlacement { readonly key?: string; readonly keys?: readonly string[] }
export interface PageManifestNode {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly estimate: number;
  readonly section: PageOutlinePlacement;
}
export interface PageManifestL2 extends PageManifestNode {}
export interface PageManifestL1 extends PageManifestNode { readonly l2: readonly PageManifestL2[] }
export interface PageManifestL0 extends PageManifestNode { readonly l1: readonly PageManifestL1[]; readonly partition?: "l1" }
export interface RegisteredPageManifest { readonly l0: readonly PageManifestL0[] }
export interface PageOutlineHeading { readonly id: string; readonly label: string; readonly level: 2 | 3 | 4; readonly children?: readonly PageOutlineHeading[] }
export interface PageOutlineTarget { readonly l0: string; readonly l1?: string; readonly l2?: string; readonly section: PageOutlinePlacement }
export interface RegisteredPageOutline {
  readonly headings: readonly PageOutlineHeading[];
  readonly anchors: readonly string[];
  readonly targets: Readonly<Record<string, PageOutlineTarget>>;
  readonly groups: readonly { readonly id: string; readonly label: string; readonly count: number; readonly items: readonly { readonly id: string; readonly label: string; readonly href: string }[] }[];
}
/** Project only the page record's supplied placements and the same loader
 * manifest used by chunks/search/hash navigation. It never changes route IA. */
export function projectPageOutline(page: InstanceBinding | RegionPageBinding, manifest: RegisteredPageManifest): RegisteredPageOutline {
  if (!record(manifest) || !Array.isArray(manifest.l0) || Object.keys(manifest).some(key => key !== "l0")) throw new TypeError("A page loader manifest is required");
  const fills: Readonly<Record<string, readonly SectionFill[] | undefined>> = "regions" in page ? { main: page.regions.main, "page-module": page.regions["page-module"] } : page.fills;
  const anchors: string[] = [], targets: Record<string, PageOutlineTarget> = Object.create(null);
  const groups: { id: string; label: string; count: number; items: { id: string; label: string; href: string }[] }[] = [];
  const node = (value: PageManifestNode, allowed: readonly string[]) => {
    if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value.id) || value.id.includes("--") || !text(value.label)
      || !Number.isSafeInteger(value.count) || value.count < 0 || !Number.isFinite(value.estimate) || value.estimate < 0
      || !record(value.section) || Object.keys(value.section).some(key => !["slot", "index", "key", "keys", "children"].includes(key)) || !text(value.section.slot) || !Number.isSafeInteger(value.section.index) || value.section.index < 0) throw new TypeError("Manifest node must name an actual page Section placement");
    let fill = fills[value.section.slot]?.[value.section.index], repeats = fill?.repeat ? 1 : 0;
    if (value.section.children !== undefined && (!Array.isArray(value.section.children) || !value.section.children.length || value.section.children.length > 8)) throw new TypeError("Invalid bounded child placement");
    for (const index of value.section.children ?? []) { if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("Invalid child placement"); fill = fill?.children?.[index]; if (fill?.repeat) repeats++; }
    if (!fill || value.section.key !== undefined && (!text(value.section.key) || repeats !== 1)
      || value.section.keys !== undefined && (!Array.isArray(value.section.keys) || value.section.keys.length !== repeats || value.section.keys.some(key => !text(key)))
      || value.section.key !== undefined && value.section.keys !== undefined) throw new TypeError("Manifest repeat keys must address actual repeated placements");
  };
  const add = (ids: readonly string[], value: PageManifestNode, target: PageOutlineTarget, level: 2 | 3 | 4): PageOutlineHeading => {
    const id = ids.join("--");
    if (Object.hasOwn(targets, id)) throw new TypeError("Duplicate page outline anchor");
    anchors.push(id); targets[id] = { ...target, section: { ...target.section, ...(target.section.children ? { children: [...target.section.children] } : {}), ...(target.section.keys ? { keys: [...target.section.keys] } : {}) } };
    return { id, label: value.label, level };
  };
  const headings = manifest.l0.map(l0 => {
    node(l0, ["id", "label", "count", "estimate", "section", "l1", "partition"]);
    if (l0.partition !== undefined && l0.partition !== "l1") throw new TypeError("Unknown manifest chunk partition");
    if (!Array.isArray(l0.l1)) throw new TypeError("L0 manifest node requires L1 bands");
    const root = add([l0.id], l0, { l0: l0.id, section: l0.section }, 2), items = [{ id: root.id, label: root.label, href: `#${root.id}` }];
    const children = l0.l1.map((l1: PageManifestL1) => {
      node(l1, ["id", "label", "count", "estimate", "section", "l2"]);
      if (!Array.isArray(l1.l2)) throw new TypeError("L1 manifest node requires L2 cards");
      const band = add([l0.id, l1.id], l1, { l0: l0.id, l1: l1.id, section: l1.section }, 3);
      items.push({ id: band.id, label: band.label, href: `#${band.id}` });
      const cards = l1.l2.map((l2: PageManifestL2) => {
        node(l2, ["id", "label", "count", "estimate", "section"]);
        const card = add([l0.id, l1.id, l2.id], l2, { l0: l0.id, l1: l1.id, l2: l2.id, section: l2.section }, 4);
        items.push({ id: card.id, label: card.label, href: `#${card.id}` }); return card;
      });
      return { ...band, ...(cards.length ? { children: cards } : {}) };
    });
    groups.push({ id: l0.id, label: l0.label, count: items.length, items });
    return { ...root, ...(children.length ? { children } : {}) };
  });
  return { headings, anchors, targets, groups };
}

export function isContentL1(value: unknown, tree: ContentTree = CONTENT_TREE): value is ContentL1 {
  return typeof value === "string" && tree.nodes.some(node => node.id === value);
}
export function isContentL2(l1: unknown, value: unknown, tree: ContentTree = CONTENT_TREE): value is ContentL2 {
  return typeof l1 === "string" && typeof value === "string"
    && tree.nodes.some(node => node.id === l1 && node.children.some(child => child.id === value));
}
export function isContentPlacement(l1: unknown, l2: unknown, tree: ContentTree = CONTENT_TREE): boolean {
  return isContentL2(l1, l2, tree);
}

export type SlotId = `sl_${string}`;

/** Accept only ten lowercase RFC 4648 base32 characters after the prefix. */
export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && value.length === 13 && /^sl_[a-z2-7]{10}$/.test(value);
}

const SLOT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** Mint once at creation; preserve the id when a slot moves or is renamed. */
export function createSlotId(existingIds: ReadonlySet<string> = new Set()): SlotId {
  for (let attempt = 0; attempt < 128; attempt++) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10));
    // Each byte contributes five unbiased bits, independent of any slot address.
    const suffix = Array.from(bytes, byte => SLOT_ID_ALPHABET[byte & 31]).join("");
    const id: SlotId = `sl_${suffix}`;
    if (!existingIds.has(id)) return id;
  }
  throw new Error("Unable to mint a unique slot id after 128 attempts");
}
