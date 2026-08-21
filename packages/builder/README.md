# @vespeneventures/builder

Declared reality made actual. A runtime pin, a machine manifest, and a
deployment target are the same statement at three altitudes — *this is what
should exist; go and see whether it does.* This package holds the manifest
engine, the deployment surface contract, the toolchain pin, the shared
`liveStateSurface` reconciliation contract all three of those sit on, the CI
gate mechanics that reconcile any of them for real, and an observation-bundle
transport for the fleet's own inverted evaluation model — each repository
observes its own compliance in its own CI, and a plane aggregates what got
published.

```bash
npm install @vespeneventures/builder
```

## The job

Builder owns the gap between what a plane declared and what the machine, the
platform, or the pipeline actually is — whether the subject is a toolchain, a
manifest, or a deployment target. It never guesses and it never lets a
green offline check stand in for a live answer it never actually checked.

## `liveStateSurface` (#255)

Three unrelated subjects — a manifest's destinations, a deployment target's
health, a toolchain's runtime — turn out to share one structure:

- a **declaration** of intent, checkable offline;
- a **live state** owned by somewhere else;
- a **reconciliation surface** that may or may not exist yet;
- and a failure mode where the offline check goes green and gets mistaken
  for the whole answer.

The canonical implementation of this shape now lives in
`@vespeneventures/controller/conventions` — it owns every rule this
repository's tiers share and has no dependency of its own, so this package
(which already depended on controller for `GateResult`) re-exports its copy
rather than keeping a second one. Every name below is unchanged for a
consumer of `@vespeneventures/builder`: this is a consolidation of where the
code lives, not a change to what it does. See
`@vespeneventures/controller`'s own shipped documents,
`live-state-reconciliation.md` for the shared document and
`routine-declaration.md` / `schedule-declaration.md` for the two tiers that
motivated generalizing this shape in the first place.

`LiveStateSurfaceDeclaration` is that declaration, with every field the two
tiers that motivated this contract already used in practice:

```ts
import { validateLiveStateSurfaceDeclaration } from "@vespeneventures/builder";

const findings = validateLiveStateSurfaceDeclaration({
  store: "the GitHub Actions branch-protection API",
  readableByScript: true, // explicit, never left implicit
  readableBy: "policy-drift.mjs",
  note: "A green run here is not evidence this is live — only policy-drift.mjs reading the real API says that.",
});
```

`readableByScript: false` requires `reconciledBy` instead of `readableBy` —
what reconciles this subject when a script cannot read it at all. `note` is
required either way, and `validateLiveStateSurfaceDeclaration` rejects a note
that does not actually state the caveat: a green offline check is never
evidence the declared thing is live.

### The finding-kind vocabulary, all five

```ts
import { LIVE_STATE_SURFACE_FINDING_KINDS } from "@vespeneventures/builder";
// [
//   "declared-but-not-live",
//   "live-but-not-declared",
//   "live-differs-from-declared",
//   "live-artifact-predates-its-declaration",
//   "declared-but-not-verifiable",
// ]
```

This is a finding vocabulary, not a verdict vocabulary — all five kinds can
appear in a `drifted` report's `findings` list. The first four are outright
disagreements a completed attempt found between declared and live state. The
fifth, `declared-but-not-verifiable`, names one dimension of the comparison
that could not be evaluated at all (a `declaredAt`/`liveObservedAt` that
could not be parsed as an instant, for example), reported as its own finding
precisely so it cannot silently discard a real disagreement already found
alongside it. The same name is also, separately, the one declared reason an
entire reconciliation attempt reports at the **outcome** level when nothing
about the subject could be read at all: a reconciliation surface that cannot
currently read live state is a declared gap with a **named blocker**, never
a silent pass.

### Three states, enforced in the types

`reconcileLiveState` returns exactly one of `verified` / `drifted` /
`could-not-verify` — never a boolean, and never a fourth state. This reuses
`@vespeneventures/controller/gates`'s `GateResult` ternary rather than
inventing a fifth shape of the same idea inside this package. The
`could-not-verify` constructor enforces the "named blocker" rule at
construction time, not merely by convention:

```ts
import { liveStateCouldNotVerify, reconcileLiveState } from "@vespeneventures/builder";

liveStateCouldNotVerify("deployment.web", ""); // throws — never a silent pass

const report = reconcileLiveState<string, string>({
  subject: "toolchain.runtime.node",
  declared: { value: "20.11.1" },
  observation: { attempted: true, live: "18.19.0" },
  agrees: (declared, live) => declared === live,
});
// report.result.verdict === "violated"
// report.result.findings[0].kind === "live-differs-from-declared"
```

## Observation-bundle transport (#255, narrowed)

The fleet's evaluation model is inverted from a central scanner: each
repository runs its own gates in its own CI and observes its own
compliance; a plane wanting a fleet-wide picture reads what each repository
already concluded about itself rather than re-scanning it centrally. Until
now, those self-observations had no standard shape or transport — every
plane that wanted one improvised its own.

