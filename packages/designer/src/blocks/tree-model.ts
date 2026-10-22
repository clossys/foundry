import type { ReactNode } from "react";

/** Caller-owned identity and destinations, shared by tree presentations. */
export interface TreeNode {
  id: string;
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** Presence denotes a folder, including an empty folder. */
  children?: readonly TreeNode[];
}
export interface TreeTarget { id?: string; href?: string }
export interface TreeBreadcrumb { id: string; label: string; href?: string }
export interface TreeValidationOptions<T extends TreeNode & { children?: readonly T[] } = TreeNode> {
  /** Unset means unrestricted depth. Roots have depth one. */
  maxDepth?: number;
  maxNodes?: number;
  /** Navigation requires a destination or nonempty children; explorers allow passive files and empty folders. */
  requireDestination?: boolean;
  /** Adapts an existing selection callback without copying caller nodes. */
  getSelect?: (node: T) => unknown;
}
export interface TreeIndex<T extends TreeNode & { children?: readonly T[] } = TreeNode> {
  nodes: Map<string, T>;
  parents: Map<string, string>;
  depths: Map<string, number>;
}

/** Validate and index iteratively, so data depth never depends on the JavaScript call stack. */
export function indexTree<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], options?: TreeValidationOptions<T>): TreeIndex<T>;
export function indexTree(tree: readonly TreeNode[], options?: TreeValidationOptions): TreeIndex;
export function indexTree<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], options: TreeValidationOptions<T> = {}): TreeIndex<T> {
  const { maxDepth, maxNodes, requireDestination = false, getSelect = node => node.onSelect } = options;
  for (const bound of [maxDepth, maxNodes]) if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 1)) {
    throw new TypeError("Tree bounds must be positive safe integers");
  }
  const nodes = new Map<string, T>();
  const parents = new Map<string, string>();
  const depths = new Map<string, number>();
  const seen = new Set<object>();
  const pending: { list: readonly T[]; depth: number; parent?: string; offset: number }[] = [{ list: tree, depth: 1, offset: 0 }];
  while (pending.length) {
    const frame = pending.at(-1)!;
    const { list, depth, parent } = frame;
    if (!Array.isArray(list)) throw new TypeError("Tree children must be an array");
    if (list.length && maxDepth !== undefined && depth > maxDepth) {
      throw new TypeError(`Tree supports at most ${maxDepth === 2 ? "two" : maxDepth} levels`);
    }
    if (frame.offset >= list.length) { pending.pop(); continue; }
    const node = list[frame.offset++]!;
    if (!node || typeof node !== "object") throw new TypeError("Tree node is required");
    if (seen.has(node)) throw new TypeError("Tree cycle or repeated node reference");
    seen.add(node);
    if (typeof node.id !== "string" || !node.id.trim()) throw new TypeError("Tree id is required");
    if (nodes.has(node.id)) throw new TypeError(`Duplicate tree id: ${node.id}`);
    if (maxNodes !== undefined && nodes.size >= maxNodes) throw new TypeError(`Tree supports at most ${maxNodes.toLocaleString("en-US")} nodes`);
    if (typeof node.label !== "string" || !node.label.trim()) throw new TypeError("Tree label is required");
    const select = getSelect(node);
    const hasHref = node.href !== undefined;
    const hasSelect = select !== undefined;
    if ((hasHref && hasSelect) || (hasHref && (typeof node.href !== "string" || !node.href.trim())) ||
        (hasSelect && typeof select !== "function")) throw new TypeError("Tree destination must be one href or selection callback");
    if (node.children !== undefined && !Array.isArray(node.children)) throw new TypeError("Tree children must be an array");
    if (requireDestination && !hasHref && !hasSelect && !node.children?.length) throw new TypeError("Tree needs a destination or children");
    nodes.set(node.id, node); depths.set(node.id, depth);
    if (parent !== undefined) parents.set(node.id, parent);
    if (node.children !== undefined) pending.push({ list: node.children as readonly T[], depth: depth + 1, parent: node.id, offset: 0 });
  }
  return { nodes, parents, depths };
}

export function getTreeAncestry<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], target: TreeTarget, options?: TreeValidationOptions<T>): readonly T[];
export function getTreeAncestry(tree: readonly TreeNode[], target: TreeTarget, options?: TreeValidationOptions): readonly TreeNode[];
export function getTreeAncestry<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], target: TreeTarget, options?: TreeValidationOptions<T>): readonly T[] {
  const { nodes, parents } = indexTree(tree, options);
  const match = target.id !== undefined ? nodes.get(target.id) : target.href === undefined ? undefined : [...nodes.values()].find(node => node.href === target.href);
  const result: T[] = [];
  let node = match;
  while (node) { result.push(node); const parent = parents.get(node.id); node = parent === undefined ? undefined : nodes.get(parent); }
  return result.reverse();
}

export function getTreeBreadcrumbs<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], target: TreeTarget, options?: TreeValidationOptions<T>): readonly TreeBreadcrumb[];
export function getTreeBreadcrumbs(tree: readonly TreeNode[], target: TreeTarget, options?: TreeValidationOptions): readonly TreeBreadcrumb[];
export function getTreeBreadcrumbs<T extends TreeNode & { children?: readonly T[] }>(tree: readonly T[], target: TreeTarget, options?: TreeValidationOptions<T>): readonly TreeBreadcrumb[] {
  return getTreeAncestry(tree, target, options).map(({ id, label, href }) => ({ id, label, ...(href === undefined ? {} : { href }) }));
}
