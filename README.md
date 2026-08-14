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
| [`@vespeneventures/conventions`](packages/conventions) | Account-neutral agent conventions two parties can share without either owning the other: branch provenance, skill naming, agent interoperability, routine declarations, and a capability-first skill registry. Ships the documents as defaults and enforces only their grammar — never byte-identity with its own prose. Every value (accounts, prefixes, cadences, repositories, capabilities) is supplied by the caller, which is what makes it publishable. Zero dependencies, zero I/O. |
| [`@vespeneventures/provisioning`](packages/provisioning) | An idempotent engine for applying a provisioning manifest to a machine and checking whether the machine still agrees with it. Planning is pure and explicit — nothing is inferred, and it owns no manifest of its own; verification reads the destinations rather than the manifest, because a manifest always says the installation is correct. The filesystem is an injected port, so its own tests never touch a real home directory. Zero dependencies. |
| [`@vespeneventures/domain`](packages/domain) | Dependency-free machinery for product-owned domains: stable identifiers, value types, closed vocabularies, domain types with fields, directed attributed relations, deterministic JSON artifacts, validation, and compatibility comparison. Ships no product values or runtime. |
| [`@vespeneventures/deployment`](packages/deployment) | Deployment-surface contracts and read-only provider inspectors with caller-injected transport and credentials. |
| [`@vespeneventures/comms`](packages/comms) | Provider-neutral finished communication contracts and an isolated Resend adapter. |
| [`@vespeneventures/consent`](packages/consent) | A provider-neutral consent record core: versioned policies, tri-state (absent/denied/granted) consent, GPC signal representation, audit events, and host-implemented storage/audit ports. An optional `./web` subpath adds an SSR-safe gate component and preference-management hooks. Makes no claim of legal compliance; carries no jurisdiction logic. Zero runtime dependencies. |
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

### What these packages are not

Two names in the table above mean something narrower here than the word
usually means elsewhere. Both have already cost a consumer real
investigation time before they opened the README and found out:

- **`policy` is not an authorization or access-control engine.** It does
  not decide allow, deny, step-up, or review for anything. It is a
  content-addressed digest-commitment primitive: compute a document's
  digest, commit only the digest, and later verify a materialized copy
  matches it byte-for-byte, without ever committing or transmitting the
  document itself. A codebase can genuinely need both an authorization
  engine and this — they solve unrelated problems, and neither is a
  substitute for the other.
- **`ledger` is not content-distribution or package-export tooling.** It
  is a fact-citation drift checker: an append-only record of what was
  published, citing which strategy facts, and a checker that answers
  whether each cited fact's value still holds against a caller-supplied
  current value. It does not distribute anything and does not export a
  package.

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

**Installing any package here needs a credential.** Packages publish to
**GitHub Packages**, which is the canonical and intended distribution
lane for this repository — not a temporary staging step. GitHub Packages
requires a GitHub personal access token with `read:packages` for every
install, including for a publicly visible package version and a reader
with no other relationship to this org — that is a GitHub Packages
platform behavior, not a permission this repository chose.

The consequence is worth stating plainly rather than leaving a reader to
discover it: a CI job, ephemeral environment, or cloud agent holding no
credential **cannot install from here, and that is not going to change**.
The source is public and the APIs are public; resolution is
authenticated. A consumer authenticates through whichever plane owns its
package credentials. See [issue #213](https://github.com/vespeneventures/foundry/issues/213)
for the decision and [docs/DECISIONS.md](docs/DECISIONS.md#2-the-registry--github-packages)
for the reasoning.

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

### Why not the public npm registry

A migration to `registry.npmjs.org` — which would have made these packages
installable with no `.npmrc` and no token — was planned and then
**cancelled**. This section records that, rather than leaving the question
open for every reader who notices the token requirement and wonders
whether it is an oversight. It is not: it is the chosen trade.

The migration is not deferred, not blocked on anything, and not waiting
for a contributor. Claiming a scope on a shared public namespace is a
first-come registration with no supported way to undo it, and the value it
buys — credential-free install for readers with no relationship to this
org — was judged not worth that irreversible step for a repository whose
consumers all authenticate through a plane that already holds package
credentials. See [issue #213](https://github.com/vespeneventures/foundry/issues/213)
for the decision, and [docs/DECISIONS.md](docs/DECISIONS.md#2-the-registry--github-packages)
for the full reasoning.

One mechanism outlives the decision and is worth knowing about either way:
[`package-scope.json`](package-scope.json) remains the single file
declaring both the scope and the registry, and
`node scripts/set-registry.mjs --check` (`npm run check:registry`, run in
CI as `registry drift`) fails if any package's declared
`publishConfig.registry` drifts from it. That gate matters more under a
settled registry than it did under a pending migration — it is what keeps
twenty packages agreeing on one answer.

### pnpm: a misleading "not found" when the auth token is unset

If you install with pnpm and the environment variable your `.npmrc` auth-token
line references is unset — commonly `NODE_AUTH_TOKEN`, since that is the name
several tools (including GitHub's own `actions/setup-node`) write by default,
even if you named it `GH_PACKAGES_TOKEN` as in the example above — pnpm's
`${VAR}` substitution on that auth-token line fails, and that failure
**silently also disables the `@vespeneventures:registry=` scope mapping on
the line above it**. pnpm then falls through to the public default registry
(`registry.npmjs.org`), which has never heard of `@vespeneventures/*`, and
reports a plain **404 "package not found"** — not an authentication error.
Every fresh local clone that hasn't exported the token yet hits this. If
`pnpm install` reports a `@vespeneventures/<package>` package not found,
check that the auth-token environment variable is actually set in your shell
before assuming the package doesn't exist or isn't published.

### pnpm: a same-day publish can silently stall behind a supply-chain cooldown

If your `pnpm` configuration sets a supply-chain cooldown
(`minimumReleaseAge`), installing a package published from this registry
earlier the same day can stall silently — pnpm just waits out the cooldown
with no error — unless `@vespeneventures` is added to your
`minimumReleaseAgeExclude` list. Add the scope there if you need to consume a
release on the day it publishes.

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