`#255` originally proposed generalizing that gap into a full
declared-intent-vs-live-state framework. The owner narrowed that on
purpose: an API without a consumer is a guess, and the reconciliation half
of that shape already shipped as `liveStateSurface` above. What ships here
is the transport — the one shape a repository's CI writes and a plane's CI
reads — with everything else left for a real second consumer to motivate.

**What this is not:**

- No network I/O anywhere in this package. Fetching a bundle from wherever
  a repository published it is the consuming plane's own job.
- No storage opinion. A bundle can be a committed artifact, a release
  asset, or anything else a caller's CI decides — the contract is the
  shape, not where it lives.
- No scheduling, no polling, and no further generalization of
  `liveStateSurface`. That remains `#255`'s open remainder, filed as its
  own follow-up issue rather than guessed at here.

### Writing one repository's observation

```ts
import { writeObservationBundle } from "@vespeneventures/builder";

const serialized = writeObservationBundle({
  repository: { id: "example-org/example-app", ref: "a1b2c3d" },
  producedAt: new Date().toISOString(), // the CALLER's clock, never this package's
  gates: [
    { gateId: "secret-scan", result: { verdict: "satisfied", evaluated: 12 } },
    {
      gateId: "release-readiness",
      result: { verdict: "violated", findings: [{ rule: "version-not-bumped", severity: "high", message: "…" }] },
    },
  ],
});
// serialized is a JSON string -- write it wherever this repository's own CI
// decides an observation belongs.
```

`writeObservationBundle` is pure: caller-supplied data in, a serialized
bundle out. It never reads a clock and never touches the network or the
filesystem — `producedAt` is the caller's own timestamp, supplied
explicitly, exactly like `liveStateSurface`'s `declaredAt`/`liveObservedAt`
above. Each gate's `result` reuses `@vespeneventures/controller/gates`'s
`GateResult` ternary directly rather than a parallel shape — this package
already depends on `controller` for it throughout.

### Aggregating N repositories' observations

```ts
import { aggregateObservations } from "@vespeneventures/builder";

// `bundles` is already-fetched data -- the plane's own CI did the fetching.
// This function never fetches anything itself.
const report = aggregateObservations({
  expectedRepositories: ["org/repo-a", "org/repo-b", "org/repo-c"],
  bundles: [bundleA, bundleB], // org/repo-c never showed up
  now: new Date().toISOString(),
  staleAfterMs: 24 * 60 * 60 * 1000, // 24h -- how old one CONTRIBUTING BUNDLE may be
  maxResultAgeMs: 60 * 60 * 1000, // 1h -- how old THIS RESULT may be before a later reader can no longer vouch for it
});

report.unobservedRepositories; // ["org/repo-c"] -- named, not a footnote
report.overall.verdict; // "indeterminate" -- an unobserved repository can never read as clean
report.computedAt; // echoes `now` -- carried so a persisted copy of `report` can be freshness-checked later
```

A repository this aggregation expected to hear from but did not, a bundle
that fails `validateObservationBundleShape`, a bundle older than the
caller-supplied `staleAfterMs`, and two or more bundles claiming the same
repository identity are all reported **`indeterminate`**, with one of four
named reasons — never omitted from `report.repositories`, and never
resolved by picking one and discarding the rest ("last-write-wins"):

| Reason | Meaning |
| --- | --- |
| `unobserved-repository` | No bundle at all was received for this expected repository. |
| `invalid-bundle-schema` | A bundle claiming this repository failed `validateObservationBundleShape`. |
| `duplicate-repository-identity` | Two or more bundles claim the same repository. |
| `stale-observation` | The bundle's `producedAt` is older than `staleAfterMs` relative to `now`. |

`report.overall` folds every `report.repositories[].result` with this
package's own `foldGateResults` (`@vespeneventures/controller/gates`),
whose documented precedence — indeterminate beats violated beats satisfied
— is exactly what keeps "2 of 5 repositories were unobserved" from
silently reading as "the 3 we heard from were clean, so we're done."
`report.overall.verdict` is `"satisfied"` only when every expected
repository was cleanly, freshly, and uniquely observed and every one of its
own gates was itself satisfied.

`report.receivedCount` (bundles that passed schema validation, independent
of whether they matched an expected repository) and
`report.unexpectedRepositories` (repository ids present in `bundles` but
never named in `expectedRepositories`) are reported for the same reason:
nothing this function is handed is silently dropped from the report, even
data that turned out not to matter for the verdict.

