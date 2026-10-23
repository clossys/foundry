import type { ReactNode } from "react";
import type { BadgeVariant } from "../../atoms/Badge.js";
import type { CatalogWorkspaceSize } from "../catalog-workspace/types.js";

/** Every entry carries one lifecycle. Parked entries are hidden from browse until shown. */
export type CatalogBrowserLifecycle = "draft" | "stable" | "deprecated" | "parked";

/** One top-level group of a catalog's display tree, with its sub-groups in display order. */
export interface CatalogBrowserGroup {
  readonly id: string;
  readonly label: string;
  readonly children: readonly { readonly id: string; readonly label: string }[];
}

/** The fields the browser reads from every entry. Extra manifest fields pass through to the slots untouched. */
export interface CatalogBrowserEntry {
  /** Unique within its catalog; retained verbatim. */
  readonly id: string;
  readonly label: string;
  /** Top-level group id. */
  readonly l1: string;
  /** Sub-group id within `l1`. */
  readonly l2: string;
  readonly lifecycle: CatalogBrowserLifecycle;
  readonly notes?: readonly string[];
}

/** One catalog manifest: its kind, its two-level group tree and its entries. */
export interface CatalogBrowserCatalog<K extends string = string, E extends CatalogBrowserEntry = CatalogBrowserEntry> {
  readonly kind: K;
  readonly groups: readonly CatalogBrowserGroup[];
  readonly entries: readonly E[];
}

/** The configurator's values, keyed by control id. */
export type CatalogBrowserConfig = Readonly<Record<string, string | boolean>>;

/** One configurator control. Its value drives the preview slot. */
export type CatalogBrowserControl =
  | {
    readonly type: "choice";
    readonly id: string;
    readonly label: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
    readonly defaultValue: string;
  }
  | { readonly type: "toggle"; readonly id: string; readonly label: string; readonly defaultValue: boolean }
  | { readonly type: "text"; readonly id: string; readonly label: string; readonly defaultValue: string };

/** What the preview slot receives beside the entry. */
export interface CatalogBrowserPreviewContext {
  /** The selected entry's catalog kind. */
  readonly kind: string;
  /** Control defaults merged with the current configuration. */
  readonly config: CatalogBrowserConfig;
}

/** A link from one entry to another, possibly in another catalog. */
export interface CatalogBrowserReference {
  readonly catalog: string;
  readonly entryId: string;
  /** Defaults to the target entry's label; an unresolved reference renders as text. */
  readonly label?: string;
}

/** A host-declared browse filter, rendered as a choice with an "any value" option first. */
export interface CatalogBrowserFilter<E extends CatalogBrowserEntry = CatalogBrowserEntry> {
  readonly id: string;
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  /** The entry's option id for this filter, or undefined when it has none. */
  readonly value: (entry: E) => string | undefined;
}

/** A metadata row of the entry detail template. */
export interface CatalogBrowserField {
  readonly label: string;
  readonly value: ReactNode;
}

/** A status badge in the entry header. */
export interface CatalogBrowserBadge {
  readonly label: string;
  readonly tone?: BadgeVariant;
}

