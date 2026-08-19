# @vespeneventures/integrator

The machinery a consuming plane runs against **itself** to answer one
question: does this plane hold what it declared it holds, and is it current?
Enrollment, versions, admission, vendoring, reachability — the whole question
of whether a plane actually has what it installed.

```bash
npm install @vespeneventures/integrator
```

## The job

A plane declares what catalogue it is entitled to. Separately, and offline
from that declaration, it can read its own manifest and lockfile to see what
it actually has. This package is the mechanism that compares the two and
reports the difference — never the list of which planes exist.

## The blindness rule

This repository has no visibility into who installs its packages and must not
acquire any. Nothing here is a registry of consumers: there is no account
name, no repository name, and no consumer list anywhere in this package's
source, tests, or docs. Every value in its API is caller-supplied — the
entitlement declaration, the manifest and lockfile content, the registry
transport, all of it. The plane owns its inventory; this package owns the
mechanism it runs against that inventory.

## The metric

**Currency**: the share of entitled packages installed and at the latest
published version — plus, reported separately, the count that are entitled,
absent, and have no recorded opt-out.

The two counts are reported separately, not combined into one number, because
they are different problems. A low currency share says a plane is behind. A
nonzero absent-without-reason count says a plane has drift nobody decided —
an absence with a recorded reason is a decision; an absence with none is
just something nobody got around to, and until now the two were
indistinguishable.

The loop this closes: **aim** — a plane holds exactly the catalogue it is
entitled to, current. **sense** — read the plane's own manifest, lockfile, and
the registry it authenticates against. **judge** — `current` / `behind` /
`absent-with-reason` / `absent-without-reason` / `unreachable` /
`unauthenticated`. **act** — emit the upgrade set and the opt-out gaps.
**learn** — a package many planes opt out of is a catalogue problem, and the
recorded opt-out reasons are the evidence. The loop closes when
`currencyShare` is `1` and `absentWithoutReasonCount` is `0`: every
entitlement is installed at the latest version, and every gap left is a
decision on record, not silence.

**Close condition, for a consuming plane's currency gate:** this loop closes
when a plane's currency gate is wired to `judgeCurrency`'s ternary and reports
green for exactly one of two reasons — every entitled package reads
`current`, or every remaining gap reads `absent-with-reason` — and never
green because a subset of the catalogue was never evaluated in the first
place. `computeCurrencyMetric`'s `absentWithoutReasonCount` has no path to
zero by silence; a plane that wants that shortcut has to build it outside
this package's contract, because nothing in `judgeCurrency` will manufacture
it. The loop reopens on any drift a gate now catches that the consuming
plane previously had to write its own evaluation logic to find.

**Open honestly:** issue #330 is a real, currently open gap in that wiring.
`readInstalledInventory` reads only an npm-shaped lockfile, so a pnpm-based
consumer building this same gate had to hand-write its own roughly
sixty-line `InstalledInventory` reader against `pnpm-lock.yaml` rather than
get one from this package — everything downstream of inventory-reading
(`judgeCurrency`, `upgradeSet`, `optOutGaps`, `computeCurrencyMetric`) worked
for that consumer unmodified; only the lockfile-reading half didn't. That
consumer's loop is closed today, but on its own inventory reader, not on
this package's. Until #330 lands, that is the honest state of this
close condition for a pnpm-based plane, not a gap this section will paper
over.

## Usage

```ts
import {
  loadEntitlementDeclaration,
  readInstalledInventory,
  createNodeInventoryFileSystem,
  probeReachability,
  resolveReachability,
  judgeCurrency,
  upgradeSet,
  optOutGaps,
  computeCurrencyMetric,
} from "@vespeneventures/integrator";

// 1. What this plane is entitled to, and what it has decided not to install.
const declaration = loadEntitlementDeclaration(JSON.parse(rawEntitlementJson));

// 2. What this plane actually has, read from its own files.
const fs = createNodeInventoryFileSystem();
const installed = readInstalledInventory(fs, {
  manifestPath: "./package.json",
  lockfilePath: "./package-lock.json",
});

// 3. Ask the registry this plane authenticates against for the latest
//    version of every entitled package. `fetch` is never called directly --
//    the caller supplies the transport, which is what makes this testable
//    without a network and usable against any registry.
const outcomes = await probeReachability(
  declaration.entitlements.map((e) => e.name),
  { transport: fetch, registryBaseUrl: myRegistryUrl },
);
const reachability = resolveReachability(outcomes);

// 4. Judge every entitlement.
const statuses = judgeCurrency({ declaration, installed, reachability });

console.log(computeCurrencyMetric(statuses));
// { entitledCount, currentCount, absentWithoutReasonCount, currencyShare }

console.log(upgradeSet(statuses)); // what to install to close the gap
console.log(optOutGaps(statuses)); // entitled, absent, unexplained
```