**Close condition:** this loop closes for a plane aggregating per-repository
bundles when three predicates all hold: every id in `expectedRepositories`
has exactly one entry in `report.repositories`; every entry's classification
is `observed` (the four gap classifications — `unobserved-repository`,
`invalid-bundle-schema`, `duplicate-repository-identity`,
`stale-observation` — are each `indeterminate` by construction and therefore
never part of a close); every observed entry's `result.verdict` is
`satisfied`; and `report.unattributedCount` is zero — a bundle that arrived
but could not be tied to any repository id is evidence that was never
evaluated, and it folds into `overall` as `unattributed-bundle`
(indeterminate), so it can never coexist with a close. `report.overall.verdict` then reads `satisfied` because all
three held, never because the aggregator simply stopped looking. A
repository that never reports in must show up as a named gap, not as a
shorter list. The loop reopens on any bundle shape `aggregateObservations`
cannot sort into one of the four gap classifications above: that is a transport-contract
gap, filed the same way `#255`'s narrowed-off remainder (scheduling,
polling, further generalization of `liveStateSurface`) already is, rather
than patched ad hoc inside this package.

### The aggregate's own age is a different question from any bundle's (#340)

`stale-observation` above answers "is any ONE contributing bundle too old to
fold in." It cannot answer "is this AGGREGATION ITSELF too old to still be
presented as current" — a plane that only re-runs this aggregation on a push
to the repository that hosts it can go a long time between runs, and every
one of its inputs can change in the meantime with nothing re-evaluating the
aggregate to notice. `aggregateObservations` cannot detect that about its own
output: `report.computedAt` always equals the `now` it was just called with,
so no check inside that one call can ever observe its own result aging after
the fact.

That is why `report` also carries `computedAt` and `maxResultAgeMs` —
so that a caller who **persists** `report` (a committed artifact, a status
check, anything a different process reads later) can hand both back to
`checkObservationAggregateFreshness`, alongside a FRESH `now` supplied at
read time, to ask the question `aggregateObservations` cannot ask of its own
output:

```ts
import { checkObservationAggregateFreshness } from "@vespeneventures/builder";

// `storedReport` was read back from wherever the previous run persisted it --
// not produced by the same call as the freshness check below.
const freshness = checkObservationAggregateFreshness({
  computedAt: storedReport.computedAt,
  maxResultAgeMs: storedReport.maxResultAgeMs,
  now: new Date().toISOString(), // the reader's own clock, at READ time
});

// A stale but otherwise-unanimous-pass stored report must never silently
// stay satisfied: fold the stored verdict together with the freshness check
// through any GateResult fold, including this package's own dependency,
// `@vespeneventures/controller/gates`'s `foldGateResults` -- the same
// combinator `aggregateObservations` already uses internally.
const effective = freshness.verdict === "satisfied" ? storedReport.overall : freshness;
```

`checkObservationAggregateFreshness` reports `indeterminate` with reason
`stale-aggregate-result` — never a restated `stale-observation`, because the
two questions are different: `stale-observation` is about one bundle's age
at aggregation time; `stale-aggregate-result` is about the aggregate's own
age at whatever later moment it is actually read. A schedule (or any other
input-driven trigger) makes this staleness less likely; this check is what
makes it detectable, because it is the one thing that still works when that
trigger has silently stopped firing.

## Manifest engine (formerly `@vespeneventures/provisioning`)

An idempotent engine for applying a provisioning manifest to a machine, and
for checking afterwards whether the machine still agrees with it. The engine
is neutral machinery: it applies manifests and owns none, and it has no
opinion about what belongs in one.

```ts
import {
  applyInstallation,
  createNodeFileSystem,
  createRuntimeContext,
  loadManifest,
  planInstallation,
  verifyInstallation,
} from "@vespeneventures/builder";

const manifest = loadManifest(JSON.parse(rawManifestJson));
const runtime = createRuntimeContext(manifest, { home: os.homedir(), sourceRoot: myCanonicalCheckout });

// Pure. Touches no filesystem, so it can be printed or reviewed first.
const plan = planInstallation(manifest, runtime);

const fs = createNodeFileSystem();
const result = applyInstallation(plan, fs, { backupRoot: `${runtime.home}/.config-backups/${stamp}` });

// Later, or in a drift check: reads the machine, not the manifest.
const findings = verifyInstallation(plan, fs);
```

`links`, `copies`, `managedBlocks`, and `privateDirectories` are the four
manifest collections; `expandTokens` resolves `${HOME}`, `${SOURCE_ROOT}`,
`${WORKSPACE_ROOT}`, and any `extraTokens` a caller supplies.
`composeManagedBlock`, `renderManagedBlock`, `withoutManagedBlock`, and
`hasExactlyOneBlock` operate on the marker-delimited region a managed block
owns inside a file this engine does not otherwise own.

**Safety properties**, unchanged from `provisioning`: nothing is overwritten
before it is backed up (`ApplyOptions.backupRoot` is required); private
directories are handled first; a `links` entry declared with `target`
(a chained link) applies last, after copies and managed blocks; a same-content
symlink at a copy destination is replaced rather than accepted; ambiguous
managed-block markers are refused, not guessed; applying throws, verifying
reports.

