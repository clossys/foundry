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
`unauthenticated` / `indeterminate`. **act** — emit the upgrade set and the
opt-out gaps.
**learn** — a package many planes opt out of is a catalogue problem, and the
recorded opt-out reasons are the evidence. The loop closes when
`currencyShare` is `1` and `absentWithoutReasonCount` is `0`: every
entitlement is installed at the latest version, and every gap left is a
decision on record, not silence.

**Close condition, for a consuming plane's currency gate:** this loop closes
when a plane's currency gate is wired to `judgeCurrency`'s ternary over a
NON-EMPTY entitled catalogue and `computeCurrencyMetric`'s
`absentWithoutReasonCount` is zero — that is, every entitled package
individually reads either `current` or `absent-with-reason`. An opt-out
satisfies the policy condition without raising `currencyShare`; the metric
and the policy are deliberately separate answers, and neither is ever green
because a subset of the catalogue was never evaluated in the first place. An
empty catalogue closes nothing: nothing was evaluated, so a gate over it
reports indeterminate, not green. `computeCurrencyMetric`'s `absentWithoutReasonCount` has no path to
zero by silence; a plane that wants that shortcut has to build it outside
this package's contract, because nothing in `judgeCurrency` will manufacture
it. The loop reopens on any drift a gate now catches that the consuming
plane previously had to write its own evaluation logic to find.

**Closed:** issue #330 was a real gap in this wiring —
`readInstalledInventory` read only an npm-shaped lockfile, so a pnpm-based
consumer building this same gate had to hand-write its own roughly
sixty-line `InstalledInventory` reader against `pnpm-lock.yaml` rather than
get one from this package. `readInstalledInventoryReport` (below) closes it:
it reads either lockfile format and reports which it read, and — just as
importantly — never collapses "this plane's lockfile is present but this
package could not parse it" into the same silence as "this plane installed
nothing." Those are different facts, and conflating them is exactly the
ambiguity this program exists to remove.

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

`readInstalledInventory` reads a plane's manifest and an **npm** lockfile
through an injected `InventoryFileSystemPort`, following the injected-port
pattern retained by [`@vespeneventures/builder`](../builder)'s current
workspace package — this package never opens a file itself.
`createNodeInventoryFileSystem()` is the default, real-filesystem adapter; a
test, or a caller reading from somewhere other than disk, supplies its own.
It throws `IntegratorValidationError` on anything it cannot trust — a
missing manifest, a missing lockfile, a lockfile that does not parse, or an
unsupported `lockfileVersion` — the same offline-validator convention every
other loader in this package uses (see `IntegratorValidationError`'s own doc
comment).

A package declared in the manifest with no matching resolution in the
lockfile is not reported as installed. That is deliberate: a declared range
with nothing actually resolved is, from this reader's point of view, not
present, and it is left to `judgeCurrency` to decide whether that counts as a
recorded decision or drift.

