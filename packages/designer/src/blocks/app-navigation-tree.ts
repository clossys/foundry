import type { ReactNode } from "react";

export type AppNavigationDestination =
  | { href: string; onAction?: never }
  | { href?: never; onAction: () => void };

interface NavigationIdentity {
  id: string;
  label: string;
  /** Decorative content; the destination's label remains its accessible name. */
  icon?: ReactNode;
}

export type AppNavigationLeaf = NavigationIdentity & AppNavigationDestination & { children?: never };
export type AppNavigationNode = AppNavigationLeaf | (NavigationIdentity & {
  children: readonly AppNavigationLeaf[];
} & (AppNavigationDestination | { href?: never; onAction?: never }));

export interface AppNavigationTarget {
  id?: string;
  href?: string;
}

export interface AppNavigationBreadcrumb {
  id: string;
  label: string;
  href?: string;
}

/** Reject unsafe runtime input as well as the unsupported shapes excluded by the public types. */
export function validateAppNavigationTree(tree: readonly AppNavigationNode[]): void {
  const ids = new Set<string>();
  const visit = (nodes: readonly AppNavigationNode[], depth: number) => {
    if (depth > 2) throw new Error("Navigation supports exactly two levels");
    if (!Array.isArray(nodes)) throw new Error("Navigation children must be an array");
    for (const node of nodes) {
      if (!node || typeof node.id !== "string" || !node.id.trim()) throw new Error("Navigation id is required");
      if (ids.has(node.id)) throw new Error(`Duplicate navigation id: ${node.id}`);
      ids.add(node.id);
      if (typeof node.label !== "string" || !node.label.trim()) throw new Error("Navigation label is required");
      const hasHref = node.href !== undefined;
      const hasAction = node.onAction !== undefined;
      if ((hasHref && hasAction) || (hasHref && (typeof node.href !== "string" || !node.href.trim())) ||
          (hasAction && typeof node.onAction !== "function")) throw new Error("Navigation destination must be one href or action");
      if (node.children !== undefined) visit(node.children, depth + 1);
      if (!hasHref && !hasAction && !node.children?.length) throw new Error("Navigation needs a destination or children");
    }
  };
  visit(tree, 1);
}

export function getAppNavigationAncestry(
  tree: readonly AppNavigationNode[], target: AppNavigationTarget,
): readonly AppNavigationNode[] {
  validateAppNavigationTree(tree);
  const matches = (node: AppNavigationNode) => target.id !== undefined ? node.id === target.id : target.href !== undefined && node.href === target.href;
  for (const node of tree) {
    if (matches(node)) return [node];
    const child = node.children?.find(matches);
    if (child) return [node, child];
  }
  return [];
}

export function getAppNavigationBreadcrumbs(
  tree: readonly AppNavigationNode[], target: AppNavigationTarget,
): readonly AppNavigationBreadcrumb[] {
  return getAppNavigationAncestry(tree, target).map(({ id, label, href }) => ({ id, label, ...(href === undefined ? {} : { href }) }));
}
