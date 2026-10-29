# Producer Studio

Read-only Next App Router composition over Producer's cells API. Uses Designer's existing AppFrame with navigation enabled, its account footer hidden, and no right panel. All content comes from same-origin HTTP requests; Studio does not read a consumer repository.

From the repository root, after dependencies and the Controller, Strategist, and Designer prerequisites are built:

```sh
npx next dev packages/producer/studio --hostname 127.0.0.1 --port 4301
npx tsc --project packages/producer/studio/tsconfig.json --noEmit
npx next build packages/producer/studio
```

The build emits Next standalone output. Producer owns the public loopback listener and reverse proxy; packaging owns copying standalone output and static assets. Opening Next directly without Producer shows the cell API error state. Routes: `/`, `/agents/director`, `/agents/designer`, `/agents/writer`, `/agents/publisher`, and `/apps`.

The client adapter validates the aggregate index (`agents` with each agent’s `state`, `tree`, and `cells`) and the selected-cell envelope (`agent`, `state: ready`, and `cell` containing `id`, `version`, `status`, `path`, `fields`, and Markdown `source`). A cell selection is a URL query (`agent` and `cell`), so a selected cell can be bookmarked. Reloading cells fetches the current index and selection. Read-only change events also refresh both. The selected cell shows its actual status and version, including drafts. Agent presentation names do not resolve package identities.

Existing registered Sections used: content, section-header, article, empty-state, and band. Designer's NavigationTree honors grouping from the returned tree; a malformed grouping is an error. Labels use the cell title or leaf name, and Designer badges show status. The first available cell is selected automatically; explicit cell links remain bookmarkable. No new registered leaf is introduced.

The root binds compiler-generated Foundry token CSS before rendering. Producer's `/api/config` supplies the compiled active Designer token cells when available, with the official Foundry theme as the default. Studio applies that CSS without reconstructing token values and refreshes it on cell change events. The existing AppFrame theme provider owns light/dark mode. A failed consumer compilation is reported in the theme configuration and keeps the default bound.

See [the DOM check](checks/README.md) for route coverage and the limits of the Designer subtree assertion. The theme parity check compares the exact compiled CSS hash across two running Studio instances and their built default themes:

```sh
node packages/producer/studio/checks/check-theme-parity.cjs http://127.0.0.1:4300 http://127.0.0.1:4301
```

## Gaps

- Markdown currently appears as escaped source in the existing article Section. Rich cell-specific diagrams, media, and structured previews need an existing matching renderer; no new registered leaves are introduced.
- Apps has an honest unavailable state; no application index API is defined.
- API failures and malformed trees are shown explicitly. No fixtures or filesystem fallback are used.
- NavigationTree is the existing Designer navigation primitive; its shipped row styling remains the Designer package's responsibility.
- Runtime token CSS includes font-family values. Font asset delivery is separate from compiler-generated package imports.
