/** Compile contracts belong outside *.test.tsx so the package's real tsc run checks them. */
import { Explorer, type ExplorerProps } from "./Explorer.js";
import { indexTree, getTreeAncestry, getTreeBreadcrumbs, type TreeNode } from "./tree-model.js";
import type { AppNavigationNode } from "./app-navigation-tree.js";
import type { CatalogWorkspaceItem } from "./catalog-workspace/types.js";

interface MetadataNode extends TreeNode {
  kind: string;
  children?: readonly MetadataNode[];
}
const metadata: readonly MetadataNode[] = [{ id: "folder", label: "Folder", kind: "folder", children: [{ id: "file", label: "File", kind: "file" }] }];
export const recursiveMetadata: ExplorerProps<MetadataNode> = { tree: metadata, label: "Files", renderDetails: node => node.kind };
export const indexedMetadata = indexTree(metadata).nodes.get("file")?.kind;
export const metadataAncestry = getTreeAncestry(metadata, { id: "file" }).map(node => node.kind);

type RootOnlyMetadata = TreeNode & { kind: string };
const rootOnly: readonly RootOnlyMetadata[] = [{ id: "folder", label: "Folder", kind: "folder", children: [{ id: "plain-child", label: "Plain child" }] }];
// @ts-expect-error A callback cannot assume metadata that the child type does not require.
export const unsafeDetails: ExplorerProps<RootOnlyMetadata> = { tree: rootOnly, label: "Files", renderDetails: node => node.kind };
// @ts-expect-error An index must not claim that every descendant has root-only metadata.
export const unsafeIndex = indexTree<RootOnlyMetadata>(rootOnly);
const implicitIndex = indexTree(rootOnly);
// @ts-expect-error Plain-tree fallback must not promise root-only metadata on descendants.
export const unsafeImplicitIndexKind = implicitIndex.nodes.get("plain-child")?.kind;
const implicitAncestry = getTreeAncestry(rootOnly, { id: "plain-child" });
// @ts-expect-error Ancestry fallback also returns plain TreeNode records.
export const unsafeImplicitAncestryKind = implicitAncestry.at(-1)?.kind;
// @ts-expect-error Inferred Explorer metadata must be guaranteed on every descendant.
export const unsafeImplicitDetails = <Explorer tree={rootOnly} label="Files" renderDetails={node => node.kind} />;

export const defaultNodes: ExplorerProps = { tree: [{ id: "folder", label: "Folder", children: [{ id: "file", label: "File" }] }], label: "Files" };
export const inlineNested = <Explorer label="Files" tree={[{ id: "folder", label: "Folder", children: [{ id: "file", label: "File" }] }]} />;
const plainNested = [{ id: "folder", label: "Folder", children: [{ id: "file", label: "File" }] }];
export const plainIndex = indexTree(plainNested);
export const plainAncestry = getTreeAncestry(plainNested, { id: "file" });
export const plainBreadcrumbs = getTreeBreadcrumbs(plainNested, { id: "file" });
const navigation: readonly AppNavigationNode[] = [{ id: "folder", label: "Folder", children: [{ id: "file", label: "File", href: "/file" }] }];
const catalog: readonly CatalogWorkspaceItem[] = [{ id: "folder", label: "Folder", kind: "folder", children: [{ id: "file", label: "File", kind: "file" }] }];
export const navigationIndex = indexTree(navigation);
export const catalogExplorer = <Explorer tree={catalog} label="Catalog" renderDetails={node => node.kind} />;
