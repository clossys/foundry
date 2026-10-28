import treeData from "./tree.json" with { type: "json" };

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
