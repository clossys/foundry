import { useState } from "react";
import { CatalogWorkspace, type CatalogWorkspaceItem } from "@clossys/designer/blocks";

const catalog: readonly CatalogWorkspaceItem[] = [
  { id: "components", label: "Components", kind: "collection", children: [
    { id: "button", label: "Button", kind: "component", badge: "Ready" },
  ] },
];

export function ComponentCatalog() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <CatalogWorkspace items={catalog} selectedId={selectedId} onSelect={setSelectedId}
    label="Component catalog"
    labels={{ browse: "Browse", preview: "Preview", inspector: "Inspector",
      resizeBrowse: "Resize browse", resizeInspector: "Resize inspector" }}
    preview={item => <p>{item.label} preview</p>}
    inspector={item => <p>{item.kind}</p>}
    emptyState={<p>Select a component to preview it.</p>} />;
}

export default ComponentCatalog;
