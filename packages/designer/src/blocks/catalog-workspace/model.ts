import type { CatalogWorkspaceItem, CatalogWorkspaceProps, CatalogWorkspaceSize } from "./types.js";
import { indexTree } from "../tree-model.js";

export function catalogIndex(items: readonly CatalogWorkspaceItem[]) {
  const index = indexTree(items, { maxNodes: 10000 });
  for (const item of index.nodes.values()) {
    if (typeof item.kind !== "string" || !item.kind.trim() || [item.badge, item.tag].some(value => value !== undefined && typeof value !== "string")) {
      throw new TypeError("CatalogWorkspace: nonempty kinds and string metadata are required.");
    }
  }
  return index;
}
export function assertCatalogProps(props: CatalogWorkspaceProps) {
  if (typeof props.label !== "string" || !props.label.trim() || !props.labels ||
      ![props.labels.browse, props.labels.preview, props.labels.inspector, props.labels.resizeBrowse, props.labels.resizeInspector].every(value => typeof value === "string" && value.trim()) ||
      (props.selectedId !== null && typeof props.selectedId !== "string") || typeof props.onSelect !== "function" || typeof props.preview !== "function" || typeof props.inspector !== "function" ||
      (props.dir !== undefined && props.dir !== "ltr" && props.dir !== "rtl")) throw new TypeError("CatalogWorkspace: names, controlled selection and content slots are required.");
}
export function paneSize(size: CatalogWorkspaceSize | undefined): CatalogWorkspaceSize {
  const value = size ?? { min: 160, max: 480, defaultValue: 240, step: 16 };
  if (![value.min, value.max, value.defaultValue, value.step ?? 16].every(Number.isFinite) || value.min < 0 || value.max < value.min || value.defaultValue < value.min || value.defaultValue > value.max || (value.step ?? 16) <= 0) throw new TypeError("CatalogWorkspace: finite ordered pane bounds and a positive step are required.");
  return value;
}
