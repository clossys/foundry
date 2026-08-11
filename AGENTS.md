# AGENTS.md

This repository is **public**. Everything committed here is world-readable and
permanently so — assume anything pushed is cached and indexed even if later
deleted.

This repository intends every package it ships to be safely publishable to
a public, external audience. The single most important rule follows from
that:

> Nothing enters this repository without passing `scripts/check-public-safety.mjs`
> in FULL mode.

## Before you commit

```bash
PUBLIC_SAFETY_DENYLIST=~/.config/public-safety/denylist-foundry.json npm run check
```

That runs, in order: scope drift, gate regression tests, the publish-safety
gate, typecheck, tests.

**Set `PUBLIC_SAFETY_DENYLIST` explicitly.** There is no on-disk default the
gate falls back to — `--denylist` and `$PUBLIC_SAFETY_DENYLIST` are the only
two ways in, on purpose: a generic fallback file is exactly what would let a
machine also working with another repository's denylist silently scan against
the *wrong* file (same name, different terms) and report a confident FULL-mode
pass that never actually checked. Without either set, the gate now visibly
degrades to PARTIAL mode instead — identity checks skipped, a banner printed,
never a bare pass. CI is unaffected — it always materializes
`PUBLIC_SAFETY_DENYLIST_B64` into this same env var explicitly before every
gate runs.

## What the safety gate refuses

Credential-shaped strings, committed build output, agent-instruction files, and
private identity — names, domains, handles, internal paths, and client or
personal names that must never become public. Read [SECURITY.md](SECURITY.md)
for the full rule set, the one deliberate exemption to it, and for why the
denylist is stored outside this repository.

The gate degrades to PARTIAL mode when it cannot load a denylist. **A partial
pass is not a clearance.** Before any publish, run:

```bash
npm run preflight -- packages/<name>
```

which runs every gate — including the tarball-content scan and the name-collision
check — and fails rather than degrades.

## Cloud sessions

Codex Cloud and Claude remote sessions use the same repository contract: run
`npm run agent:cloud:bootstrap`, then `npm run agent:cloud:check`, before
scoped repository checks. Cloud sessions do not receive the public-safety
denylist or publication credentials, so they may not produce a FULL clearance
or publish packages.

## Working rules

- **Never commit a `dist/`, `build/` or `.next/` directory.** Build output
  can embed resolved local paths and other detail from wherever it was
  compiled, which is exactly why it's gitignored. Copy `src/` and rebuild
  here.
- **Write a fresh `CHANGELOG.md` rather than reusing one written
  elsewhere.** A changelog carried over from somewhere else can cite pull
  requests, issues, and people that mean nothing — or worse, disclose
  something private — to a reader here. Start fresh, at the package's real
  version (see [docs/PUBLISHING.md](docs/PUBLISHING.md) — currently `0.1.0`
  for every package here).
- **Never copy agent instructions from another repository.** Root `AGENTS.md`
  is the canonical public policy and root `CLAUDE.md` may only import it as a
  thin compatibility loader. Both are content-scanned. Nested agent instruction
  files remain forbidden.
- **No `workspace:*` or `catalog:` dependency protocols.** They only resolve
  inside an npm/pnpm workspace and cannot resolve for a normal external
  installer. Pin real semver ranges.
- **When importing a package, scrub prose first — then check for what no rule
  catches.** Doc comments and README prose describing internal systems are the
  obvious kind. Also check for: internal-convention DOM/data attributes
  rendered into markup (a real one shipped once as `data-acme-internal-id`
  before being caught and renamed); dangling citations to docs that don't ship here;
  stats about the private codebase's shape; and — the sharpest one — whether
  the code silently depends on a private design-token package or other
  unpublished runtime state, which no denylist can see because it isn't a
  string, it's a missing dependency. See [docs/PUBLISHING.md](docs/PUBLISHING.md).
- **The publishing scope lives in exactly one file:** `package-scope.json`.
  Never hardcode a scope anywhere else; run `node scripts/set-scope.mjs` after
  changing it.
- **Before publishing, always run name-collision checking.** GitHub Packages
  namespaces by owner account, not repository — a name that collides with
  something else this org already owns does not fail, it silently appends a
  version and moves `latest`. `scripts/check-name-collision.mjs` (wired into
  `preflight-package.mjs` and `publish.yml`) is the gate for this; it should
  never legitimately fire here (this org's whole purpose is a clean namespace)
  but a firing gate is cheaper than the alternative.

## Adding a package

Follow [`docs/PUBLISHING.md`](docs/PUBLISHING.md). It is written as a checklist
because the failure mode — publishing something private — is not reversible.
