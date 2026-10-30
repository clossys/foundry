# Producer Studio

Read-only Next App Router composition over Producer's cells API. The frame, sections and controls load from the consumer's emitted Designer selection, with navigation enabled, the account footer hidden, and no right panel. All content comes from same-origin HTTP requests; Studio does not read a consumer repository.

From the repository root, after dependencies and the Controller, Strategist, and Designer prerequisites are built:

```sh
npx next dev packages/producer/studio --hostname 127.0.0.1 --port 4301
npx tsc --project packages/producer/studio/tsconfig.json --noEmit
npx next build packages/producer/studio
```

The build emits Next standalone output. Producer owns the public loopback listener and reverse proxy; packaging owns copying standalone output and static assets. Application content waits for Producer's compiled theme and runtime, so opening Next directly requires the same API.

Foundry authors Studio's publication as ordinary Publisher cells in `clossys/agents/publisher`. The CELL-P compiler projects its route pack, and Publisher projects navigation, commands and breadcrumbs from that same content map. `generate:studio-map` writes the checked data and bindings to real view exports under `studio/generated`; the generic App Router entry dispatches only those projected routes. Producer's build and Next's build both regenerate the projection. Installed consumers use the prebuilt projection and do not supply a replacement Studio map.

The four agent pages author identical bodies in `clossys/agents/publisher/cells/page.{director,designer,writer,publisher}/v1.md`, in `## Body` after Actions and before Route. Each declares Publisher's `ia-scroll` template, the L0/L1 section-header bands, the L2 `sections.cards` band, and the ordered row columns `title`, `specimen`, `status`, `version`, `usedBy`, `linkOut`. Every L2 is a cards grid and every L3 cell is one card. The authored `row.specimen` port stays omitted until the caller provides the exact Designer specimen leaf ID. Home has no body declaration and uses its own stub.

A card's header carries `title`, `status`, `version`, `usedBy`, and `linkOut`; its body carries the whole bound specimen. The selected Designer specimen leaf owns its `span` metadata (`full`, `half`, or `third`). The H2 row template reads that metadata through the bound `row.specimen` ID to size cards in the grid, with every card full width on mobile; SF-CONSUME checks the binding. Publisher does not author or infer widths from agents or layers. H2 owns grid rendering, clamping, link-out, and Source disclosure behavior. This projection adds no UI implementation.

`studio/generated/studio-map.ts` exposes `studioPageBodies` from those native map fields and `studioPageBody(pageId, boundSpecimenId)` through Publisher's public `projectPageBody` API. `ContentMapPageBody` and `ContentMapProjectedBody` are available as type-only exports from the same generated module. H2 / SF-CONSUME consumers pass the already bound `sections.specimen-*` leaf for each L3 cell; this projection does not infer a leaf from an agent, layer, or cell kind. Publisher rejects unresolved, malformed or conflicting specimen bindings and pages without bodies. Designer owns specimen registration and runtime resolution; Publisher validates the native body shape and binding syntax.

Run `npm run check:studio-map -w @clossys/producer` to check cell/projection drift and reject independent navigation, command or route literals in production Studio source. Tests include duplicate-list and cell-change mutations.

The client adapter validates the aggregate index (`agents` with each agent’s `state`, `tree`, and `cells`) and the selected-cell envelope (`agent`, `state: ready`, and `cell` containing `id`, `version`, `status`, `path`, `fields`, and Markdown `source`). A cell selection is a URL query (`agent` and `cell`), so a selected cell can be bookmarked. Reloading cells fetches the current index and selection. Read-only change events also refresh both. The selected cell shows its actual status and version, including drafts. Agent presentation names do not resolve package identities.

Existing registered Sections used: content, section-header, article, empty-state, and band. Designer's NavigationTree honors grouping from the returned tree; a malformed grouping is an error. Labels use the cell title or leaf name, and Designer badges show status. The first available cell is selected automatically; explicit cell links remain bookmarkable. No new registered leaf is introduced.

The root fetches the consumer's compiler-generated token CSS from `/api/config` before rendering application content. A consumer without active brand cells receives the official Foundry theme and a visible Unbranded notice. Studio applies compiler CSS without reconstructing token values. The selected frame owns light/dark mode.

Producer emits the consumer's selected components and surfaces, bundles their actual implementation modules, and compiles their utility CSS with Designer's existing compiler. Missing seats use Designer's default planners; the Designer page lists each fallback as a NEED. Studio applies the runtime and verified stylesheet together. Cell change events refresh both theme and selected implementations.

Agent specimens can use `useStudioSelection()` for the actual emitted `runtime.components` and `runtime.surfaces` namespaces plus the `profile` resolved from the same selection. Producer serves that profile through `selection.profileUrl` in `/api/config`; Studio validates its selection hash and loads it with the runtime and CSS.

Raw cell files are read-only and appear only inside the secondary Source disclosure, closed by default. The disclosure is reusable by agent-specific specimen views.

See [the DOM check](checks/README.md) for selection, NEED, control ownership and subtree coverage. The theme check compares each running Studio's applied CSS hash and computed tokens with that consumer's compiled theme. The fixture option requires two different brands:

```sh
node packages/producer/studio/checks/check-theme-parity.cjs --require-different http://127.0.0.1:4300 http://127.0.0.1:4301
```

## Gaps

- Agent-specific specimens are separate from the shell's Source disclosure.
- API failures and malformed trees are shown explicitly. No fixtures or filesystem fallback are used.
- NavigationTree is the existing Designer navigation primitive; its shipped row styling remains the Designer package's responsibility.
- Runtime token CSS includes font-family values. Font asset delivery is separate from compiler-generated package imports.
