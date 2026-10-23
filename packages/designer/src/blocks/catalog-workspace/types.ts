import type { ReactNode } from "react";

export interface CatalogWorkspaceItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly badge?: string;
  readonly tag?: string;
  /** Presence marks a folder, including an empty folder. Depth is unrestricted. */
  readonly children?: readonly CatalogWorkspaceItem[];
}
export interface CatalogWorkspaceSize {
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
}
export interface CatalogWorkspaceProps {
  /** A supplied forest, bounded to 10,000 nodes at any depth. IDs are preserved verbatim. */
  items: readonly CatalogWorkspaceItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
  labels: { browse: string; preview: string; inspector: string; resizeBrowse: string; resizeInspector: string };
  /** Each slot receives the original selected leaf object. */
  preview: (item: CatalogWorkspaceItem) => ReactNode;
  inspector: (item: CatalogWorkspaceItem) => ReactNode;
  emptyState: ReactNode;
  /** Folders open when browse first renders. A list that gains an id re-applies disclosure; one that only drops ids keeps the current disclosure and focus. Ids that name no folder open nothing. */
  defaultExpandedIds?: readonly string[];
  browseSize?: CatalogWorkspaceSize;
  inspectorSize?: CatalogWorkspaceSize;
  className?: string;
  dir?: "ltr" | "rtl";
}