### Multi-source composition (#240)

The engine above assumes one `sourceRoot` and one plan. That is unchanged
and every existing single-source caller keeps working exactly as written
above — this section covers a separate, additive layer for a caller that
needs to compose one installation plan out of several independently-owned
sources, e.g. several account-owned workspace checkouts, without staging
them under one repository authority.

Build one `Plan` per source with the same `createRuntimeContext` /
`planInstallation` shown above — nothing new there — then tag each with the
identifier it asked to be known by and compose them:

```ts
import {
  applyComposedInstallation,
  composeInstallationPlans,
  createRuntimeContext,
  createNodeFileSystem,
  loadManifest,
  planInstallation,
  verifyComposedInstallation,
} from "@vespeneventures/builder";

const namedPlans = sources.map(({ name, sourceRoot, manifest }) => ({
  source: name,
  plan: planInstallation(manifest, createRuntimeContext(manifest, { home, sourceRoot })),
}));

// Pure, like planInstallation. Every operation carries the source that
// requested it; throws DestinationCollisionError, naming every contributing
// source, if two sources claim the same destination.
const composed = composeInstallationPlans(namedPlans);

const fs = createNodeFileSystem();
const result = applyComposedInstallation(namedPlans, fs, { backupRoot });

const findings = verifyComposedInstallation(namedPlans, fs);
// findings[i].source names which source's plan the finding came from.
```

`composeInstallationPlans` validates the full composition — including
collision detection — before `applyComposedInstallation` makes a single
filesystem call, so a colliding destination is never discovered halfway
through an apply; nothing from either contributing source is written.
Collision detection covers `links`, `copies`, and `managedBlocks`
destinations only. Two sources asking for the same `privateDirectories`
entry to exist is not a collision — creating (or leaving alone) a directory
with a fixed mode is idempotent and non-destructive regardless of which
source asks or how many do, the same line `loadManifest` already draws for
one manifest's own destinations.

`applyComposedInstallation` applies each source's plan through the
unchanged `applyInstallation`, in the order `namedPlans` supplies, sharing
one `backupRoot`. **A known limit, not an oversight:** a chained link
(a `links` entry declared with `target`) or a copy/managed-block destination
nested inside another source's private directory only resolves correctly if
the source it depends on was already applied — this package does not detect
or order around a cross-source dependency, because doing so would mean
inventing a precedence policy across sources, which is exactly what this
package must not do (see "What this does not do" below). Supply `namedPlans`
in an order that satisfies any real cross-source dependency, or avoid
creating one.

**What this does not do**, and why: composing several sources' plans is the
only thing this module does. It never discovers what those sources are —
that is a caller's job, informed by whatever registry or configuration names
its account-owned workspace repositories, never this package's. It never
decides which source wins a conflicting destination — a collision is always
refused, never resolved, because resolving it is a precedence and policy
decision this package does not make (see #240's Boundaries: no account
discovery, no precedence or conflict-resolution policy, inside provisioning
or its successor here).

This first increment covers three of #240's eight acceptance criteria —
multiple named sources with a preserved single-source compatibility path,
per-operation provenance, and pre-mutation collision detection with
evidence. It deliberately does **not** cover the other five: a durable
applied receipt (so a later run can compare against what actually got
installed, not just against the current plan); retirement planning for a
destination a prior plan owned that a newer plan no longer names; the
clean-room adapter qualification; and account discovery itself, which is
out of scope for this package by design (see "What this does not do"
above), not merely undelivered. See the pull request that introduced this
section for the full breakdown.

A note on vocabulary: this module does not report through
`liveStateSurface`'s declared/verified/could-not-verify vocabulary
described above. That contract reconciles one declaration against one live
read of a subject somewhere else; a destination collision is neither —
it is two declared plans disagreeing with each other, discovered before
either is applied and before there is any live state to read at all. The
one place this module *does* read live state — `verifyComposedInstallation`
— delegates to the unchanged `verifyInstallation`, which already reports
through the pre-existing `Finding` vocabulary rather than `liveStateSurface`;
changing that return shape is a breaking change to already-published
behavior and is out of scope here.

## Machine composition (`./machine` subpath, #393)

Composing one machine's skill tree from several account-owned workspace
checkouts plus a third-party-scoped skill source — the mechanism a retiring
account-owned installer repository used to provide, promoted into this
package once that repository had nothing left to place. Two decisions were
made explicitly rather than by default, and both are recorded here because
"the package that already holds the files" and "the package that owns
machines" were both defensible, and only one shape of composition actually
worked with what this package already ships.

### Decision 1: builder owns the mechanism, not controller

