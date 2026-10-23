import type { CatalogWorkspaceItem } from "../catalog-workspace/types.js";
import type {
  CatalogBrowserCatalog, CatalogBrowserConfig, CatalogBrowserControl, CatalogBrowserEntry,
  CatalogBrowserKind, CatalogBrowserLabels, CatalogBrowserProps, CatalogBrowserSelection,
} from "./types.js";

/** The first option of every filter; no host option may use it. */
export const ANY_VALUE = "catalog-browser-any";
const GROUP_PREFIX = "catalog-browser-group:";

/** Per-catalog browse state: the query, each filter's option id and whether parked entries show. */
export interface BrowseState {
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly showParked: boolean;
}
export const INITIAL_BROWSE: BrowseState = { query: "", filters: {}, showParked: false };

/** An own-property read, so a host id such as `constructor` or `__proto__` never resolves to an inherited member. */
export function own<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function groupId(l1: string, l2?: string) {
  return GROUP_PREFIX + JSON.stringify(l2 === undefined ? [l1] : [l1, l2]);
}

const LABEL_KEYS = [
  "catalogs", "toolbar", "search", "anyValue", "browse", "preview", "inspector", "resizeBrowse", "resizeInspector",
  "selectEntry", "noMatches", "empty", "loading", "notBuilt", "livePreview", "metadata", "id", "group", "lifecycleField",
  "notes", "states", "usage", "builtFrom", "usedBy", "noControls", "resetControls",
] as const satisfies readonly (keyof CatalogBrowserLabels)[];
const LABEL_FUNCTIONS = ["showParked", "entryCount", "unknownEntry"] as const satisfies readonly (keyof CatalogBrowserLabels)[];
const LIFECYCLES = ["draft", "stable", "deprecated", "parked"] as const;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Fails fast with a TypeError naming what the host must supply. Catalogs are checked unless loading or failed. */
export function assertCatalogBrowserProps(props: CatalogBrowserProps, checkCatalogs: boolean) {
  const { catalogs, kinds, label, labels } = props;
  if (!nonempty(label) || !labels || !LABEL_KEYS.every(key => nonempty(labels[key])) ||
      !LABEL_FUNCTIONS.every(key => typeof labels[key] === "function") ||
      !labels.lifecycle || !LIFECYCLES.every(key => nonempty(labels.lifecycle[key]))) {
    throw new TypeError("CatalogBrowser: a label and every labels entry are required.");
  }
  if (props.dir !== undefined && props.dir !== "ltr" && props.dir !== "rtl") throw new TypeError("CatalogBrowser: dir must be ltr or rtl.");
  if (!checkCatalogs) return;
  if (!Array.isArray(catalogs) || catalogs.length === 0) throw new TypeError("CatalogBrowser: at least one catalog is required.");
  const seen = new Set<string>();
  for (const catalog of catalogs) {
    if (!nonempty(catalog.kind) || seen.has(catalog.kind)) throw new TypeError("CatalogBrowser: catalog kinds must be nonempty and distinct.");
    seen.add(catalog.kind);
    const binding = own(kinds as Readonly<Record<string, CatalogBrowserKind>>, catalog.kind);
    if (!binding || !nonempty(binding.label) || typeof binding.preview !== "function") {
      throw new TypeError(`CatalogBrowser: kinds.${catalog.kind} needs a label and a preview slot.`);
    }
    if (binding.filters?.some(filter => !nonempty(filter.id) || !nonempty(filter.label) || typeof filter.value !== "function" ||
        filter.options.some(option => option.id === ANY_VALUE))) {
      throw new TypeError(`CatalogBrowser: kinds.${catalog.kind} filters need ids, labels and value functions, and may not use the option id "${ANY_VALUE}".`);
    }
    assertPlacement(catalog);
  }
}

