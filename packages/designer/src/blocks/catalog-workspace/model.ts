import type { CatalogWorkspaceItem, CatalogWorkspaceProps, CatalogWorkspaceSize } from "./types.js";

export function catalogIndex(items: readonly CatalogWorkspaceItem[]) {
  const nodes = new Map<string, CatalogWorkspaceItem>();
  const parents = new Map<string, string>();
  const visit = (list: readonly CatalogWorkspaceItem[], depth: number, parent?: string) => {
    if (!Array.isArray(list) || depth > 3) throw new TypeError("CatalogWorkspace: a forest of at most three levels is required.");
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      if (!item || typeof item !== "object" || ![item.id, item.label, item.kind].every(value => typeof value === "string" && value.trim().length > 0)
        || nodes.has(item.id) || nodes.size >= 1000 || [item.badge, item.tag].some(value => value !== undefined && typeof value !== "string")) {
        throw new TypeError("CatalogWorkspace: at most 1,000 nodes with unique IDs and nonempty labels and kinds are required.");
      }
      nodes.set(item.id, item);
      if (parent !== undefined) parents.set(item.id, parent);
      if (item.children !== undefined) {
        if (depth === 3 && item.children.length > 0) throw new TypeError("CatalogWorkspace: at most three levels are supported.");
        visit(item.children, depth + (item.children.length > 0 ? 1 : 0), item.id);
      }
    }
  };
  visit(items, 1);
  return { nodes, parents };
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