`@vespeneventures/controller/conventions` already ships the account-neutral,
package-owned content itself — five documents plus a managed shell
block — and #393 leaves every one of those files exactly where they are,
untouched. What is missing is not content; it is a mechanism to *place*
content and per-account skill trees onto a machine, and roughly 90% of that
mechanism already lived in this package before #393: `composeInstallationPlans`,
`applyInstallation`, `verifyInstallation`, and `GateResult` are all builder's
own. Building the machine installer inside controller would have meant
duplicating `composition.ts` in a package that has no reason to depend on the
filesystem-mutation half of this one. Builder's own charter — "declared ->
actual: toolchain, pipeline shape, machines, platforms" — already names
"machines" as a first-class subject; controller's does not. So: **builder
owns the mechanism, controller keeps owning the content.** A caller composing
a real machine imports package-owned entries from controller's
`CONVENTION_DOCUMENTS` / `CONVENTION_ADAPTERS` catalog (`@vespeneventures/
controller/conventions`) as one more source alongside the account and
third-party sources this subpath discovers — this package does not fold that
catalog into a manifest itself, because doing so would mean hard-coding one
particular machine's destination paths into a public, account-neutral
package. That composition — which document goes to which absolute path on
which real machine — is local machine state, never checked in here.

### Decision 2: composition is per-skill links, not a directory symlink or a copy

`~/.agents/skills` (or wherever a caller composes skills to) must present the
union of several accounts' skill trees plus a third-party tree. Three shapes
were on the table:

- **A single directory symlink** — the mechanism this replaces used. Rejected:
  a symlink can only point at one source, so it cannot union N accounts' trees
  no matter how many are discovered.
- **A materialized copy** of every account's skills into one directory.
  Rejected: a copy drifts from its source the moment the source changes, and
  this package's own manifest engine already treats "canonical elsewhere" as
  link-not-copy everywhere else it applies (see `links` vs. `copies` in
  `../types.ts`) — inventing a copy-based exception here for skills alone
  would be a second policy this package does not need.
- **Per-skill links into one composed directory.** Adopted. Each discovered
  source (`./discovery.ts`'s account workspaces, `./third-party.ts`'s
  vendored skills) becomes one named `Plan` carrying one `links` entry per
  skill it owns, all destined inside the same composed directory
  (`./skills-manifest.ts`'s `buildSkillsManifest`). This is the only shape of
  the three where `composeInstallationPlans`'s EXISTING per-destination
  collision check (documented above, under "Multi-source composition") works
  completely unmodified: two accounts shipping a skill with the same name
  both produce a `links` entry destined at
  `<composedSkillsRoot>/<name>`, and composing them throws
  `DestinationCollisionError` — naming both accounts — for free. No new
  collision logic was written for this subpath, because the existing one
  already generalizes to "one entry per unit of content," and a skill is
  exactly that unit.

### Discovery: never a hard-coded list, never a silent partial machine

`./discovery.ts`'s `discoverAccountWorkspaces` takes a root from the caller or
the `BUILDER_MACHINE_WORKSPACES_ROOT` environment variable — never a guessed
default, so no absolute path to any account repository appears anywhere in
this package's content. A directory under that root is a candidate only once
it has placed a `builder-machine-workspace.json` marker at its own root,
declaring its `account` identifier and its `skillsPath` — the same
discovery-by-self-declaration shape `npm`'s own workspace globbing uses. A
directory with no marker is simply not a workspace, excluded the same way an
npm workspace glob excludes a directory with no `package.json`. A directory
**with** a marker has declared intent to be counted, and from that point
every failure — an unreadable marker, malformed JSON, a schema mismatch, an
unreadable declared skill tree, two workspaces claiming the same account — is
`indeterminate`, always present in the result, never dropped. `./third-party.ts`'s
`loadThirdPartySkills` is the third-party-scoped mirror of the same
ternary, keyed off `SkillScope`'s own `"third-party"` value
(`@vespeneventures/controller/conventions`) rather than a second vocabulary —
`THIRD_PARTY_SCOPE`'s assignment stops compiling if that union ever drops the
value.

`./report.ts`'s `verifyMachine` (behind `builder-verify-machine`, `./cli.ts` +
`./bin.ts` — a SEPARATE compiled entry file from `../ci/bin.js`, since this
repository invokes gates by direct dist path and a CLI that dispatches on the
invoked bin name is unreachable that way) is the orchestrator that makes the
whole-machine rule concrete: if ANY discovered source is indeterminate,
composition itself is skipped and reported `indeterminate` — never a
partially-composed machine reported as satisfied because the sources that DID
resolve happened to verify clean.

