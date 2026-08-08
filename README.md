# foundry

A small set of TypeScript packages for validating an npm workspace against
what is actually true of it — not against what its own packages claim about
themselves. This repository is public and MIT licensed; the packages it
publishes are currently **private** on GitHub Packages (see Installing,
below).

**Thesis:** every check here runs against what is actually on disk or
actually installed — never against what a manifest claims about itself. An
earlier design asked every package to self-report its own shape in a block
inside its own `package.json` and validated that block against itself; an
audit found the block was pure restatement of data already sitting a few
lines away, so it was deleted. See [docs/DECISIONS.md](docs/DECISIONS.md)
for the full account.

## Packages

| Package | What it does |
| --- | --- |
| [`@vespeneventures/policy`](packages/policy) | Content-addressed binding: commit a document's digest publicly without committing the document, then verify later-materialized content matches it byte-for-byte. Zero dependencies, zero I/O. |
| [`@vespeneventures/catalog`](packages/catalog) | Walks a workspace's `packages/` directory and reports what exists, what could not be read, and whether the real dependency graph — read from each package's own `dependencies`/`peerDependencies` — has cycles or missing internal packages. |
| [`@vespeneventures/gates`](packages/gates) | Orchestrates `catalog` and `policy` into one call, a deterministic build order, and the `foundry-check` CLI. |
| [`@vespeneventures/release`](packages/release) | Proves a package is actually installable: packs the real tarball, installs it into a genuinely isolated directory, and imports every subpath it claims to export. |
| [`@vespeneventures/tokens`](packages/tokens) | Design tokens for web interfaces: CSS custom properties plus typed JS values, with a brand-binding layer so an interface never ships silently unbranded. |
| [`@vespeneventures/ui`](packages/ui) | React components styled with `@vespeneventures/tokens` via Tailwind CSS v4: 31 atoms, 12 blocks, 4 charts, 2 views, a shell layer, and 32 icon glyphs, across six subpath exports (`./atoms`, `./charts`, `./blocks`, `./views`, `./shell`, `./icons`) — deliberately no root `.` export, so every import names its layer. |
| [`@vespeneventures/voice`](packages/voice) | The verbal contract: a vocabulary for voice rules (person, tense, formality, tone), a glossary of forbidden/preferred terms, and a claims register, plus a checker that scans a piece of copy against them. Ships the machinery only; each consumer binds its own rules, glossary, and claims. |
| [`@vespeneventures/strategy`](packages/strategy) | Upstream strategy machinery, not content: dependency-free validators for facts, mission, positioning, markets, audiences, roadmap, and brand (essence, attributes, derivations), plus a facts-traceability gate and a brand-coverage checker. Ships the schema and checkers; every consumer authors its own values. |
| [`@vespeneventures/copy`](packages/copy) | The vocabulary layer over `@vespeneventures/voice`'s verbal contract: a schema for registering a consumer's own copy as addressable, versioned, reviewable entries, a reader for a consumer's real registry file, and a checker that runs every entry through `voice`'s own `checkCopy`. Also ships a scanner that walks a real source tree for user-facing string/template literals and a traceability gate that fails one that isn't registered, wired into the `copy-check` CLI. Ships no actual copy; every entry a consumer registers is that consumer's own words. |

Each package's own README has the full API and the reasoning behind it.

## Installing

Packages publish to **GitHub Packages**, not the public npm registry, and
are currently **private** — installing needs a GitHub personal access token
with `read:packages` scope, and an account with access granted to this
organization's packages, regardless of whether the repository itself is
public.

Add to your project's `.npmrc` (never commit a real one):

```
@vespeneventures:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

with `GH_PACKAGES_TOKEN` set in your environment. Then, if your account has
been granted access:

```bash
npm install @vespeneventures/gates
```

Nothing here has been published for open, unauthenticated installation yet.
See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the maintainer process and
why packages default to private.

## Usage

The `gates` package ships a CLI, `foundry-check`, that walks a workspace's
`packages/` directory and reports what it finds:

```bash
npx foundry-check --scope @your-scope
```

Exit code `0` means no error-severity finding, `1` means at least one, and
`2` means the check itself could not run (bad input, an unreadable root).

Programmatic use:

```ts
import { runFoundationCheck } from "@vespeneventures/gates";

const report = runFoundationCheck(process.cwd(), { scope: "@your-scope" });
for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
}
if (report.findings.some((f) => f.severity === "error")) process.exitCode = 1;
```

## Developing

```bash
npm install
npm test
npm run build
```

Every package targets Node 20+, ships ESM only, and emits its own type
declarations.

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the day-to-day workflow. Adding
and publishing a package is a separate, maintainer-only process, documented
in [docs/PUBLISHING.md](docs/PUBLISHING.md); the safety machinery that
guards it is described in [SECURITY.md](SECURITY.md). Design decisions —
including why packages publish to GitHub Packages and why an earlier
metadata schema was removed — are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md). Security reports go through
[SECURITY.md](SECURITY.md), not the public issue tracker.

## Licence

MIT.
