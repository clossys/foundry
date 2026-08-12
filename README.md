# foundry

A small set of TypeScript packages for validating an npm workspace against
what is actually true of it — not against what its own packages claim about
themselves. This repository is public and MIT licensed; published package
versions are **public** on GitHub Packages. Some source packages have not yet
been released (see Installing, below).

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
| [`@vespeneventures/auth`](packages/auth) | Provider-neutral authorization primitives with isolated provider and framework subpaths. |
| [`@vespeneventures/policy`](packages/policy) | Content-addressed binding: commit a document's digest publicly without committing the document, then verify later-materialized content matches it byte-for-byte. Zero dependencies, zero I/O. |
| [`@vespeneventures/domain`](packages/domain) | Dependency-free machinery for product-owned domains: stable identifiers, value types, closed vocabularies, domain types with fields, directed attributed relations, deterministic JSON artifacts, validation, and compatibility comparison. Ships no product values or runtime. |
| [`@vespeneventures/deployment`](packages/deployment) | Deployment-surface contracts and read-only provider inspectors with caller-injected transport and credentials. |
| [`@vespeneventures/comms`](packages/comms) | Provider-neutral finished communication contracts and an isolated Resend adapter. |
| [`@vespeneventures/secrets`](packages/secrets) | Provider-neutral secret resolution with injected clients and an isolated Infisical subpath. |
| [`@vespeneventures/governance`](packages/governance) | The package-process authority: lifecycle records and no-write starter planning at its root; workspace catalog, gates, release proof, repository profiles, and review evidence at focused subpaths. |
| [`@vespeneventures/catalog`](packages/catalog) | Deprecated compatibility entry point for `@vespeneventures/governance/catalog`; retained while consumers migrate. |
| [`@vespeneventures/gates`](packages/gates) | Deprecated compatibility entry point for `@vespeneventures/governance/gates`; retains `foundry-check` while consumers migrate. |
| [`@vespeneventures/release`](packages/release) | Deprecated compatibility entry point for `@vespeneventures/governance/release`; retained while consumers migrate. |
| [`@vespeneventures/repository`](packages/repository) | Deprecated compatibility entry point for `@vespeneventures/governance/repository`; retains `repository-check` while consumers migrate. |
| [`@vespeneventures/review`](packages/review) | Deprecated compatibility entry point for `@vespeneventures/governance/review`; retains its GitHub subpath and `review-check` while consumers migrate. |
| [`@vespeneventures/ui`](packages/ui) | The complete visual system: design tokens and theme CSS, icons, accessible React atoms and blocks, charts, shell primitives, and visual quality gates. Token-only consumers use `./tokens` or the CSS subpaths; page compositions live in `surface`. |
| [`@vespeneventures/strategy`](packages/strategy) | Upstream strategy machinery, not content: dependency-free validators for facts, mission, positioning, markets, audiences, roadmap, and brand (essence, attributes, derivations), plus a facts-traceability gate and a brand-coverage checker. Ships the schema and checkers; every consumer authors its own values. |
| [`@vespeneventures/copy`](packages/copy) | The complete language system: voice rules, glossary and claims validation, addressable copy records, templates, source scanning, and traceability checks. Ships machinery only; every consumer owns its actual voice and words. |
| [`@vespeneventures/surface`](packages/surface) | Owns page/document composition, media registries, page-level web views, validation, and renderers for web, email, print, image, and slides. Its explicit subpaths keep channel dependencies separate while releasing the composition contract and its renderers together. |
| [`@vespeneventures/ledger`](packages/ledger) | The return path: an append-only record of what was published, to which channel, when, derived from which revision of strategy, citing which facts. Records outcomes and makes them attributable; carries no opinion about whether an outcome is good, and nothing writes back automatically. Reuses `@vespeneventures/policy`'s content-addressed `PolicyBinding` to bind each cited fact to its value at publication time, and a drift checker (`checkLedgerDrift`) answers whether that value still holds against a caller-supplied current value — without ever importing `@vespeneventures/strategy`. Append-only is enforced two ways: `appendEntry` is the only way to grow a ledger in process (no `updateEntry`/`removeEntry` exists), and `checkAppendOnly` fails closed on any entry removed, reordered, or mutated in two serialized snapshots of one. One runtime dependency (`@vespeneventures/policy`, pinned with a tilde range). |

Each package's own README has the full API and the reasoning behind it.

The cross-package ownership and adoption plan is in
[docs/COMMUNICATIONS.md](docs/COMMUNICATIONS.md).

The table is a source-tree inventory, not a promise that every named package
is available in the registry. Dependent packages publish only after their
runtime siblings, and every such release is proved from an isolated install
of its selected tarball. The required order for the core release graph is
documented in [docs/PUBLISHING.md](docs/PUBLISHING.md).

For the end-to-end boundary between governed strategy, approved copy, UI
primitives, channel surfaces, and consumer-owned publishing, see
[the product delivery pipeline](docs/PIPELINE.md).

## Installing

Packages publish to **GitHub Packages**, not the public npm registry. Installing
from GitHub Packages requires a GitHub personal access token with
`read:packages`, including for publicly visible package versions. Package
availability is still determined by the registry, not by this source-tree
inventory.

Add to your project's `.npmrc` (never commit a real one):

```
@vespeneventures:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

With `GH_PACKAGES_TOKEN` set in your environment, install a published version:

```bash
npm install @vespeneventures/governance
```

The same token is also used for maintainer actions such as publishing. See
[docs/PUBLISHING.md](docs/PUBLISHING.md) for package release status and the
maintainer process.

## Usage

The `governance/gates` subpath ships a CLI, `foundry-check`, that walks a workspace's
`packages/` directory and reports what it finds:

```bash
npx foundry-check --scope @your-scope
```

Exit code `0` means no error-severity finding, `1` means at least one, and
`2` means the check itself could not run (bad input, an unreadable root).

Programmatic use:

```ts
import { runFoundationCheck } from "@vespeneventures/governance/gates";

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