```ts
import { verifyMachine, createNodeDiscoveryPort } from "@vespeneventures/builder/machine";
import { createNodeFileSystem } from "@vespeneventures/builder";

const report = verifyMachine(createNodeDiscoveryPort(), createNodeFileSystem(), {
  schemaVersion: 1,
  home: process.env.HOME,
  composedSkillsRoot: `${process.env.HOME}/.agents/skills`,
  // accountWorkspacesRoot / thirdPartySkillsRoot may come from here instead
  // of BUILDER_MACHINE_WORKSPACES_ROOT / BUILDER_MACHINE_THIRD_PARTY_SKILLS_ROOT.
});
// report.overall.verdict: "satisfied" | "violated" | "indeterminate"
// report.exitCode: 0 | 1 | 2 — the same fold as everywhere else in this package
```

```bash
npx builder-verify-machine --inputs machine-verify-inputs.json
# Exit codes: 0 = every managed skill destination resolves as composed,
#             1 = at least one destination or source disagreed,
#             2 = could not verify (an unresolvable source, or bad input).
```

## Deployment (`./deployment` subpath, formerly `@vespeneventures/deployment`)

Dependency-free deployment surface contracts, configuration planning, health
evaluation, and read-only Vercel and Render adapters — preserved as a
subpath rather than flattened into the root entrypoint, so its own export
shape (a root plus two provider subpaths) stays intact.

```ts
import {
  defineDeploymentManifest,
  evaluateDeploymentHealth,
  validateDeploymentManifest,
} from "@vespeneventures/builder/deployment";
import { createVercelInspector, renderVercelConfiguration } from "@vespeneventures/builder/deployment/vercel";
import { createRenderInspector, renderRenderConfiguration } from "@vespeneventures/builder/deployment/render";

const manifest = defineDeploymentManifest({
  schemaVersion: "1",
  surfaces: [{ id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.com/health" } }],
});

if (validateDeploymentManifest(manifest).length > 0) throw new Error("Invalid manifest");

const health = evaluateDeploymentHealth([{ surfaceId: "web", status: "healthy" }]);
```

The provider adapters make GET requests only, obtain a bearer token from a
caller-injected provider at inspection time, and never read a secret store or
process environment. See the module doc comments under `src/deployment/`
for the full contract each subpath ships — the shape is unchanged from
`@vespeneventures/deployment`'s own README, which this package's history
carries forward.

## Toolchain

The runtime pin, the package-manager pin, and the build order, expressed and
reconciled as the same `liveStateSurface` statement everything else in this
package makes. A pin is an exact value — never a range; see `src/toolchain.ts`
for why guessing at range syntax this module does not parse would be worse
than refusing to.

```ts
import { reconcileToolchain, validateToolchainDeclaration } from "@vespeneventures/builder";

const declaration = {
  runtime: { name: "node", version: "20.11.1" },
  packageManager: { name: "npm", version: "10.5.0" },
  buildOrder: { packages: ["core", "adapters", "app"] },
};

if (validateToolchainDeclaration(declaration).length > 0) throw new Error("Invalid toolchain declaration");

const [runtime, packageManager, buildOrder] = reconcileToolchain(declaration, {
  runtime: { attempted: true, live: process.version },
  packageManager: { attempted: true, live: "10.5.0" },
  buildOrder: { attempted: true, live: declaration.buildOrder.packages },
});
```

This package never reads `process.version`, spawns a shell, or reads a root
manifest itself — every observation is supplied by the caller. A function
that read its own runtime could never be tested for the disagreeing case
without actually running on a disagreeing machine.

## Shared CI gate mechanics (#257)

The same secret-scan-shaped CI gate had been built independently at least
four times across this account family with no channel between the copies —
a fix discovered in one copy had no way to reach the other three. #257 asks
for that mechanism to live in one place, shipped as **importable machinery a
consumer's own thin workflow invokes** — the shape
`@vespeneventures/verify-standards` already proves — rather than as a
cross-repository reusable workflow reference. A `uses:` pointing at another
account's workflow or action is not the sanctioned exception this account
family's cross-account boundary rule allows; a downstream package depending
on an upstream package is, and that is what this subpath ships.

`./ci` holds the shared half — a fold from any number of `LiveStateSubjectReport`
values into one `0`/`1`/`2` exit-code verdict (`foldLiveStateReports`), plus a
minimum-safe-version staleness floor (`checkVersionFloor`) that gives a caller
running a pre-fix build the same "you are behind" signal
`@vespeneventures/verify-standards` already ships, not merely a changelog
entry someone may or may not read — and the concrete gate built on both:
`builder-verify-toolchain`, an installed CLI a consuming repository's own
thin GitHub Actions workflow runs. See
[`documents/caller-workflow.md`](documents/caller-workflow.md) for that
workflow in full, including why the decisive command must never sit on the
left side of a pipe under GitHub Actions' `bash -e {0}` (`pipefail` unset)
and why "can't run here" must become an exit `2`, never an `if:` skip — a
skipped required check reports to a merge gate as satisfied, not absent.

```bash
npx builder-verify-toolchain --inputs verify-toolchain-inputs.json
# Exit codes: 0 = verified, 1 = drifted, 2 = could not verify.
```