## Entitlement and opt-outs

```jsonc
{
  "version": 1,
  "entitlements": [{ "name": "@example-scope/one" }, { "name": "@example-scope/two" }],
  "optOuts": [
    {
      "name": "@example-scope/two",
      "reason": "Not applicable to this plane's runtime.",
      "recordedOn": "2026-08-01"
    }
  ]
}
```

`loadEntitlementDeclaration` validates this offline — no file read, no
network call — and throws on the first problem: a duplicate entitlement, an
opt-out for a package the plane isn't even entitled to, or an opt-out with an
empty `reason`. The reason is required, not optional, because a recorded
reason is the only thing that turns an absence into a decision.

## Installed-inventory reader

`readInstalledInventory` reads a plane's manifest and lockfile through an
injected `InventoryFileSystemPort`, following
[`@vespeneventures/provisioning`](https://github.com/vespeneventures/foundry/tree/main/packages/provisioning)'s
injected-port pattern — this package never opens a file itself.
`createNodeInventoryFileSystem()` is the default, real-filesystem adapter; a
test, or a caller reading from somewhere other than disk, supplies its own.

A package declared in the manifest with no matching resolution in the
lockfile is not reported as installed. That is deliberate: a declared range
with nothing actually resolved is, from this reader's point of view, not
present, and it is left to `judgeCurrency` to decide whether that counts as a
recorded decision or drift.

## Reachability probe

`probeReachability` takes an injected `Transport` — never a real `fetch`, in
this package or in its own tests — and returns a raw `ProbeOutcome` per
package: `known`, `not-found`, `denied`, or `unreachable`.

`resolveReachability` turns those into the three verdicts `judgeCurrency`
actually consumes. This is where the harder of the package's two central
distinctions is decided.

**`unreachable` vs `unauthenticated`.** An install that fails for want of a
credential must never read as "not entitled" or "not published". Some
registries answer `404`, not `403`, for a package the calling credential
cannot see — deliberately, so as not to confirm a private package's existence
to a caller who isn't allowed to know about it. That makes a single `404`
genuinely ambiguous: never-published and credential-blind look identical.
Resolved per package that ambiguity is unrecoverable, but resolved in
**aggregate across a whole probed batch it is not** — if every lookup in a
batch comes back `404`, a credential that lost its read scope explains that
far better than an entire entitled slice of the catalogue having never been
published, so every `404` in that batch resolves to `unauthenticated`. If at
least one lookup in the batch comes back `known`, the credential is proven to
work, and a lone `404` alongside it stays genuinely undecidable — it resolves
to `unreachable` rather than being guessed at in either direction. This
mirrors `scripts/check-package-visibility.mjs`'s own reasoning in this
repository, applied to the installer side instead of the publisher side. An
explicit `401`/`403`, and a transport failure or malformed response, are
never subject to this aggregation: they resolve straight through as
`unauthenticated` and `unreachable` respectively, because those two ARE the
distinction being protected.

## Version reconciler

`judgeCurrency` combines the entitlement declaration, the installed
inventory, and the resolved reachability verdicts into exactly the six
required states, and reports every entitlement — it never stops at the
first problem, because a drift report is only useful complete.

`PackageCurrency` is a discriminated union, one variant per state, each
carrying only the fields that state can truthfully report: `behind` is the
only variant with a `latestVersion`, `absent-with-reason` is the only one
with a `reason`. A plain `{ state: string, ...everythingOptional }` shape
would let a bug construct `{ state: "current", reason: "..." }` and have it
silently type-check; this shape does not allow that object literal to exist
at all, which is what "enforced in the types" means here rather than only in
review.

Absence is judged **before** reachability is even consulted: whether a
package is installed, and whether its absence has a recorded reason, are both
facts a plane already holds about itself offline. Only `current` vs `behind`
needs the registry, which is exactly the shape the blindness rule demands —
the parts of this judgment that don't need the network don't touch it.

`upgradeSet` and `optOutGaps` are the loop's **act** step: the first is every
`behind` entry with what to upgrade to, the second is every entitled,
absent, unexplained package name.

## Admission contract

`AdmissionContract` declares what a candidate package must satisfy before a
plane admits it. Every rule composes with what this package already models —
the entitlement declaration and the reachability verdicts a caller has
already computed — rather than inventing new external data:

| Rule | Finds |
| --- | --- |
| `must-be-entitled` | the candidate is not in the entitlement declaration |
| `must-not-be-opted-out` | the candidate has a recorded opt-out |
| `requires-known-reachability` | the candidate has no confirmed reachable registry entry |
| `minimum-version` | the candidate is below a caller-declared version floor |

`evaluateAdmission` is pure and offline given that context — an empty result
means admitted, and every rule is evaluated independently, so a candidate
failing two rules reports both.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `loadEntitlementDeclaration(raw)` | function | Validates a parsed entitlement declaration offline. Throws on a duplicate, an invalid name, or an opt-out with no reason |
| `readInstalledInventory(fs, options)` | function | Reads a plane's manifest and lockfile through the injected port. Reports only what actually resolves |
| `createNodeInventoryFileSystem()` | function | The default `InventoryFileSystemPort`, backed by `node:fs` |
| `probeReachability(names, options)` | function | Probes an injected `Transport` for each name's latest published version. Never touches a real network itself |
| `resolveReachability(outcomes)` | function | Resolves raw probe outcomes into `known` / `unauthenticated` / `unreachable`, applying the aggregate 404 rule |
| `judgeCurrency(input)` | function | Combines entitlement, inventory, and reachability into `PackageCurrency[]` — one of the six required states per entitlement |
| `upgradeSet(statuses)` | function | Every `behind` entry, as `{ name, installedVersion, latestVersion }` |
| `optOutGaps(statuses)` | function | Every `absent-without-reason` package name |
| `computeCurrencyMetric(statuses)` | function | This package's stated metric: `currencyShare`, `entitledCount`, `currentCount`, `absentWithoutReasonCount` |
| `loadAdmissionContract(raw)` | function | Validates a parsed admission contract offline. Rejects an unknown rule kind, a duplicate rule, or an unparseable `minimum-version` floor |
| `evaluateAdmission(contract, candidate, context)` | function | Evaluates a candidate against a contract. Empty result means admitted |
| `parseVersion(value)` / `compareVersions(a, b)` | function | A minimal, dependency-free semantic-version parser and comparator |
| `IntegratorValidationError` | class | Thrown by every offline validator in this package, carrying a stable `IntegratorErrorCode` |
| `isValidPackageName(value)` | function | The one package-name check every module in this package shares |
| `EntitlementEntry` / `OptOutEntry` / `EntitlementDeclaration` | types | The entitlement schema |
| `InventoryFileSystemPort` / `InventorySourceOptions` / `InstalledPackage` / `InstalledInventory` | types | The installed-inventory reader's contracts |
| `Transport` / `ProbeOutcome` / `ReachabilityProbeOptions` / `ReachabilityVerdict` | types | The reachability probe's contracts |
| `PackageCurrency` / `JudgeCurrencyInput` / `UpgradeSetEntry` / `CurrencyMetric` | types | The version reconciler's contracts, including the six required states |
| `AdmissionRule` / `AdmissionContract` / `AdmissionCandidate` / `AdmissionContext` / `AdmissionFinding` | types | The admission contract's schema |
| `ParsedVersion` | type | `{ major, minor, patch, prerelease }` |
| `IntegratorErrorCode` | type | Stable error-code union for `IntegratorValidationError` |

## What it is not

It ships no registry of consumers and never will — see "The blindness rule"
above. It also does not install, upgrade, or write anything: every module
here reads and judges. Applying an upgrade set to a plane's own manifest is
that plane's own decision, made with its own tooling.

## Requirements

Node.js >= 20. No runtime dependencies.

## Licence

MIT
