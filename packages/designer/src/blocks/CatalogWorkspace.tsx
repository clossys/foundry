import { useEffect, useState } from "react";
import { TOKENS } from "../tokens/tokens.js";
import { cx } from "../atoms/internal/cx.js";
import { Panel } from "./Panel.js";
import { ResizablePane } from "./ResizablePane.js";
import { Browse } from "./catalog-workspace/Browse.js";
import { assertCatalogProps, catalogIndex, paneSize } from "./catalog-workspace/model.js";
import type { CatalogWorkspaceProps } from "./catalog-workspace/types.js";

export type { CatalogWorkspaceProps, CatalogWorkspaceItem, CatalogWorkspaceSize } from "./catalog-workspace/types.js";

/** Controlled browse, arbitrary preview and inspector composition; no data fetching or persistence. */
export function CatalogWorkspace(props: CatalogWorkspaceProps) {
  assertCatalogProps(props);
  const { items, selectedId, onSelect, label, labels, preview, inspector, emptyState, defaultExpandedIds, className, dir } = props;
  const index = catalogIndex(items);
  const browseSize = paneSize(props.browseSize);
  const inspectorSize = paneSize(props.inspectorSize);
  const [stacked, setStacked] = useState(true);
  const [browseWidth, setBrowseWidth] = useState(browseSize.defaultValue);
  const [browseHeight, setBrowseHeight] = useState(browseSize.defaultValue);
  const [inspectorWidth, setInspectorWidth] = useState(inspectorSize.defaultValue);
  const [inspectorHeight, setInspectorHeight] = useState(inspectorSize.defaultValue);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(width < ${TOKENS["--breakpoint-tablet-lg"]!.value})`);
    const update = () => setStacked(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const candidate = selectedId === null ? undefined : index.nodes.get(selectedId);
  const selected = candidate?.children === undefined ? candidate : undefined;
  const orientation = stacked ? "horizontal" : "vertical";
  return <section role="region" aria-label={label} dir={dir} className={cx("flex h-full min-h-0 min-w-0 gap-md text-ink-primary", stacked ? "flex-col" : "flex-row", className)}>
    <ResizablePane {...browseSize} step={browseSize.step ?? 16} label={labels.browse} handleLabel={labels.resizeBrowse}
      orientation={orientation} handleEdge="end" value={stacked ? browseHeight : browseWidth} onChange={stacked ? setBrowseHeight : setBrowseWidth}
      className="w-full shrink-0" header={<h3 className="text-body font-body text-ink-primary">{labels.browse}</h3>}>
      <Browse items={items} index={index} selectedId={selectedId} onSelect={onSelect} label={labels.browse} defaultExpandedIds={defaultExpandedIds} />
    </ResizablePane>
    <Panel role="region" aria-label={labels.preview} className="min-h-0 min-w-0 flex-1" header={<h3 className="text-body font-body text-ink-primary">{labels.preview}</h3>}>
      {selected ? preview(selected) : emptyState}
    </Panel>
    <ResizablePane {...inspectorSize} step={inspectorSize.step ?? 16} label={labels.inspector} handleLabel={labels.resizeInspector}
      orientation={orientation} handleEdge="start" value={stacked ? inspectorHeight : inspectorWidth} onChange={stacked ? setInspectorHeight : setInspectorWidth}
      className="w-full shrink-0" header={<h3 className="text-body font-body text-ink-primary">{labels.inspector}</h3>}>
      {selected ? inspector(selected) : null}
    </ResizablePane>
  </section>;
}