/** The host's slots and data bindings for one catalog kind. Previews are always host-supplied. */
export interface CatalogBrowserKind<E extends CatalogBrowserEntry = CatalogBrowserEntry> {
  /** Tab name for this catalog. */
  readonly label: string;
  /** The renderer slot: the selected entry's live preview. Never called for a not-built entry. */
  readonly preview: (entry: E, context: CatalogBrowserPreviewContext) => ReactNode;
  /** Configurator controls for the entry's axes, levers or config. */
  readonly controls?: (entry: E) => readonly CatalogBrowserControl[];
  /** A reason when the entry is not built yet; the renderer shows a not-built state instead of the preview. */
  readonly notBuilt?: (entry: E) => string | undefined;
  /** Header badges after the lifecycle badge. */
  readonly badges?: (entry: E) => readonly CatalogBrowserBadge[];
  /** Metadata rows after ID, group and lifecycle. */
  readonly fields?: (entry: E) => readonly CatalogBrowserField[];
  /** Named states the entry styles or supports. */
  readonly states?: (entry: E) => readonly string[];
  /** Usage guidance content. */
  readonly usage?: (entry: E) => ReactNode;
  /** Entries this one is built from. */
  readonly builtFrom?: (entry: E) => readonly CatalogBrowserReference[];
  /** Entries that use this one. */
  readonly usedBy?: (entry: E) => readonly CatalogBrowserReference[];
  /** Browse filters, for example status or tier. */
  readonly filters?: readonly CatalogBrowserFilter<E>[];
  /** Shown in the renderer while no entry is selected, in place of the select prompt. */
  readonly overview?: ReactNode;
}

/** The selected catalog and entry. A null entry selects the catalog only. */
export interface CatalogBrowserSelection {
  readonly catalog: string;
  readonly entryId: string | null;
}

/** Every visible string, supplied by the host. */
export interface CatalogBrowserLabels {
  /** Names the catalog tab list when there is more than one catalog. */
  readonly catalogs: string;
  readonly toolbar: string;
  readonly search: string;
  /** The first option of every filter. */
  readonly anyValue: string;
  readonly showParked: (count: number) => string;
  /** The detail text of a group row. */
  readonly entryCount: (count: number) => string;
  readonly lifecycle: Readonly<Record<CatalogBrowserLifecycle, string>>;
  readonly browse: string;
  readonly preview: string;
  /** Names the configurator pane. */
  readonly inspector: string;
  readonly resizeBrowse: string;
  readonly resizeInspector: string;
  readonly selectEntry: string;
  readonly noMatches: string;
  readonly empty: string;
  readonly unknownEntry: (id: string) => string;
  readonly loading: string;
  /** Not-built state title and row badge. */
  readonly notBuilt: string;
  readonly livePreview: string;
  readonly metadata: string;
  readonly id: string;
  readonly group: string;
  readonly lifecycleField: string;
  readonly notes: string;
  readonly states: string;
  readonly usage: string;
  readonly builtFrom: string;
  readonly usedBy: string;
  readonly noControls: string;
  readonly resetControls: string;
}

/** The manifest entry type of one catalog kind within a union of catalogs. */
export type CatalogBrowserEntryOf<C extends CatalogBrowserCatalog, K extends string> =
  Extract<C, { readonly kind: K }>["entries"][number];

export interface CatalogBrowserProps<C extends CatalogBrowserCatalog = CatalogBrowserCatalog> {
  /** One or more catalogs with distinct kinds, in tab order. */
  catalogs: readonly C[];
  /** Slots and bindings for every catalog kind. */
  kinds: { readonly [K in C["kind"]]: CatalogBrowserKind<CatalogBrowserEntryOf<C, K>> };
  /** Names the whole browser region. */
  label: string;
  labels: CatalogBrowserLabels;
  /** Controlled selection; pair with `onSelectionChange`. */
  selection?: CatalogBrowserSelection;
  /** Initial selection when uncontrolled. Defaults to the first catalog with no entry. */
  defaultSelection?: CatalogBrowserSelection;
  onSelectionChange?: (selection: CatalogBrowserSelection) => void;
  /** Controlled configuration for the selected entry; control defaults fill missing ids. */
  config?: CatalogBrowserConfig;
  onConfigChange?: (config: CatalogBrowserConfig) => void;
  /** Replaces the browser with a loading status while the manifests load. */
  isLoading?: boolean;
  /** Replaces the browser with host recovery content. */
  error?: ReactNode;
  browseSize?: CatalogWorkspaceSize;
  inspectorSize?: CatalogWorkspaceSize;
  className?: string;
  dir?: "ltr" | "rtl";
}
