import { useState } from "react";
import { Badge } from "@clossys/designer/atoms";
import { ResourceList, type ResourceListItem } from "@clossys/designer/blocks";

const notes: ResourceListItem[] = [
  { id: "r1", textValue: "Quarterly planning notes", title: "Quarterly planning notes",
    description: "Shared with the leadership group.", meta: "Edited 2 days ago",
    status: <Badge variant="info">Draft</Badge>, href: "/docs/r1",
    actions: [{ id: "dup", label: "Duplicate", onAction: () => {} },
      { id: "del", label: "Delete note", onAction: () => {}, isDestructive: true }] },
  { id: "r2", textValue: "Vendor onboarding checklist", title: "Vendor onboarding checklist",
    meta: "Edited last week", status: <Badge variant="success">Published</Badge> },
  { id: "r3", textValue: "Archived roadmap", title: "Archived roadmap",
    isDisabled: true, meta: "Read only" },
];

export function Notes() {
  const [selected, setSelected] = useState<"all" | Set<string>>(new Set());
  return <ResourceList aria-label="Notes" items={notes} selectionMode="multiple"
    selectedKeys={selected} onSelectionChange={setSelected}
    selectRowLabel={text => `Select ${text}`} actionsLabel={text => `Actions for ${text}`}
    emptyState={{ title: "No notes yet", description: "Add a note to begin." }}
    bulkBar={<p>Selected notes</p>} footer={<a href="/docs">Browse notes</a>} />;
}

export default Notes;