The same fold and floor are also importable directly, for a future gate over
a different subject that wants this package's mechanics without shelling out
to the installed binary:

```ts
import { checkVersionFloor, foldLiveStateReports } from "@vespeneventures/builder/ci";
```

Every check here is hermetic: `src/ci/*.test.ts` injects every declaration,
observation, and file read, and calls no network and no real machine.

## Metric

**Drift**: the count of subjects where declared and actual disagree, plus,
reported separately, the count that could not be verified at all. Neither is
folded into the other — a build that reports zero drift by refusing to look
at half its subjects has not reported zero drift.

## Loop

- **aim** — every declared subject (a manifest destination, a deployment
  surface, a toolchain pin) exists as declared.
- **sense** — read the live state, not the declaration.
- **judge** — `verified` / `drifted` / `could-not-verify`.
- **act** — apply idempotently where the plane granted authority
  (`applyInstallation`); otherwise report the gap with its blocker named
  (`liveStateCouldNotVerify`).
- **learn** — a subject that is repeatedly `declared-but-not-verifiable` is a
  missing credential or a missing API, filed as a named absence rather than
  worked around inside this package.

The loop closes when a plane's own dashboard shows zero `drifted` subjects
**and** zero `could-not-verify` subjects for a given run — not when it shows
zero `drifted` alone, which is exactly the "nobody looked" result this
package's whole design exists to keep from reading as "looks fine."

## API

