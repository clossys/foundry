import type { ReactNode } from "react";

export interface CatalogWorkspaceItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly badge?: string;
  readonly tag?: string;
  /** Presence marks a group, including an empty group. At most three levels. */
  readonly children?: readonly CatalogWorkspaceItem[];
}
export interface CatalogWorkspaceSize {
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
}
export interface CatalogWorkspaceProps {
  /** A supplied forest, bounded to 1,000 nodes and three levels. IDs are preserved verbatim. */
  items: readonly CatalogWorkspaceItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
  labels: { browse: string; preview: string; inspector: string; resizeBrowse: string; resizeInspector: string };
  /** Each slot receives the original selected leaf object. */
  preview: (item: CatalogWorkspaceItem) => ReactNode;
  inspector: (item: CatalogWorkspaceItem) => ReactNode;
  emptyState: ReactNode;
  browseSize?: CatalogWorkspaceSize;
  inspectorSize?: CatalogWorkspaceSize;
  className?: string;
  dir?: "ltr" | "rtl";
}