function assertPlacement(catalog: CatalogBrowserCatalog) {
  const places = new Set<string>();
  for (const l1 of catalog.groups) for (const l2 of l1.children) places.add(groupId(l1.id, l2.id));
  const ids = new Set<string>();
  for (const entry of catalog.entries) {
    if (!nonempty(entry.id) || ids.has(entry.id) || entry.id.startsWith(GROUP_PREFIX)) {
      throw new TypeError(`CatalogBrowser: ${catalog.kind} entry ids must be nonempty and unique.`);
    }
    ids.add(entry.id);
    if (!places.has(groupId(entry.l1, entry.l2))) throw new TypeError(`CatalogBrowser: ${catalog.kind} entry ${entry.id} names no declared group.`);
  }
}

function matches<E extends CatalogBrowserEntry>(entry: E, binding: CatalogBrowserKind<E>, browse: BrowseState) {
  const query = browse.query.trim().toLowerCase();
  if (query && !entry.label.toLowerCase().includes(query) && !entry.id.toLowerCase().includes(query)) return false;
  return (binding.filters ?? []).every(filter => {
    const wanted = own(browse.filters, filter.id);
    return wanted === undefined || wanted === ANY_VALUE || filter.value(entry) === wanted;
  });
}

export function isFiltering(browse: BrowseState) {
  return browse.query.trim() !== "" || Object.values(browse.filters).some(value => value !== ANY_VALUE);
}

/**
 * The display tree for one catalog: L1 folder, L2 folder, entry leaf. Parked entries
 * stay hidden unless shown, and the selected entry always stays listed. Groups left
 * empty by a query or filter are dropped; declared empty groups otherwise remain.
 */
export function catalogTree<E extends CatalogBrowserEntry>(
  catalog: CatalogBrowserCatalog<string, E>, binding: CatalogBrowserKind<E>, labels: CatalogBrowserLabels,
  browse: BrowseState, selectedId: string | null,
) {
  const filtering = isFiltering(browse);
  const expandIds: string[] = [];
  const items: CatalogWorkspaceItem[] = [];
  for (const l1 of catalog.groups) {
    const subgroups: CatalogWorkspaceItem[] = [];
    let l1Count = 0;
    for (const l2 of l1.children) {
      const leaves = catalog.entries
        .filter(entry => entry.l1 === l1.id && entry.l2 === l2.id)
        .filter(entry => entry.id === selectedId || ((browse.showParked || entry.lifecycle !== "parked") && matches(entry, binding, browse)))
        .map((entry): CatalogWorkspaceItem => {
          const reason = binding.notBuilt?.(entry);
          return { id: entry.id, label: entry.label, kind: entry.id, tag: labels.lifecycle[entry.lifecycle],
            ...(reason !== undefined ? { badge: labels.notBuilt } : {}) };
        });
      if (filtering && leaves.length === 0) continue;
      const id = groupId(l1.id, l2.id);
      if (filtering) expandIds.push(id);
      l1Count += leaves.length;
      subgroups.push({ id, label: l2.label, kind: labels.entryCount(leaves.length), children: leaves });
    }
    if (filtering && subgroups.length === 0) continue;
    const id = groupId(l1.id);
    if (filtering) expandIds.push(id);
    items.push({ id, label: l1.label, kind: labels.entryCount(l1Count), children: subgroups });
  }
  const parkedCount = catalog.entries.filter(entry => entry.lifecycle === "parked").length;
  return { items, expandIds, parkedCount, filtering };
}

/** The folders that must be open for an entry to show. */
export function ancestorIds(entry: CatalogBrowserEntry | undefined) {
  return entry ? [groupId(entry.l1), groupId(entry.l1, entry.l2)] : [];
}

/** Control defaults overlaid with the supplied values. */
export function resolveConfig(controls: readonly CatalogBrowserControl[], values: CatalogBrowserConfig | undefined): CatalogBrowserConfig {
  return { ...Object.fromEntries(controls.map(control => [control.id, control.defaultValue])), ...values };
}

export function sameSelection(a: CatalogBrowserSelection, b: CatalogBrowserSelection) {
  return a.catalog === b.catalog && a.entryId === b.entryId;
}