| Export | Kind | Description |
| --- | --- | --- |
| `loadManifest(raw)` | function | Validates a parsed provisioning manifest and returns it normalized |
| `createRuntimeContext(manifest, options)` | function | Resolves the home directory, source root, workspace root, and token table |
| `planInstallation(manifest, runtime)` | function | Resolves every manifest entry to absolute paths with no filesystem access |
| `expandTokens(value, tokens)` | function | Expands `${TOKEN}` placeholders; throws on an unknown token |
| `applyInstallation(plan, fs, options)` | function | Applies a plan through the injected port, backing up every replaced destination |
| `verifyInstallation(plan, fs)` | function | Reads the machine and returns `Finding[]` |
| `createNodeFileSystem()` | function | The default `FileSystemPort`, backed by `node:fs` |
| `composeInstallationPlans(namedPlans)` | function | Composes several named sources' plans into one, provenance-tagged; throws `DestinationCollisionError` on a shared destination |
| `applyComposedInstallation(namedPlans, fs, options)` | function | Validates composition, then applies each source's plan through `applyInstallation` |
| `verifyComposedInstallation(namedPlans, fs)` | function | Validates composition, then returns `ComposedFinding[]`, each tagged with its source |
| `DestinationCollisionError` | class | Thrown when two or more sources claim the same destination; carries `collisions` |
| `renderManagedBlock(body, start, end)` | function | The marker-delimited block text |
| `withoutManagedBlock(contents, start, end)` | function | Content with the managed region removed |
| `composeManagedBlock(existing, body, start, end, legacyBody?)` | function | The exact content a destination should hold |
| `hasExactlyOneBlock(contents, body, start, end)` | function | Whether a destination holds exactly one well-formed copy of a block |
| `PRIVATE_DIRECTORY_MODE` | `number` | `0o700` |
| `LIVE_STATE_SURFACE_FINDING_KINDS` | constant | All five finding kinds, frozen |
| `validateLiveStateSurfaceDeclaration(declaration)` | function | Validates one `LiveStateSurfaceDeclaration`'s own shape |
| `reconcileLiveState(input)` | function | Reconciles one subject's declaration against one observation; returns a `LiveStateSubjectReport` |
| `liveStateVerified(subject)` / `liveStateDrifted(subject, findings)` / `liveStateCouldNotVerify(subject, blocker)` | function | The only three constructors of a `LiveStateSubjectReport` |
| `liveStateReconciliationReasons` | constant | The `declared-but-not-verifiable` reason vocabulary, scoped via `createGateReasons` |
| `validateRuntimePin(pin)` / `validatePackageManagerPin(pin)` / `validateBuildOrderPin(pin)` | function | Validate one toolchain pin's own shape |
| `validateToolchainDeclaration(declaration)` | function | Validates all three toolchain pins at once |
| `reconcileToolchain(declaration, observation)` | function | Reconciles a declared toolchain against one machine observation; returns three `LiveStateSubjectReport`s |
| `Finding` / `Severity` | type | `{ rule, severity, message }` and `"high" \| "medium" \| "low"` |
| `Manifest` / `LinkEntry` / `CopyEntry` / `ManagedBlockEntry` / `PrivateDirectoryEntry` | type | The four manifest collections and their entries |
| `RuntimeContext` / `RuntimeOptions` / `Plan` / `PlanOperation` / `OperationKind` | type | Runtime resolution and planning shapes |
| `FileSystemPort` / `FileStats` | type | The injected filesystem interface |
| `ApplyOptions` / `ApplyResult` | type | `{ backupRoot }` and `{ changed, unchanged, backupRoot }` |
| `NamedSourcePlan` | type | `{ source, plan }` — one source's already-computed `Plan`, tagged with its identifier |
| `ComposedPlan` / `ComposedPlanOperation` | type | The composed plan and its provenance-tagged operations |
| `ComposedFinding` | type | A `Finding` with the `source` whose plan produced it attached |
| `DestinationCollision` | type | `{ destinationPath, sources }` — the evidence behind a `DestinationCollisionError` |
| `LiveStateSurfaceDeclaration` | type | The `store` / `readableByScript` / `readableBy` / `reconciledBy` / `note` declaration |
| `LiveStateSurfaceFindingKind` / `LiveStateDriftKind` | type | All five kinds, and the four a completed attempt can report |
| `LiveStateFinding` / `LiveStateSubjectReport` / `LiveStateReconciliationResult` / `LiveStateReconciliationReason` | type | One finding, one subject's report, and the underlying `GateResult` shapes |
| `LiveStateObservation` / `LiveStateDeclarationValue` / `ReconcileLiveStateInput` | type | What `reconcileLiveState` reads |
| `RuntimePin` / `PackageManagerPin` / `BuildOrderPin` / `ToolchainDeclaration` / `ToolchainObservation` | type | The toolchain declaration and observation shapes |
| `OBSERVATION_BUNDLE_SCHEMA_VERSION` | constant | This contract's own schema version |
| `writeObservationBundle(input)` | function | Pure: caller-supplied data in, a serialized `ObservationBundle` JSON string out |
| `validateObservationBundleShape(raw)` | function | Offline structural validation of an untrusted bundle; returns `Finding[]`, never throws |
| `parseObservationBundle(raw)` | function | Validates `raw` and narrows it to `ObservationBundle` on success, or returns findings on failure |
| `aggregateObservations(input)` | function | Folds N already-fetched bundles into one plane-level `AggregateObservationsResult`; fetches nothing itself |
| `checkObservationAggregateFreshness(input)` | function | Given a stored result's `computedAt`/`maxResultAgeMs` and a fresh `now`, reports whether this aggregate can still vouch for that result as current |
| `OBSERVATION_AGGREGATE_INDETERMINATE_REASONS` | constant | The named reasons a repository's aggregate status can be indeterminate for |
| `OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_REASONS` | constant | The single reason (`stale-aggregate-result`) `checkObservationAggregateFreshness` can report -- distinct from the per-bundle reasons above |
| `ObservationBundle` / `ObservationBundleRepository` / `ObservationBundleGateEntry` | type | One repository's self-observation and its parts |
| `ParsedObservationBundle` / `InvalidObservationBundle` | type | What `parseObservationBundle` returns on success and on failure |
| `WriteObservationBundleInput` | type | What `writeObservationBundle` accepts |
| `AggregateObservationsInput` / `AggregateObservationsResult` | type | What `aggregateObservations` accepts and returns, including `computedAt` and `maxResultAgeMs` |
| `CheckObservationAggregateFreshnessInput` | type | What `checkObservationAggregateFreshness` accepts |
| `RepositoryObservationStatus` / `RepositoryObservationResult` | type | One expected repository's status, and the `GateResult` it carries |
| `ObservationAggregateIndeterminateReason` | type | The union `OBSERVATION_AGGREGATE_INDETERMINATE_REASONS` enumerates |
| `ObservationAggregateResultIndeterminateReason` | type | The union `OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_REASONS` enumerates |

| `discoverAccountWorkspaces(port, options)` (`./machine`) | function | Finds every self-declared account workspace under a root; `indeterminate`, never dropped, for one that cannot be resolved |
| `loadThirdPartySkills(port, options)` (`./machine`) | function | The third-party-scoped skill source of truth, tagged with controller's own `SkillScope` |
| `buildSkillsManifest(skillNames, options)` (`./machine`) | function | Per-skill `links` entries into one composed directory — decision 2 above, made concrete |
| `verifyMachine(discovery, fs, inputs, options)` (`./machine`) | function | Orchestrates discovery, the third-party source, and `composeInstallationPlans`/`verifyComposedInstallation` into one `GateResult`-based report |
| `createNodeDiscoveryPort()` (`./machine`) | function | The default `DiscoveryPort`, backed by the real filesystem |

`./deployment`, `./deployment/vercel`, `./deployment/render`, `./ci`, and
`./machine` are separate package subpaths, documented in their own sections
above.

## Requirements

Node.js >= 20, ESM. Runtime dependency: `@vespeneventures/controller` (`~0.8.0`), for the `GateResult` ternary the `liveStateSurface` and CI-mechanics modules build on rather than reinvent.

## Licence

MIT
