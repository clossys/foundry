# Inspect the design system

The Designer page is read-only. A coding agent makes every library change through
the designer CLI and skill. The page never calls an adapter save, presents an
editor, applies a choice, or generates a starter. Copying the displayed change
command is a handoff to the agent, not execution of that command.

Hosts use `Studio` from `@clossys/designer/studio`, or `DesignerRoutePage` from
`@clossys/designer/studio/route` with checked consumer data. The complete-page
`DesignerPage` constructor and `SystemCanvas` are private implementation details;
neither is exported from the Studio entry. `DesignerPageProps` remains available
as a data contract for host adapters.

`Studio` and `DesignerRoutePage` mount one canvas and a page-owned right rail,
inside the host's app shell. There are no layer page tabs,
legacy canvases, dock modules, or Designer registrations in the frame's right
panel. The rail contains Explorer, Inspector, Canvas map, Zoom, and Checks;
Checks starts collapsed. Narrow viewports use the existing modal sheet lifecycle.
Rail width and canvas geometry continue to use the installed token contract.

The rows run Frames, Sections, Components, Assets, Tokens. Explorer branches
navigate rather than filter: Layer frames a row; L1 frames a board; L2 centres its
line; L3 centres and selects its cell at the Board stop. The four Zoom stops run
from fitted System to Cell at specimen scale, with free wheel, pinch and slider
zoom between them. The breadcrumb follows the viewport. Selecting a leaf opens
its inspector and highlights its uses and used-by closures. Sections and Frames
stay static on the canvas; their live specimens belong only in the Inspector.

The Inspector presents identity, fill provenance, stack, dependencies,
connections, specimen, checks and write history. The unchanged Usage panel owns
both directed relationship lists and the back stack; a cross-layer reference
moves the same canvas and retains the Inspector. Escape closes selection,
including while the Explorer collection owns keyboard focus.

Hosts may supply `changeCommandFor(leaf)`, `writeHistory(leaf)`, `decisions`, and
`renderStaticThumbnail(leaf)` through `DesignerRoutePage` or `Studio`. History rows
are `{ index, command, contentHash, inputs }`. Missing history shows an empty hint;
a missing command uses `labels.howToChange`. The page consumes these facts only.
Missing static-thumbnail ports retain the pending skeleton. No agent module or
thumbnail producer is imported by the page.

The canonical URL is `?layer=<layer>&node=<tree-id>`; both keys are optional.
`?node=<leaf>` derives its layer, `?layer=X&l1=Y` migrates to `node=Y`, and
`#studio-layer=X` migrates client-side with `history.replaceState`. Unknown layers,
nodes, or query keys are dropped and land at System without an error. Back and
forward navigation use the same resolver. A deep-linked leaf opens its Inspector.

Leaf ids are permanent opaque `<layer>.<slug>` keys, with one dot. L1/L2 paths are
read from today's placement data for labels and navigation; they are never
embedded in a leaf id or used as a replacement identity. Regrouping a leaf changes
its line and breadcrumb without changing its selection, URL, fill, or membership.

The source dogfood report is a diagnostic, not a conformance grant. Unresolved
recognition of reused compositions or token utilities remains a named NEED in
that report; regenerating it proves freshness, not that those findings are clear.
