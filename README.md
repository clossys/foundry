# foundry

A small set of TypeScript packages for validating an npm workspace against
what is actually true of it — not against what its own packages claim about
themselves. This repository is public and MIT licensed; packages publish to
GitHub Packages with visibility decided per package (see Installing, below).

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
| [`@vespeneventures/domain-model`](packages/domain-model) | Dependency-free machinery for product-owned domain models and snapshots: stable identifiers, value types, closed vocabularies, domain types with fields, directed attributed relations, deterministic JSON artifacts, validation, and compatibility comparison. Ships no product values or runtime. |
| [`@vespeneventures/deployment`](packages/deployment) | Deployment-surface contracts, validation, deterministic health summaries, and read-only `./vercel` and `./render` inspectors with caller-injected transport and credentials. Ships no provider configuration, environment reads, raw provider payloads, or mutation capability. |
| [`@vespeneventures/comms`](packages/comms) | Finished communication contracts at the root plus the `./resend` subpath: typed email messages, validation, host-owned consent/policy, atomic dispatch claims with opaque leases, explicit provider acceptance, normalized lifecycle/inbound events, durable ledger ports, strict Resend mapping, idempotency/tag normalization, raw-body Svix verification, and signed delivery/inbound event mapping. Ships no credentials, identities, templates, routes, storage, provider configuration, or environment reads. |
| [`@vespeneventures/catalog`](packages/catalog) | Walks a workspace's `packages/` directory and reports what exists, what could not be read, and whether the real dependency graph — read from each package's own `dependencies`/`peerDependencies` — has cycles or missing internal packages. |
| [`@vespeneventures/gates`](packages/gates) | Orchestrates `catalog` and `policy` into one call, a deterministic build order, and the `foundry-check` CLI. |
| [`@vespeneventures/repository`](packages/repository) | Dependency-free contracts and deterministic validation for consumer-owned repository profiles: default branch, verification commands, and protected path patterns. Ships no repository values, workflows, provider configuration, or native agent state. |
| [`@vespeneventures/release`](packages/release) | Proves a package is actually installable: packs the real tarball, installs it into a genuinely isolated directory, and imports every subpath it claims to export. |
| [`@vespeneventures/tokens`](packages/tokens) | Design tokens for web interfaces: CSS custom properties plus typed JS values, with a brand-binding layer so an interface never ships silently unbranded. |
| [`@vespeneventures/ui`](packages/ui) | React components styled with `@vespeneventures/tokens` via Tailwind CSS v4: 31 atoms, 12 blocks, 4 charts, 2 views, a shell layer, and 32 icon glyphs, across six subpath exports (`./atoms`, `./charts`, `./blocks`, `./views`, `./shell`, `./icons`) — deliberately no root `.` export, so every import names its layer. |
| [`@vespeneventures/voice`](packages/voice) | The verbal contract: a vocabulary for voice rules (person, tense, formality, tone), a glossary of forbidden/preferred terms, and a claims register, plus a checker that scans a piece of copy against them and reports `bound: false` if the record is still an unedited copy of the shipped `./voice-record.template.jsonc`. Ships the machinery only; each consumer binds its own rules, glossary, and claims. |
| [`@vespeneventures/strategy`](packages/strategy) | Upstream strategy machinery, not content: dependency-free validators for facts, mission, positioning, markets, audiences, roadmap, and brand (essence, attributes, derivations), plus a facts-traceability gate and a brand-coverage checker. Ships the schema and checkers; every consumer authors its own values. |
| [`@vespeneventures/copy`](packages/copy) | The vocabulary layer over `@vespeneventures/voice`'s verbal contract: a schema for registering a consumer's own copy as addressable, versioned, reviewable entries, a reader for a consumer's real registry file, and a checker that runs every entry through `voice`'s own `checkCopy`. Also ships a scanner that walks a real source tree for user-facing string/template literals AND raw JSX text nodes, and a traceability gate that fails one that isn't registered, wired into the `copy-check` CLI. Ships no actual copy; every entry a consumer registers is that consumer's own words. |
| [`@vespeneventures/compose`](packages/compose) | The join point where `ui`'s visual vocabulary meets `copy`'s verbal one and `assets`'s visual-registry one, plus everything a specific output channel (`web`, `email`, `print`, `slides`, `image`) needs to know: a `ComposeDocument` names a template, binds its slots to copy ids, asset ids, or literal values, and carries that channel's own metadata. Ships the frozen contract, hand-rolled validation, and slot-resolution logic five separate renderer packages are built against. Zero dependencies, including on `ui`, `copy`, and `assets` themselves — `copyId`, `assetId`, and `template` are opaque string seams, never imports. Renders nothing. |
| [`@vespeneventures/assets`](packages/assets) | The visual-registry layer over `compose`'s `SlotBinding.assetId` seam — the exact same split `copy` draws over `voice`'s verbal contract, one layer over, for images instead of words: a schema for registering a consumer's own images as addressable, versioned, reviewable entries (`AssetEntry`/`AssetRecord`), a reader for a consumer's real registry file, and a coverage check that reports referenced-but-unregistered and registered-but-unreferenced asset ids, wired into the `assets-check` CLI. Ships no actual images and never calls a generation API — every entry a consumer registers is that consumer's own asset. Zero dependencies, including on `compose` itself. |
| [`@vespeneventures/ledger`](packages/ledger) | The return path: an append-only record of what was published, to which channel, when, derived from which revision of strategy, citing which facts. Records outcomes and makes them attributable; carries no opinion about whether an outcome is good, and nothing writes back automatically. Reuses `@vespeneventures/policy`'s content-addressed `PolicyBinding` to bind each cited fact to its value at publication time, and a drift checker (`checkLedgerDrift`) answers whether that value still holds against a caller-supplied current value — without ever importing `@vespeneventures/strategy`. Append-only is enforced two ways: `appendEntry` is the only way to grow a ledger in process (no `updateEntry`/`removeEntry` exists), and `checkAppendOnly` fails closed on any entry removed, reordered, or mutated in two serialized snapshots of one. One runtime dependency (`@vespeneventures/policy`, pinned with a tilde range). |
| [`@vespeneventures/render`](packages/render) | Renderers built against `compose`'s `ComposeDocument` contract, one subpath export per output channel. Ships `./web`: resolves a document's bindings into a named `@vespeneventures/ui` view and emits framework-agnostic head metadata — title, description, canonical, robots, keywords, OpenGraph, Twitter card, and XSS-escaped JSON-LD. `compose` is a real dependency; `react`, `react-dom`, and `ui` are optional peer dependencies of this subpath, the pattern later channels' own heavy dependencies (Puppeteer, `pptxgenjs`, an image library) are meant to follow. Deliberately no root `.` export, matching `ui`'s own convention. |

Each package's own README has the full API and the reasoning behind it.
The cross-package ownership and adoption plan is in
[docs/COMMUNICATIONS.md](docs/COMMUNICATIONS.md).

The table is a source-tree inventory, not a promise that every named package
is available in the registry. Dependent packages publish only after their
runtime siblings, and every such release is proved from an isolated install
of its selected tarball. The required order for the core release graph is
documented in [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Installing

Packages publish to **GitHub Packages**, not the public npm registry.
Installing any GitHub Packages release needs a GitHub token with
`read:packages`, including releases whose package visibility is public. A
private package also requires an account granted access to that package.

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

Packages are private by default; registry availability is a per-package,
per-version fact rather than a property of this public repository. See
[docs/PUBLISHING.md](docs/PUBLISHING.md) for the maintainer process,
dependency order, and the isolated install proof required before publishing.

## Usage

Once `@vespeneventures/gates` is available to your account, it ships a CLI,
`foundry-check`, that walks a workspace's
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
