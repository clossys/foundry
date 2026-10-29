import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Badge } from "../selected-components/Badge.js";
import { SearchField } from "../selected-components/SearchField.js";
import { Select } from "../selected-components/Select.js";
import { Skeleton } from "../selected-components/Skeleton.js";
import { Switch } from "../selected-components/Switch.js";
import { Tabs } from "../selected-components/Tabs.js";
import { cx } from "../selected-components/internal/cx.js";
import { CatalogWorkspace } from "./CatalogWorkspace.js";
import { EmptyState } from "./EmptyState.js";
import { Toolbar } from "./Toolbar.js";
import { Configurator } from "./catalog-browser/Configurator.js";
import { EntryDetail } from "./catalog-browser/EntryDetail.js";
import {
  ANY_VALUE, INITIAL_BROWSE, ancestorIds, assertCatalogBrowserProps, catalogTree, own, resolveConfig, type BrowseState,
} from "./catalog-browser/model.js";
import type {
  CatalogBrowserCatalog, CatalogBrowserConfig, CatalogBrowserKind, CatalogBrowserProps, CatalogBrowserReference, CatalogBrowserSelection,
} from "./catalog-browser/types.js";

export type {
  CatalogBrowserBadge, CatalogBrowserCatalog, CatalogBrowserConfig, CatalogBrowserControl, CatalogBrowserEntry, CatalogBrowserEntryOf,
  CatalogBrowserField, CatalogBrowserFilter, CatalogBrowserGroup, CatalogBrowserKind, CatalogBrowserLabels, CatalogBrowserLifecycle,
  CatalogBrowserPreviewContext, CatalogBrowserProps, CatalogBrowserReference, CatalogBrowserSelection,
} from "./catalog-browser/types.js";

const selectionKey = (selection: CatalogBrowserSelection) => JSON.stringify([selection.catalog, selection.entryId]);

/**
 * One catalog page: explore a manifest's group tree, render the selected entry through a
 * host preview slot with its detail template, and configure it. The host binds data and
 * slots per catalog kind; the browser owns browse, search, filter, selection and controls.
 */
