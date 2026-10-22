import type { ReactNode } from "react";
import { getTreeAncestry, indexTree, type TreeValidationOptions } from "./tree-model.js";

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
  indexTree(tree, NAVIGATION_OPTIONS);
}

const NAVIGATION_OPTIONS: TreeValidationOptions<AppNavigationNode> = {
  maxDepth: 2, requireDestination: true, getSelect: node => node.onAction,
};

export function getAppNavigationAncestry(
  tree: readonly AppNavigationNode[], target: AppNavigationTarget,
): readonly AppNavigationNode[] {
  return getTreeAncestry(tree, target, NAVIGATION_OPTIONS);
}

export function getAppNavigationBreadcrumbs(
  tree: readonly AppNavigationNode[], target: AppNavigationTarget,
): readonly AppNavigationBreadcrumb[] {
  return getAppNavigationAncestry(tree, target).map(({ id, label, href }) => ({ id, label, ...(href === undefined ? {} : { href }) }));
}
