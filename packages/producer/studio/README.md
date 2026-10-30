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

Apps children come from the consumer's canonical Publisher cells or content maps through read-only `/api/apps`. Active publication declarations own additions and removals, so stale compiled maps cannot resurrect a removed app. Change events refresh the same snapshot used by Apps, navigation and commands. Foundry's own Publisher inventory shows Studio's six page cells; other consumers see their own publication cells.

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
- Apps reports missing or malformed consumer publications explicitly; it does not invent app targets.
- API failures and malformed trees are shown explicitly. No fixtures or filesystem fallback are used.
- NavigationTree is the existing Designer navigation primitive; its shipped row styling remains the Designer package's responsibility.
- Runtime token CSS includes font-family values. Font asset delivery is separate from compiler-generated package imports.
