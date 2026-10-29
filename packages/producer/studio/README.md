# Producer Studio

Read-only Next App Router composition over Producer's cells API. Uses Designer's existing AppFrame with navigation enabled, its account footer hidden, and no right panel. All content comes from same-origin HTTP requests; Studio does not read a consumer repository.

From the repository root, after dependencies and the Controller, Strategist, and Designer prerequisites are built:

```sh
npx next dev packages/producer/studio --hostname 127.0.0.1 --port 4301
npx tsc --project packages/producer/studio/tsconfig.json --noEmit
npx next build packages/producer/studio
```

The build emits Next standalone output. Producer owns the public loopback listener and reverse proxy; packaging owns copying standalone output and static assets. Opening Next directly without Producer shows the cell API error state. Routes: `/`, `/agents/director`, `/agents/designer`, `/agents/writer`, `/agents/publisher`, and `/apps`.

The client adapter validates the aggregate index and selected-cell identity. A cell selection is a URL query (`agent` and `cell`), so a selected cell can be bookmarked. Reloading cells fetches the current index and selection. Read-only change events also refresh both. The selected cell shows its actual status and version, including drafts. Agent presentation names do not resolve package identities.

Existing registered Sections used: content, record-detail, article, empty-state, and band. Nested cell links honor grouping from the returned tree when available; a malformed grouping is an error. They are composition inside content, not a new registered leaf.

## Gaps

- Markdown currently appears as escaped source in the existing article Section. Rich cell-specific diagrams, media, and structured previews need an existing matching renderer; no new registered leaves are introduced.
- Apps has an honest unavailable state; no application index API is defined.
- API failures and malformed trees are shown explicitly. No fixtures or filesystem fallback are used.
