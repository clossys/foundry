# Explorer and the shared tree model

`Explorer` is the interactive file and folder browser in `@clossys/designer/blocks`.
Supply a `tree` and an accessible `label`. A node has a stable `id`, a `label`, an
optional `icon`, an optional `href` or `onSelect` callback, and optional `children`.
The presence of `children` identifies a folder, including an empty folder.
Default folders and files use distinct Designer Icon components. Custom icons are
decorative content; the label remains the row's accessible name.

```tsx
<Explorer
  label="Project files"
  tree={[
    { id: "assets", label: "Assets", children: [
      { id: "logo", label: "Logo", href: "/files/logo" },
    ] },
  ]}
  selectedId={selectedId}
  onSelect={setSelectedId}
  defaultExpandedIds={["assets"]}
/>
```

Selection is controlled and single for files and folders. Activating a row requests
its exact ID through `onSelect` and invokes its own selection callback when provided.
An `href` remains a native link. Activating a folder also toggles its disclosure. Arrow
Up/Down move through visible preorder; Home/End move to its boundaries. Right
opens a closed folder or enters its first child; Left closes an open folder or
moves to its parent. Enter and Space activate the focused row. Focus movement
and arrow disclosure do not change selection. The tree owns one tab stop and
preserves focus across host selection changes; removal of the focused node
recovers to an available row.

Depth is unrestricted. Every ancestor receives a token-colored branch guide;
visual indentation stops growing after six steps to keep deep labels inside the
pane. Semantic levels, disclosure and keyboard traversal retain the full depth.
The pane allows horizontal scrolling if its supplied content still requires it.
`renderDetails` supplies descriptive metadata separately from each row's name.

`indexTree`, `getTreeAncestry` and `getTreeBreadcrumbs` share validation and preserve
caller objects and IDs. IDs and labels must be nonempty; duplicate IDs, repeated
references, cycles, sparse lists and ambiguous destinations throw `TypeError`.
Indexing and ancestry use iterative traversal. `maxDepth` and `maxNodes` are
optional positive integer validation parameters; neither is set by Explorer.
Ancestry uses exact IDs or hrefs, with an explicit ID taking precedence. Breadcrumbs
contain only `id`, `label`, and an optional `href`.

Custom metadata types must give `children` the same recursive node type. Typed
details and ancestry then retain that metadata for every descendant. Ordinary
inline trees use the base `TreeNode` shape without assuming extra metadata.

`AppNavigation` uses this model with `maxDepth: 2` and requires a destination or
nonempty children. Its existing `onAction` callback and icon/link API are retained,
as are its rendering and two-level limit. `CatalogWorkspace` composes Explorer for
browsing and retains its metadata, leaf-only controlled selection and original
objects for preview and inspector slots. The [documented CatalogWorkspace node bound](../../packages/designer/README.md#catalogworkspace)
limits size; it imposes no depth limit.
