# Inspect the design system

The Designer page is read-only. A coding agent makes every library change through
the designer CLI and skill. The page never calls an adapter save, presents an
editor, applies a choice, or generates a starter. Copying the displayed change
command is a handoff to the agent, not execution of that command.

Hosts use `Studio` from `@clossys/designer/studio`, or `DesignerRoutePage` from
`@clossys/designer/studio/route` with checked consumer data. The complete-page
`DesignerPage` constructor is a private implementation detail; it is not
exported from the Studio entry. `DesignerPageProps` remains available as a data
contract for host adapters.

`Studio` and `DesignerRoutePage` mount one vertical scroll and a page-owned right
rail, inside the host's app shell (owner, 2026-10-28: the pan and zoom canvas is
retired). There are no layer page tabs, canvases, dock modules, or Designer
registrations in the frame's right panel. The rail contains Explorer and Checks;
Checks starts collapsed. Narrow viewports use the existing modal sheet lifecycle.
Rail width continues to use the installed token contract.

The scroll shows the active layer's boards top to bottom. Every board is the
registered `sections.comparison@library-board` Section, a page block with its own
anchor (`#designer-board-<board>`). Rows evaluate as they scroll into view, never
all at once. The Explorer's layer select switches the layer; an Explorer branch or
leaf scrolls its board or row into view and never filters. Selecting a row's
cell selects that leaf. Nothing on the page writes.

The canonical URL is `?layer=<layer>&node=<tree-id>`; both keys are optional.
`?node=<leaf>` derives its layer, `?layer=X&l1=Y` migrates to `node=Y`, and
`#studio-layer=X` migrates client-side with `history.replaceState`. Unknown layers,
nodes, or query keys are dropped and land on the default layer without an error. Back and
forward navigation use the same resolver. A deep-linked leaf scrolls its row into view.

Leaf ids are permanent opaque `<layer>.<slug>` keys, with one dot. L1/L2 paths are
read from today's placement data for labels and navigation; they are never
embedded in a leaf id or used as a replacement identity. Regrouping a leaf changes
its board without changing its selection, URL, fill, or membership.

The source dogfood report is a diagnostic, not a conformance grant. Unresolved
recognition of reused compositions or token utilities remains a named NEED in
that report; regenerating it proves freshness, not that those findings are clear.