export function CatalogBrowser<C extends CatalogBrowserCatalog>(props: CatalogBrowserProps<C>) {
  const { catalogs, label, labels, isLoading = false, error, className, dir } = props;
  const failed = error !== undefined && error !== null && error !== false;
  assertCatalogBrowserProps(props as unknown as CatalogBrowserProps, !failed && !isLoading);
  const kinds = props.kinds as unknown as Readonly<Record<string, CatalogBrowserKind>>;
  const [ownSelection, setOwnSelection] = useState<CatalogBrowserSelection>(() =>
    props.defaultSelection ?? { catalog: catalogs[0]?.kind ?? "", entryId: null });
  const [browse, setBrowse] = useState<Readonly<Record<string, BrowseState>>>({});
  const [ownConfig, setOwnConfig] = useState<{ key: string; values: CatalogBrowserConfig }>({ key: "", values: {} });
  const fromTree = useRef<string | null>(null);
  const requested = props.selection ?? ownSelection;
  const catalog: CatalogBrowserCatalog | undefined = catalogs.find(item => item.kind === requested.catalog) ?? catalogs[0];
  const selection: CatalogBrowserSelection = catalog && catalog.kind !== requested.catalog ? { catalog: catalog.kind, entryId: null } : requested;
  const entry = catalog?.entries.find(item => item.id === selection.entryId);
  const key = selectionKey(selection);
  // The selection and where its entry sits, so a catalog load or a moved entry reveals again under the same key.
  const target = JSON.stringify([key, entry ? [entry.l1, entry.l2] : null]);
  const reveal = () => ({ key, target, folders: ancestorIds(entry), leaf: entry ? [entry.id] : [] });
  const [revealed, setRevealed] = useState(reveal);
  // A new selection from outside the tree (a reference, a tab, the host, a load) lists its groups and its own id,
  // which browse treats as a gained id and opens. One made in the tree drops that id instead: browse keeps the
  // mounted tree, its disclosure and its focus, and a later return to the same entry is a gain again.
  if (revealed.target !== target) {
    setRevealed(revealed.key !== key && fromTree.current === key ? { ...revealed, key, target, leaf: [] } : reveal());
  }
  // A tree request describes one selection. The commit it causes consumes it whether the host took or ignored it,
  // so a later host selection of the same entry is never mistaken for one made in the tree.
  const settleTreeRequest = useReducer((requests: number) => requests + 1, 0)[1];
  useEffect(() => { fromTree.current = null; });
  // Uncontrolled configuration belongs to one selection; leaving it restores control defaults.
  if (ownConfig.key !== "" && ownConfig.key !== key) setOwnConfig({ key: "", values: {} });

  if (failed || isLoading) {
    return <section role="region" aria-label={label} aria-busy={!failed && isLoading ? true : undefined} dir={dir} className={cx("flex min-w-0 flex-col gap-md", className)}>
      {failed ? error : <>
        <span role="status" className="sr-only">{labels.loading}</span>
        <div aria-hidden="true" className="flex flex-col gap-sm">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} />)}
        </div>
      </>}
    </section>;
  }
  const active = catalog!;
  const binding = own(kinds, active.kind)!;

  const select = (next: CatalogBrowserSelection) => {
    if (props.selection === undefined) setOwnSelection(next);
    props.onSelectionChange?.(next);
  };
  const follow = (reference: CatalogBrowserReference) => { fromTree.current = null; select({ catalog: reference.catalog, entryId: reference.entryId }); };
  const state = own(browse, active.kind) ?? INITIAL_BROWSE;
  const update = (patch: Partial<BrowseState>) => setBrowse(previous => ({ ...previous, [active.kind]: { ...state, ...patch } }));
  const tree = catalogTree(active, binding, labels, state, entry ? entry.id : null);
  const built = entry !== undefined && binding.notBuilt?.(entry) === undefined;
  const controls = entry && built ? binding.controls?.(entry) ?? [] : [];
  const config = resolveConfig(controls, props.config ?? (ownConfig.key === key ? ownConfig.values : undefined));
  const configure = (next: CatalogBrowserConfig) => {
    if (props.config === undefined) setOwnConfig({ key, values: next });
    props.onConfigChange?.(next);
  };

  let placeholder: ReactNode;
  if (selection.entryId !== null && !entry) placeholder = <EmptyState role="alert" title={labels.unknownEntry(selection.entryId)} />;
  else if (tree.filtering && !tree.items.length) placeholder = <EmptyState role="status" title={labels.noMatches} />;
  else if (!active.entries.length) placeholder = <EmptyState title={labels.empty} />;
  else placeholder = binding.overview ?? <EmptyState title={labels.selectEntry} />;

  const body = <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-md">
    <Toolbar aria-label={labels.toolbar}
      search={<SearchField label={labels.search} value={state.query} onChange={query => update({ query })} />}
      trailing={binding.filters?.length || tree.parkedCount ? <>
        {(binding.filters ?? []).map(filter => <Select key={filter.id} label={filter.label}
          options={[{ id: ANY_VALUE, label: labels.anyValue }, ...filter.options]} value={own(state.filters, filter.id) ?? ANY_VALUE}
          onChange={value => { if (value !== null) update({ filters: { ...state.filters, [filter.id]: String(value) } }); }} />)}
        {tree.parkedCount ? <Switch isSelected={state.showParked} onChange={showParked => update({ showParked })}>{labels.showParked(tree.parkedCount)}</Switch> : null}
      </> : undefined} />
    <CatalogWorkspace items={tree.items} selectedId={entry ? entry.id : null}
      onSelect={id => { const next = { catalog: active.kind, entryId: id }; fromTree.current = selectionKey(next); settleTreeRequest(); select(next); }}
      label={binding.label} defaultExpandedIds={[...(tree.filtering ? tree.expandIds : revealed.folders), ...revealed.leaf]}
      labels={{ browse: labels.browse, preview: labels.preview, inspector: labels.inspector, resizeBrowse: labels.resizeBrowse, resizeInspector: labels.resizeInspector }}
      preview={() => <EntryDetail entry={entry!} catalog={active} catalogs={catalogs} binding={binding} labels={labels} config={config} onSelect={follow} />}
      inspector={() => <Configurator controls={controls} config={config} onChange={configure} noControls={labels.noControls} resetLabel={labels.resetControls} />}
      emptyState={placeholder} browseSize={props.browseSize} inspectorSize={props.inspectorSize} dir={dir} />
  </div>;

  return <section role="region" aria-label={label} dir={dir} className={cx("flex h-full min-h-0 min-w-0 flex-col gap-md text-ink-primary", className)}>
    {catalogs.length > 1 ? <Tabs selectedKey={active.kind} className="min-h-0 flex-1"
      onSelectionChange={kind => { fromTree.current = null; select({ catalog: String(kind), entryId: null }); }}>
      <Tabs.List aria-label={labels.catalogs}>
        {catalogs.map(item => <Tabs.Tab key={item.kind} id={item.kind}>
          <span className="inline-flex items-center gap-xs">{own(kinds, item.kind)!.label} <Badge>{item.entries.length}</Badge></span>
        </Tabs.Tab>)}
      </Tabs.List>
      {catalogs.map(item => <Tabs.Panel key={item.kind} id={item.kind} className="flex min-h-0 flex-1 flex-col">{item.kind === active.kind ? body : null}</Tabs.Panel>)}
    </Tabs> : body}
  </section>;
}