`readInstalledInventoryReport` (issue #330) is the pnpm-aware, never-throwing
sibling. It reads either lockfile format and reports which one it read — or
reports exactly why it could not, as an explicit `indeterminate` result,
rather than throwing or silently reporting an empty inventory:

```ts
import { createNodeInventoryFileSystem, readInstalledInventoryReport } from "@vespeneventures/integrator";

const fs = createNodeInventoryFileSystem();
const result = readInstalledInventoryReport(fs, {
  manifestPath: "./package.json",
  npmLockfilePath: "./package-lock.json",
  pnpmLockfilePath: "./pnpm-lock.yaml",
});

if (result.kind === "read") {
  console.log(result.lockfileFormat); // "npm" | "pnpm" -- whichever was actually present
  // result.inventory is the same InstalledInventory readInstalledInventory returns
} else {
  console.log(result.reason); // see InstalledInventoryIndeterminateReason below
}
```

The caller supplies BOTH candidate lockfile paths; this function checks which
actually exist rather than trusting the caller's say-so about which package
manager a plane uses:

| `reason` | When |
| --- | --- |
| `manifest-not-found` | No file at `manifestPath`. |
| `manifest-invalid` | The manifest does not parse as JSON, or a dependency field is malformed. |
| `lockfile-not-found` | Neither `npmLockfilePath` nor `pnpmLockfilePath` exists. |
| `lockfile-invalid` | Exactly one lockfile is present but this package could not parse it in its own format — reported, never folded into an empty "nothing installed" inventory. |
| `ambiguous-lockfile-format` | BOTH `npmLockfilePath` and `pnpmLockfilePath` exist. Which one governs is not this reader's call to make, so it reports the ambiguity rather than silently picking one. |

`readInstalledInventoryReport`'s pnpm support reads the CURRENT
`importers`-based `pnpm-lock.yaml` shape only (the shape pnpm has written
since lockfile v6). It is deliberately not a general YAML parser — see
`src/pnpm-lockfile.ts`'s own header for the exact supported subset and why
this package took on a small internal parser rather than a YAML dependency
(this package declares no runtime dependencies at all, and that is
deliberate).

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
work **for the names it worked for** — which is not proof of visibility for
the one that `404`d, because GitHub Packages access control is per package. So
a lone `404` alongside a `known` stays genuinely undecidable, and says so:
`{ kind: "indeterminate", reason: ReachabilityIndeterminateReason }`.

It used to resolve to `unreachable`, and that was a false statement about what
happened — the registry was reached and it answered. A caller acting on
`unreachable` waits and retries, and for a name that is deliberately retired
the retry never succeeds, so the right response (drop the stale entitlement)
looked identical to the wrong one. `judgeCurrency` reports the same case as
`{ state: "indeterminate", reason: "registry-name-not-found" }`.

What this deliberately is **not** is a verdict that the name is absent. From
the transport alone, "never published", "deliberately retired" and "not
visible to this credential" are one response. Telling them apart needs the
lifecycle contract, which belongs to the caller — this package ships the
distinction, not the resolution. This mirrors
`scripts/check-package-visibility.mjs`'s own reasoning in this repository,
applied to the installer side instead of the publisher side. An
explicit `401`/`403`, and a transport failure or malformed response, are
never subject to this aggregation: they resolve straight through as
`unauthenticated` and `unreachable` respectively, because those two ARE the
distinction being protected.

## Version reconciler

`judgeCurrency` combines the entitlement declaration, the installed
inventory, and the resolved reachability verdicts into exactly the seven
required states, and reports every entitlement — it never stops at the
first problem, because a drift report is only useful complete.

`PackageCurrency` is a discriminated union, one variant per state, each
carrying only the fields that state can truthfully report: `behind` is the
only variant with a `latestVersion` (and the `severity` that grades it),
`absent-with-reason` is the only one with a `reason` (and `indeterminate`
has its own, differently-typed `reason`). A plain
`{ state: string, ...everythingOptional }` shape would let a bug construct
`{ state: "current", reason: "..." }` and have it silently type-check; this
shape does not allow that object literal to exist at all, which is what
"enforced in the types" means here rather than only in review.

Absence is judged **before** reachability is even consulted: whether a
package is installed, and whether its absence has a recorded reason, are both
facts a plane already holds about itself offline. Only `current` vs `behind`
needs the registry, which is exactly the shape the blindness rule demands —
the parts of this judgment that don't need the network don't touch it.

**Graded severity.** A `behind` result is not one undifferentiated "drift"
finding — every consumer that hand-rolled its own currency gate against this
package's `current`/`behind` ternary was forced to treat a same-day patch and
a breaking major bump identically, which is exactly the coupling that made a
routine patch anywhere a fleet-wide merge blocker on unrelated work. `behind`
now carries a `severity`, computed by `classifyCurrencyDistance` from
ordinary semver meaning:

| Distance | `severity` | Why |
| --- | --- | --- |
| Patch (`x.y.Z`, `major >= 1`) | `"patch"` | No interface change, by semver contract. |
| Minor (`x.Y.z`, `major >= 1`) | `"minor"` | Backward-compatible addition. |
| Major (`X.y.z`) | `"major"` | The one distance semver actually promises may break. |
| Pre-1.0 minor (`0.Y.z`) | `"major"` | Semver explicitly permits a `0.y` minor bump to break — there is no "safe" minor bump below `1.0.0`. |

A version this package cannot safely grade at all — unparseable, or carrying
a prerelease identifier on either side — is never folded into `current` or
`behind`. It is its own `indeterminate` state, with a machine-readable
`reason` (`"version-unparseable"` or `"version-not-comparable"`), so a caller
building a gate on top of this can never mistake "could not be evaluated" for
"evaluated and fine". An installed **stable** version ahead of the
registry's own `latest` — a lagging registry view, or a version published and
then unpublished — grades as `current`, never a negative distance; this
package only ever reports how far *behind* an installation is.

A pinned **prerelease** channel is a different case and never reaches that
rule. If either side carries a prerelease identifier the result is
`indeterminate` (`version-not-comparable`), checked before any ordering
comparison at all. Prerelease precedence is well defined in semver, but it
does not answer the question this grading exists to ask — how much breaking
change sits between two releases — and grading such a pair `current` would
report an unjudged pair as a judged one.

This package supplies the grading **and** the fold, because grading alone is
only half a standard. `currencyVerdict` reduces a set of judgments to one of
`satisfied` / `violated` / `indeterminate`, and `currencyVerdictToExitCode`
maps that onto the `0` / `1` / `2` ternary:

| judgment | verdict |
| --- | --- |
| `major` (including any pre-1.0 minor gap) | violated |
| `minor`, `patch`, `current` | satisfied — reported, never blocking |
| `absent-with-reason` | satisfied — an absence on record is a decision |
| `absent-without-reason` | violated — entitled, absent, and nobody recorded why |
| `indeterminate`, `unreachable`, `unauthenticated` | indeterminate |

The last row is the load-bearing one, and `indeterminate` takes precedence
over `violated`. A package that could not be reached or could not be
authenticated for was not judged *current* — it was not judged at all, and
folding it into `satisfied` would report success over ground the run never
examined.

`absent-without-reason` sits with the violations rather than there, and the
distinction is worth being precise about. Nothing about it is unexamined: the
package is entitled, it is not installed, and no opt-out records a decision to
leave it out. That is a complete evaluation reaching a negative answer — drift
nobody decided — and calling it indeterminate would demote a settled violation
into "could not tell", while also letting it mask a real major gap, since
indeterminate outranks violated. By the same logic a
run that could not evaluate part of its set must not report `violated`
either: that presents a partial answer as a complete one.

This fold ships rather than being left to each caller precisely *because* it
is short. Five lines that are easy to get quietly wrong — forgetting that a
pre-1.0 minor counts as major, or mapping an ungradable pair to satisfied —
are exactly the lines worth writing once, instead of leaving every consumer
to rediscover them and producing a fleet of gates that look identical from
the outside and disagree underneath.

Both are plain functions over this package's own types, so this package still
ships with **no runtime dependencies**. A plane that expresses gate results
through `@vespeneventures/controller`'s `GateResult` ternary
(`gateSatisfied` / `gateViolated` / `gateIndeterminate` / `foldGateResults`)
can map the verdict onto it in one step; nothing here assumes it does.

`upgradeSet` and `optOutGaps` are the loop's **act** step: the first is every
`behind` entry, each still carrying its `severity`, with what to upgrade to;
the second is every entitled, absent, unexplained package name.

## Currency delta fold

`currencyVerdict` grades a plane's **absolute** currency: every entitled
package's status right now, full stop. Wired into a pull-request gate, that
is exactly the wrong question — a pull request that touches no dependency at
all gets blocked by drift some earlier, unrelated change already introduced,
and a registry's `latest` dist-tag moves during the workday, so the absolute
verdict a pull request is graded against isn't even a fixed target. Two real
incidents landed on the same day from this: a release-workflow change and a
security fix, each blocked by several unrelated major-version drifts neither
one touched.

`foldCurrencyDelta(input)` is the fix — one fold, two scopes, keyed by
`input.scope`:

- **`absolute`** is `currencyVerdict`'s existing semantics, generalized: any
  `behind` whose `severity` is in a caller-supplied `blockingSeverities` set
  is a violation, rather than `"major"` being hardcoded. This is what a trunk
  or scheduled run should use — there is no "before" to compare against for a
  run that isn't a proposed change.
- **`introduced`** grades only what a change made worse, against a
  `baseline` — a second `PackageCurrency[]` snapshot captured at the merge
  base. This is what a pull-request run should use. It reports two lists,
  never conflated: `introduced` (this change's own doing, blocking) and
  `inherited` (drift that already existed, reported so a pull request can
  still **see** the fleet's drift, but never blocking on it).

```ts
import { foldCurrencyDelta, currencyFoldResultToExitCode } from "@vespeneventures/integrator";

// Trunk / scheduled run: grade everything, right now.
const trunkResult = foldCurrencyDelta({
  scope: "absolute",
  statuses, // from judgeCurrency
  blockingSeverities: new Set(["major"]),
});

// Pull-request run: grade only what this change made worse.
const prResult = foldCurrencyDelta({
  scope: "introduced",
  statuses, // from judgeCurrency, run against this change
  baseline, // judgeCurrency's output at the merge base -- caller-captured
  blockingSeverities: new Set(["major"]),
});

process.exitCode = currencyFoldResultToExitCode(prResult);
```

**The baseline is caller-supplied, exactly like everything else this
package's blindness rule governs**, and it is not always available: a
shallow clone with no merge-base commit reachable, or a checkout that could
not be read. `baseline` therefore accepts three things, and all three are
handled explicitly rather than two of them being silently mistaken for the
third:

| `baseline` | Result |
| --- | --- |
| omitted (`undefined`) | `indeterminate` |
| `{ kind: "unreadable", reason }` — the caller tried and failed | `indeterminate`, naming the reason |
| a real `PackageCurrency[]` (including `[]`, a merge base genuinely entitled to nothing) | graded for real |

**This is the rule to get right, and the one place this fold is uncompromising.**
An unread baseline is never folded into "nothing was introduced" — that fails
OPEN, inverting `classifyCurrencyDistance`'s own law that an ungradable input
is its own `indeterminate` state, never guessed into a pass. It is also never
silently answered with `absolute` grading instead — that doesn't fail loudly,
it quietly answers a *different question* under the `introduced` name, and a
caller who asked "did this change make anything worse" would get back "is the
fleet currently behind", reintroducing the exact bug this fold exists to fix,
now hidden inside its own fix. An unread baseline is an unobserved surface,
exactly like an unreachable registry or an unparseable version elsewhere in
this package, and an unobserved surface is `indeterminate` — never a pass,
never a fail.

Given a readable baseline, per package name: newly present at a blocking
severity with nothing at that name in `baseline` is `introduced`; present in
both with `installedVersion` unchanged is `inherited` — this is what protects
an untouched dependency from a `latestVersion` that moved on its own during
the workday; present in both with `installedVersion` moved backward, or moved
forward but still landing at a worse graded severity, is `introduced`;
present in both with `installedVersion` moved forward and landing at the same
or a better severity is `inherited` — **improved-but-still-behind is never
punished, or nobody will make partial progress**; `current` in `baseline` and
`behind` now is `introduced`. `indeterminate` / `unreachable` /
`unauthenticated`, on either the current run or the baseline side of a
package this fold needs to classify, make the whole fold `indeterminate` —
the same "not judged, not judged-and-clean" precedence `currencyVerdict`
already applies, one level removed.

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

## Supersession detector

A package published from this repository can replace a package a consuming
plane already installs under a different name. Nothing about that is a
version conflict — the names differ, so a lockfile resolves both happily —
which is exactly what makes the duplication silent: two visual systems, two
auth surfaces, two copies of the same contract, sitting side by side.

`detectSupersession(manifest, supersessionMap)` is the mechanism, and only
the mechanism: **it ships no map and no consumer package names, exactly as
the blindness rule above requires.** `SupersessionMap` is entirely
caller-supplied —

```jsonc
{
  "version": 1,
  "supersededBy": {
    "@example-scope/legacy-widget": { "replacement": "@example-scope/widget", "since": "2.0.0" }
  }
}
```

— a document each consuming plane writes and keeps in its own, private
workspace. This package never learns what any plane actually installs, let
alone what any plane used to install.

Pure and hermetic: no network, no filesystem. `detectSupersession` never
throws — a manifest or a supersession map it cannot trust is reported as
`indeterminate`, with a machine-readable reason (`"manifest-invalid"`,
`"supersession-map-invalid"`, or `"supersession-map-empty"` for a
syntactically valid but empty map), never silently folded into `satisfied`
and never silently reported as zero pairs.

**Every dependency position is scanned** — `dependencies`, `devDependencies`,
`peerDependencies`, `optionalDependencies`, and npm's `overrides` /
yarn's `resolutions` blocks, recursively where either can nest a name. A
superseding package declared in one position and the superseded name pinned
only in another (an override block, say) is still a conflict; this looks up
presence by exact name across every position, never per-field in isolation.

**Exact match only, never a substring.** A superseded `foo` never matches an
installed `foo-utils` or `@example-scope/foo-legacy`, and a scoped name never
cross-matches its unscoped-looking counterpart — every comparison is whole-
string equality against `isValidPackageName`-shaped keys, the same package-
name check every other module here already shares.

```ts
import { detectSupersession, supersessionResultToExitCode } from "@vespeneventures/integrator";

const result = detectSupersession(
  JSON.parse(rawManifestJson),
  JSON.parse(rawSupersessionMapJson), // this plane's own, private map -- never from this package
);

if (result.verdict === "violated") {
  console.log(`${result.count} conflicting pair(s):`, result.pairs);
}

process.exitCode = supersessionResultToExitCode(result);
```

**`integrator-supersession-check`**, this package's one shipped CLI, wraps
the same function for a plane that wants a drop-in gate:

```bash
npx integrator-supersession-check ./package.json ./supersession-map.json         # report-only: always exits 0
npx integrator-supersession-check ./package.json ./supersession-map.json --block # enforced: 0 / 1 / 2
```

It is **report-only by default, blocking one flag away**. A plane adopting
this gate against its own real supersession map is very likely to find a
backlog of pre-existing pairs on day one — every one of them accumulated
before this gate existed to catch them — and a gate that goes straight to
red against a dozen known pairs teaches a team to disable or ignore it
rather than work the list down. Run report-only in CI first, watch `count`
fall as pairs are cleaned up, and pass `--block` once it reaches (and stays
at) zero.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `loadEntitlementDeclaration(raw)` | function | Validates a parsed entitlement declaration offline. Throws on a duplicate, an invalid name, or an opt-out with no reason |
| `readInstalledInventory(fs, options)` | function | Reads a plane's manifest and an npm lockfile through the injected port. Reports only what actually resolves. Throws on anything it cannot trust |
| `readInstalledInventoryReport(fs, options)` | function | Reads a plane's manifest and EITHER lockfile format (issue #330). Never throws — reports `{ kind: "read", inventory, lockfileFormat }` or `{ kind: "indeterminate", reason, detail? }` |
| `createNodeInventoryFileSystem()` | function | The default `InventoryFileSystemPort`, backed by `node:fs` |
| `probeReachability(names, options)` | function | Probes an injected `Transport` for each name's latest published version. Never touches a real network itself |
| `resolveReachability(outcomes)` | function | Resolves raw probe outcomes into `known` / `unauthenticated` / `unreachable`, applying the aggregate 404 rule |
| `judgeCurrency(input)` | function | Combines entitlement, inventory, and reachability into `PackageCurrency[]` — one of the seven required states per entitlement |
| `classifyCurrencyDistance(installedVersion, latestVersion)` | function | Grades a version pair by semver distance: `current` / `patch` / `minor` / `major` (pre-1.0 minor counts as `major`), or `indeterminate` with a reason. Never throws |
| `upgradeSet(statuses)` | function | Every `behind` entry, as `{ name, installedVersion, latestVersion, severity }` |
| `optOutGaps(statuses)` | function | Every `absent-without-reason` package name |
| `computeCurrencyMetric(statuses)` | function | This package's stated metric: `currencyShare`, `entitledCount`, `currentCount`, `absentWithoutReasonCount` |
| `foldCurrencyDelta(input)` | function | One fold, two scopes: `absolute` grades the current state; `introduced` grades it against a `baseline`, splitting `introduced` (blocking) from `inherited` (reported, never blocking) findings. An unreadable or omitted `baseline` is `indeterminate`, never a silent pass and never a silent fall-back to `absolute` |
| `currencyFoldResultToExitCode(result)` | function | Maps a `CurrencyFoldResult` onto the `0` / `1` / `2` ternary |
| `loadAdmissionContract(raw)` | function | Validates a parsed admission contract offline. Rejects an unknown rule kind, a duplicate rule, or an unparseable `minimum-version` floor |
| `evaluateAdmission(contract, candidate, context)` | function | Evaluates a candidate against a contract. Empty result means admitted |
| `parseVersion(value)` / `compareVersions(a, b)` | function | A minimal, dependency-free semantic-version parser and comparator |
| `detectSupersession(manifest, supersessionMap)` | function | Pure, hermetic supersession detector. Never throws — a manifest or map it cannot trust is `indeterminate` |
| `supersessionResultToExitCode(result)` | function | Maps a `SupersessionResult` onto the `0` / `1` / `2` ternary |
| `IntegratorValidationError` | class | Thrown by every offline validator in this package, carrying a stable `IntegratorErrorCode` |
| `isValidPackageName(value)` | function | The one package-name check every module in this package shares |
| `EntitlementEntry` / `OptOutEntry` / `EntitlementDeclaration` | types | The entitlement schema |
| `InventoryFileSystemPort` / `InventorySourceOptions` / `InstalledPackage` / `InstalledInventory` | types | The installed-inventory reader's contracts |
| `InventoryReportSourceOptions` / `InstalledInventoryReadResult` / `InstalledInventoryIndeterminateReason` / `InventoryLockfileFormat` | types | `readInstalledInventoryReport`'s never-throwing contract (issue #330) |
| `Transport` / `ProbeOutcome` / `ReachabilityProbeOptions` / `ReachabilityVerdict` | types | The reachability probe's contracts |
| `PackageCurrency` / `JudgeCurrencyInput` / `UpgradeSetEntry` / `CurrencyMetric` | types | The version reconciler's contracts, including the seven required states |
| `CurrencySeverity` / `CurrencyDistance` / `CurrencyIndeterminateReason` / `ClassifyCurrencyDistanceResult` | types | The graded-severity contract: `"patch" \| "minor" \| "major"`, plus `"current"`, plus the two indeterminate reasons |
| `CurrencyVerdict` | type | `currencyVerdict`'s three-state result: `"satisfied" \| "violated" \| "indeterminate"` |
| `CurrencyFoldScope` / `CurrencyFoldInput` / `AbsoluteCurrencyFoldInput` / `IntroducedCurrencyFoldInput` | types | `foldCurrencyDelta`'s input, keyed by `scope: "absolute" \| "introduced"` |
| `CurrencyBaseline` / `CurrencyBaselineUnreadable` | types | `introduced`'s baseline: a real `PackageCurrency[]` snapshot, or an explicit `{ kind: "unreadable", reason }` marker |
| `CurrencyFoldFinding` / `CurrencyFoldResult` | types | One graded finding (`behind` or `absent-without-reason`), and `foldCurrencyDelta`'s discriminated result, tagged by both `scope` and `verdict` |
| `AdmissionRule` / `AdmissionContract` / `AdmissionCandidate` / `AdmissionContext` / `AdmissionFinding` | types | The admission contract's schema |
| `ParsedVersion` | type | `{ major, minor, patch, prerelease }` |
| `IntegratorErrorCode` | type | Stable error-code union for `IntegratorValidationError` |
| `SupersessionEntry` / `SupersessionMap` | types | A consuming plane's own, privately declared legacy-name-to-replacement map |
| `DependencyPosition` / `DEPENDENCY_POSITIONS` | type / const | Every manifest field scanned: `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions` |
| `SupersededPair` | type | One confirmed conflict: the legacy name and its replacement, each with the positions they were found in |
| `SupersessionIndeterminateReason` / `SupersessionResult` | types | The supersession detector's three-state contract |

## What it is not

It ships no registry of consumers and never will — see "The blindness rule"
above. It also does not install, upgrade, or write anything: every module
here reads and judges. Applying an upgrade set to a plane's own manifest is
that plane's own decision, made with its own tooling.

## Requirements

Node.js >= 20. No runtime dependencies.

## Licence

MIT
