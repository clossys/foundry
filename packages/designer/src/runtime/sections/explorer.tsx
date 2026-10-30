import { useState, type ReactNode } from "react";
import { Explorer } from "../../blocks/Explorer.js";
import { GridList } from "../../components/GridList.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput, type SelectionRecord } from "./group-b-support.js";

/** One tree node record: an id, a label and, for a folder, its children. */
export interface TreeNodeRecord { readonly id: string; readonly label: string; readonly href?: string; readonly children?: readonly TreeNodeRecord[]; readonly externalAction?: { readonly href: string; readonly label: string } }
/** The consumer resolves its selected asset; labels and destinations stay in the tree content. */
export interface ExplorerSectionHost { readonly externalActionIcon?: ReactNode }
/** The tree region: Explorer's own tree data, with the folders open at first. */
export interface TreeRegionContent { readonly label: string; readonly nodes: readonly TreeNodeRecord[]; readonly expanded?: readonly string[] }
/** The list region: the records shown beside the tree, rendered as a GridList. */
export interface ListRegionContent { readonly label: string; readonly items: readonly { readonly id: string; readonly label: string }[] }

function ExplorerFill({ tree, list, selected, externalActionIcon }: { readonly tree: TreeRegionContent; readonly list?: ListRegionContent; readonly selected?: string; readonly externalActionIcon?: ReactNode }) {
  const [selectedId, setSelected] = useState(selected ?? null);
  return <Explorer
    tree={tree.nodes}
    label={tree.label}
    selectedId={selectedId}
    onSelect={setSelected}
    defaultExpandedIds={tree.expanded}
    externalAction={node => {
      if (!node.externalAction) return undefined;
      if (externalActionIcon == null || externalActionIcon === false) throw new TypeError("sections.explorer externalAction requires the host's selected externalActionIcon");
      return { ...node.externalAction, icon: externalActionIcon };
    }}
    listLabel={list?.label}
    list={list ? <GridList aria-label={list.label} items={list.items}>{item => <GridList.Item id={item.id} textValue={item.label}>{item.label}</GridList.Item>}</GridList> : undefined}
  />;
}

/** sections.explorer: a navigable tree beside a GridList pane; the first selection record selects a node. */
export function renderExplorer(input: SectionRenderInput) {
  const tree = entryOf<TreeRegionContent>(input, "tree") ?? { label: "Files", nodes: [] };
  return <ExplorerFill tree={tree} list={entryOf<ListRegionContent>(input, "list")} selected={recordsOf<SelectionRecord>(input, "selection")[0]?.id} externalActionIcon={input.sectionHost?.externalActionIcon as ReactNode} />;
}

export const explorerSection: GroupBSection = { leaf: "sections.explorer", slots: ["list", "selection", "tree"], render: renderExplorer };
