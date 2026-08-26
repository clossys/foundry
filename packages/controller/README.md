# @vespeneventures/controller

<!-- controller-role-contract:start -->
## Control-loop contract

This block is derived from the schema-v4 role contract shipped with this
package. The consumer (the client operating the loop) owns its concrete
setpoint and review cadence; Controller supplies neither.

**Job.** Are the business's operating rules expressible, current, and followed?

**Metric.** rule conformance rate: declared rules independently observed well-formed and followed / all declared rules evaluated (ratio; increase).

**Mode.** reconcile.

**Secondary modes.** None.

**Stages.** `sense` → `judge` → `act` → `verify` → `learnOrEscalate`.

**Boundary.** Owns Operating-rule grammar, identity, lifecycle, and content binding. It excludes `judging a proposed change`, `materializing declared state`, `authorizing provider mutations`.

**Close condition.** Independent consumer evidence shows the position's owned metric meets its setpoint over the declared review cadence.
<!-- controller-role-contract:end -->

This is a rename and a merge, not a rewrite: the former package surfaces are
now provided by this package's subpaths. The former package names are retired;
new integrations use the current subpaths directly.

```bash
npm install @vespeneventures/controller
```

## Boundaries

`controller` does not write a scaffold, invoke a declared command, publish a
package, deploy anything, read credentials, or supply a provider setting. A
caller owns all of those actions and values.

- `planNewPackage` is creation planning only: without a profile, it returns a
  private starter and explicit remaining actions. It does not touch disk. A
  profile is owned by the consuming repository and supplies its actual
  metadata, tooling, license text, and dated changelog entry.
- `validatePackageLifecycle` is a pure schema check. It distinguishes an
  incubating source package, a published package, a qualified package, and an
  adopted package. Deprecated and retired packages need a viable replacement
  and range (or a terminal no-successor reason), dated evidence, and durable
  decision and migration references.
- `runGovernanceCheck` calls the included `./gates` subpath for real
  workspace discovery and deterministic build order, then requires the
  lifecycle registry to match that catalog exactly.
- `preflightGovernedPackage` calls the included `./release` subpath for its
  packed-install proof and adds the workspace governance result. It does not
  publish or authenticate. A private registry proof remains the caller's
  deliberate release operation.
- `./cleanup`'s `classifyCleanupCandidate` performs **no I/O of any kind** —
  no Git, no filesystem, no GitHub, no scheduler, no credential, no network,
  and no deletion. It classifies caller-gathered evidence and returns a
  typed proposal; see its own section below for the full boundary, and note
  in particular that this subpath exports **no deletion API at all**.

## Package-process subpaths

Install `@vespeneventures/controller` once and import the focused capability
you need. The root exposes lifecycle-registry validation and package-scaffold
planning APIs; it does not declare that a package has completed the
repository's seven-state evidence ladder. That ladder is derived separately
from recorded producer and consumer evidence. The subpaths keep their
established contracts separate without making consumers select many separately
versioned packages.

| Subpath | Includes |
| --- | --- |
| `@vespeneventures/controller/catalog` | Workspace discovery and dependency-graph evaluation. |
| `@vespeneventures/controller/gates` | Foundation checks, deterministic build order, a ratchet primitive, override-range and dependency-scope gates, and `foundry-check`. Does **not** require `typescript` — the source-aware secret-surface gates that need it moved to `./gates/secrets` (below) as of this version; see "Requirements" for why. |
| `@vespeneventures/controller/gates/secrets` | Source-aware secret-surface gates: credential inventory, provider-resource naming, local secret files, and raw-secret-read AST detection. Requires `typescript` — install it to use this subpath; `./gates` itself does not need it. **Breaking change from earlier versions:** these exports used to live on `./gates` directly; import them from here instead. |
| `@vespeneventures/controller/release` | Isolated packed-artifact and installed-import proof. |
| `@vespeneventures/controller/repository` | Consumer-owned repository profiles, upward requirements, exact-root declarations, pure evaluation, `repository-check`, and the full runner (`runRepositoryProfileCheck` / `repository-profile-check`). |
| `@vespeneventures/controller/positions` | Pure installed-position ledger and completion-evidence validation. `foundry-position-check <ledger.json> [role-contract.json]` validates positions only. `foundry-completion-evidence-check <completion-evidence.json> <position-ledger.json>` validates one linked consumer-retained record for an open position: an exact-version artifact declaration with retained references, recorded invocation and distinct red/green controls, duplicate disposition and rollback records, linked review-cadence evidence, and separately attributed before/after outcome and close-window verdicts. Reference and locator strings have a 65,536-code-unit cap and lexically reject explicit inline sensitive-payload assignments and URL authority userinfo after bounded percent decoding plus NFKC/case/default-ignorable normalization and a separate URL-style tab/CR/LF authority scan; form-style `+` is treated as a label separator only at root/query/fragment assignment contexts. Ordinary identifiers containing those words remain valid. Evidence instants are known-offset RFC3339 with at most millisecond precision and obey `before < invocation/red/green ≤ rollback ≤ after ≤ startedAt < satisfied recurrence ≤ endedAt`. A violated or indeterminate in-window cadence result prevents satisfaction. The outcome retains the position baseline and source locator, moves into the linked setpoint, and cannot be owned by the position action authority. References, authorship, provider truth, and adoption are not authenticated or inferred. |
| `@vespeneventures/controller/review` | Provider-neutral review evidence contracts, validation, and `review-check`. |
| `@vespeneventures/controller/review/github` | Pure normalization of caller-provided GitHub-shaped review evidence. |
| `@vespeneventures/controller/artifacts` | Deterministic, fail-closed verification for a consumer-owned governed artifact: declared kind + schema version, exact-content checksum, and structural provenance. |
| `@vespeneventures/controller/cleanup` | Pure workspace-cleanup classification: caller-normalized inventory and observations in, a typed `owned` / `safe-candidate` / `blocked` proposal out. No I/O, no deletion API. |
| `@vespeneventures/controller/composition` | Pure caller-owned cross-plane constraint, supply, decision, exception, and effective-value resolution. |
| `@vespeneventures/controller/conventions` | Account-neutral agent conventions two parties can share without either owning the other: branch provenance, skill naming, agent interoperability, routine and schedule declarations, CI gate naming, and the capability-first skill registry. Ships the documents/adapters below as defaults and enforces only their grammar — never byte-identity with its own prose. |
| `@vespeneventures/controller/conventions/documents/*` | The shipped convention documents themselves (`branch-provenance.md`, `skill-grammar.md`, `agent-interoperability.md`, `routine-declaration.md`, `schedule-declaration.md`, `live-state-reconciliation.md`, `skill-registry.md`, `machine-guidance.md`, `machine-baseline.md`, `gate-naming.md`, `runner-conventions.md`) as real files a provisioning step can copy or template onto a machine. |
| `@vespeneventures/controller/conventions/adapters/*` | The shipped adapter files (`agent-policy.rules`, `shell-integration.zsh`, `branch-provenance-hook.sh`, `heavy-cmd-hook.sh`, `scoped-main-push.sh`, `workspace-shell.zsh`) as real files, same shape as the documents above. |
| `@vespeneventures/controller/policy` | The content-addressed `PolicyBinding` primitive: compute a digest, validate a binding's shape, verify a binding against materialized content. Zero I/O, zero dependency of its own — the primitive `./gates` and `./artifacts` bind rules and artifacts to documents with, without ever committing the document itself. |

`@vespeneventures/controller/positions` exports
`validateInstalledPositionLedger`, `validateInstalledPositionContract`,
`validateCompletionEvidence`, `validateCompletionEvidenceContract`, and the
corresponding field vocabularies: `POSITION_FIELDS`,
`POSITION_RECOMMENDATIONS`, `WORKER_COMPONENT_KINDS`, `REFERENCE_VALUE_RULE`,
`COMPLETION_EVIDENCE_FIELDS`, `COMPLETION_EVIDENCE_INDETERMINATE_REASONS`,
`COMPLETION_VERDICTS`, `DUPLICATE_STATES`, `INVOCATION_KINDS`, and
`PLACEMENT_MODES`. `InstalledPositionFinding`, `InstalledPositionLedgerReport`,
`CompletionEvidenceFinding`, `CompletionEvidenceIndeterminateReason`, and
`CompletionEvidenceReport` expose pure results. Completion evidence reuses the
shared `satisfied` / `violated` / `indeterminate` result grammar: it validates
the shape and linkage of consumer-retained evidence, refuses the measured
package or position as its own outcome owner, and derives the outcome verdict
from the shipped role's metric direction plus the linked position's setpoint.
Its proof is fail-closed: exact semver and RFC3339 evidence (at most
millisecond precision) must retain the
linked open position's baseline, source locator, and review cadence;
the outcome must move into the role setpoint; and the causal sequence is
`before < invocation/red/green ≤ rollback ≤ after ≤ startedAt < recurrence ≤ endedAt`.
A violated or indeterminate cadence run in that window cannot be hidden by a
satisfied one. It validates supplied consumer-retained records only; it does
not infer a provider observation from them.

Reference safety is a lexical backstop, not a secret scanner: a reference has
a 65,536-code-unit cap; after bounded percent decoding plus NFKC, case,
default-ignorable, and form-style `+` normalization in root/query/fragment
assignment contexts, with a separate URL-style tab/CR/LF authority scan, it rejects only
explicit sensitive-category labels carrying a nonempty `:` or `=` payload.
Ordinary identifiers that merely contain those
words remain valid. Unicode default-ignorables are removed for this lexical
check and for linked position/action-authority identity comparison; no
reference is resolved or authenticated.

The installed-position ledger keeps its schema-v1 compatibility rule that a
baseline `observedAt` is nonempty text. Completion validation is deliberately
stricter: that linked baseline must be exactly retained by a readable outcome
observation whose RFC3339 instant has at most millisecond precision before it
can support a completion result.
It never claims a provider observation is true, installs a package, or
measures a provider itself.

### `./artifacts`: governed artifact verification

A reusable contract for verifying a consumer-owned governed artifact that
combines a declared kind + schema version, an exact-content checksum, and
structural source/revision provenance — closing the gap issue #195 opened
over: a checksum could pass while the schema version was unsupported, or
provenance could be attached without ever being checked.

```ts
import { verifyGovernedArtifact, verifyGovernedArtifacts } from "@vespeneventures/controller/artifacts";
import type { GovernedArtifactManifest, GovernedArtifactVerificationOptions } from "@vespeneventures/controller/artifacts";

const manifest: GovernedArtifactManifest = {
  kind: "widget-catalog",
  schemaVersion: "2",
  checksum: { algorithm: "sha256", digest: "…64 lowercase hex characters…" },
  provenance: { source: "https://example.invalid/repo", revision: "abc123" },
};

const options: GovernedArtifactVerificationOptions = {
  artifactKind: "widget-catalog",
  supportedSchemaVersions: ["1", "2"],
};

const findings = verifyGovernedArtifact(manifest, rawContentBytes, options);
if (findings.length > 0) process.exitCode = 1;
```

#### The verification order is fixed, deterministic, and documented

`verifyGovernedArtifact` runs five stages, always in this order, and
short-circuits on the first stage that reports an error:

1. **Caller options** — `artifactKind` non-empty, `supportedSchemaVersions`
   non-empty. An empty `supportedSchemaVersions` is a **caller
   configuration error**, never an artifact that trivially passes.
2. **Manifest structure**, including provenance shape (presence and shape
   only — folded into the one mandatory stage every successful verification
   passes through, so provenance can never be attached without being
   checked).
3. **Artifact kind** — `manifest.kind` must equal `options.artifactKind`.
4. **Schema version** — `manifest.schemaVersion` must be one of
   `options.supportedSchemaVersions`. Checked **before** the checksum,
   deliberately: this is the exact ordering #195 was opened over. An
   unsupported schema version is rejected even when the bytes match exactly.
5. **Exact-content checksum** — delegated entirely to
   `@vespeneventures/controller/policy`'s own `verifyBinding`; this package hashes
   nothing itself. Checked last, both because it is the most expensive
   check and because checking it last means a caller can never see a
   passing checksum for an artifact whose kind or schema version were never
   actually accepted.

`verifyGovernedArtifact` returns `[]` only after all five stages ran and
every one produced zero error findings — there is no path that returns `[]`
having skipped a stage. See `src/artifacts/verify.ts`'s own doc comment for
the full reasoning and `src/artifacts/verify.test.ts` for tests that use
fixtures broken at more than one stage simultaneously to prove only the
earliest stage's findings are ever reported.

`verifyGovernedArtifacts(entries, options)` verifies a batch sharing one
trust configuration, prefixing each finding's `path` with that entry's own
`id`. An **empty** `entries` array is itself a failure
(`"artifact/empty-batch"`), never a clean `[]` — the same
"a check that cannot run must fail" discipline documented in
[CONTRIBUTING.md](../../CONTRIBUTING.md) (precedent: commit `01bd520`).

#### What a clean result proves, and what it does not

A clean result proves the manifest is structurally well-formed (including
provenance), its `kind` and `schemaVersion` are both accepted by the
caller, and `content` is byte-for-byte identical to what the checksum
committed to. It **never** proves the payload is semantically valid under
that schema version (schema-specific validation stays entirely
caller-owned), that `provenance.source`/`provenance.revision` are genuine
or that the named revision actually produced this content (only their
shape is checked, never their truth), or — the sharpest distinction —
**who produced the content**. Matching content is not attribution: a
checksum proves bytes are unchanged from what was committed to, never who
committed to them. This subpath implements no signature or
identity-attestation scheme.

#### Digest comparison is delegated, not reimplemented

`checksum.algorithm` is typed as `@vespeneventures/controller/policy`'s own
`DigestAlgorithm` — currently just `"sha256"` — rather than a second,
independent union, so this contract can never claim to accept an algorithm
`policy` itself does not support. Both the digest's SHAPE (is it the right
number of lowercase hex characters for its algorithm) and its VALUE (does
it match `content`) are checked by handing a small synthetic
`PolicyBinding` to `policy`'s own `validateBindingShape`/`verifyBinding` —
this package never re-derives which algorithms are known, how long a
digest should be, or how to hash anything.

#### Fail-closed vocabulary

Every finding is a `Finding` from `@vespeneventures/controller/policy`, shaped
`{ rule, severity, message, path? }` and re-exported from this subpath.
Rules prefixed `artifact/` are owned here; `policy-id-shape`,
`digest-algorithm-known`, `digest-shape`, and `digest-mismatch` are
`@vespeneventures/controller/policy`'s own rule names, passed through verbatim so a
caller can see exactly which layer reported the problem. See
`GovernedArtifactFindingRule` (documentation-only — `Finding.rule` itself
stays plain `string`) for the full vocabulary.

The package owns structural metadata validation and deterministic
orchestration only. The consumer owns artifact bytes, semantic decoding,
schema-specific validation, storage, transport, and trust policy —
including deciding what `provenance.source`/`provenance.revision` actually
mean and whether to trust them.

### `./gates` additions: ratchet, override bounds, dependency scope, gate-result ternary

Three small, independent, pure gates alongside the existing foundation,
build-order, and policy checks — none of them do I/O; a caller reads
whatever real data each one needs and passes it in. A fourth addition, the
gate-result ternary below, is not a gate itself but the shared vocabulary
the other three (and `foundry-check`'s own CLI) already independently
converged on. (The source-aware secret-surface checks that used to be
listed alongside these now live at `./gates/secrets` instead — see
"Requirements" below for why they moved.)

#### The gate-result ternary: `satisfied` / `violated` / `indeterminate`

Every gate result in this repository is exactly one of three states, never
collapsed into a binary pass/fail: `satisfied` (evaluated, condition
holds), `violated` (evaluated, condition does not hold), or `indeterminate`
(could not evaluate — fails closed, and carries a required, machine-readable
reason). This is not new: `foundry-check`'s own CLI already ships this
ternary as its 0/1/2 exit-code contract, `evaluateRatchet`'s `status: "clean"
| "regression" | "invalid"` is the identical three states under different
names, and Designer, Writer, and Strategist each independently
reinvented a third shape (`unchecked: UncheckedItem[]`, non-empty meaning
"cannot vouch for this scan"). `GateResult` is that shape, named once, so
the next gate reuses it instead of reinventing it a fifth time.

```ts
import {
  createGateReasons,
  foldGateResults,
  gateResultToExitCode,
  gateSatisfied,
  gateViolated,
} from "@vespeneventures/controller/gates";

// A gate declares its own finite, reviewable set of indeterminate reasons.
const reasons = createGateReasons(["missing-credential", "no-applicable-inputs"] as const);

function evaluateOne(input: RegistryProbe) {
  if (input.token === undefined) return reasons.indeterminate("missing-credential");
  return input.registryReachable ? gateSatisfied(1) : gateViolated(["registry unreachable"]);
}

const overall = foldGateResults(probes.map(evaluateOne), { emptyReason: "no-applicable-inputs" });
process.exitCode = gateResultToExitCode(overall); // 0 satisfied / 1 violated / 2 indeterminate, unconditionally
```

`gateSatisfied(evaluated)` refuses to construct a passing result unless
`evaluated` is a positive integer — the mechanical form of the meta-check
this contract exists to enforce: a gate built on this function cannot
report a pass on a code path that evaluated nothing. `createGateReasons`
scopes `indeterminate()` to exactly the reasons a gate declares up front;
naming an undeclared reason throws rather than silently widening what
"indeterminate" means for that gate. `gateResultToExitCode` takes no
override — `indeterminate` always maps to `2`, never `0`, regardless of
reason; see this function's own doc comment for why that is a deliberate,
non-configurable choice. `assertNeverVacuouslySatisfied(evaluate, input)`
is a reusable regression-test helper: call it with an input engineered to
produce no real evaluation and it throws if the gate under test reports
`satisfied` anyway. `gateResultFromRatchet(result)` converts an existing
`evaluateRatchet` result into this shape, as a worked proof that the two
are the same contract rather than parallel ones.

#### `evaluateRatchet(current, baseline)`

A generic "warn-first with a checked-in baseline, ratchet monotonically
toward zero" primitive — count whatever a caller wants to track down to
zero (lint warnings, TODOs, `any` usages, anything), read a checked-in
baseline, and call this with both numbers.

```ts
import { evaluateRatchet } from "@vespeneventures/controller/gates";

const result = evaluateRatchet(currentWarningCount, baselineFromDisk);
if (!result.ok) process.exitCode = result.status === "invalid" ? 2 : 1;
```

| `current` vs `baseline` | `ok` | `status` | Notes |
| --- | --- | --- | --- |
| `current === baseline` | `true` | `"clean"` | `improved: false`, no findings. |
| `current < baseline` | `true` | `"clean"` | `improved: true` plus a `"ratchet/baseline-stale"` **warning** finding — real progress, reported explicitly, never silently dropped. Lowering the baseline is always a separate, explicit action; this function never does it for you. |
| `current > baseline` | `false` | `"regression"` | A `"ratchet/regression"` **error** finding. |
| either input is nonsense | `false` | `"invalid"` | A negative or non-integer `current`/`baseline`, or a missing (`undefined`/`null`) baseline, fails closed — this is "could not run", not a clean or regressed result, and `current`/`baseline` are not echoed back. |

#### `checkOverrideTargetRanges(overrides)`

A package.json `overrides` entry's target range must be upper-bounded to
the vulnerable major — never a bare `>=x.y.z`. An unbounded target lets a
resolver hoist a dependent across a major version boundary and break it at
runtime; a security audit cannot catch this class of break, since an audit
only confirms the vulnerable version is gone, never that the replacement
stays API-compatible with what depends on it.

```ts
import { checkOverrideTargetRanges } from "@vespeneventures/controller/gates";

checkOverrideTargetRanges({ "left-pad": ">=1.2.3" });
// -> one "overrides/range-unbounded" finding
checkOverrideTargetRanges({ "left-pad": ">=1.2.3 <2.0.0" });
// -> []
```

Range parsing is hand-rolled (no semver dependency) and deliberately
narrow. It recognizes exactly: an exact pin (`"1.2.3"`, `"=1.2.3"`), a `~`
or `^` range, an explicit space-hyphen-space range (`"1.2.3 - 2.0.0"`), and
a single or paired `>=`/`>`/`<`/`<=` comparator range. Anything else — OR
ranges (`"... || ..."`), x-ranges/wildcards, dist-tags, git/file/workspace
specifiers, three or more space-separated comparators — is reported as
`"overrides/range-unparseable"`, a finding, not a pass: an unparseable
range is exactly the case where this gate must not assume the best.

#### `checkDependencyScope(catalog, scope, allowlist, options?)`

Mechanical enforcement of [CONTRIBUTING.md](../../CONTRIBUTING.md)'s
"Dependencies: the default answer is no": every `dependencies` entry in a
`packages/*/package.json` must be `<scope>/*`-scoped, unless it is named in
a small, checked-in allowlist entry.

```ts
import { buildCatalog } from "@vespeneventures/controller/catalog";
import { checkDependencyScope } from "@vespeneventures/controller/gates";

const catalog = buildCatalog(process.cwd());
const allowlist = JSON.parse(readFileSync("dependency-scope-allowlist.json", "utf8"));
const findings = checkDependencyScope(catalog, "@example", allowlist);
```

| Allowlist entry field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | The exact, non-scoped dependency name being exempted. Non-empty. |
| `reason` | `string` | Why this dependency was deliberately admitted. Non-empty. |
| `reviewBy` | `string` | `YYYY-MM-DD`. Once passed, the entry stops exempting anything and is itself reported as `"dependency-scope/allowlist-expired"`. |

```json
{ "version": 1, "entries": [] }
```

A malformed allowlist document or entry is a finding
(`"dependency-scope/allowlist-shape"` / `"dependency-scope/allowlist-entry-shape"`)
and exempts nothing — never a silent exemption. Deliberately scoped small:
every runtime dependency in this repository was verified by inspection to
already be `@vespeneventures/*`-scoped, so this is a floor that matches
that reality today, not a full dependency admission-and-retirement
register; it can grow richer if a third-party runtime dependency is ever
legitimately admitted.

### `./repository`: profiles, requirements, and exact roots

`@vespeneventures/controller/repository` owns a strict grammar and pure,
deterministic evaluation. It ships no profile, root entry, requirement,
observation, repository inventory, machine value, precedence rule, retention
decision, or default. It performs no filesystem, Git, provider, scheduler,
credential, installation, or mutation I/O. A caller owns discovery and every
name and value supplied to the validators.

Importing either this public subpath or its importable CLI API is inert: it
does not inspect the filesystem or process arguments, write output, change an
exit code or environment value, or mutate arguments. The installed
`repository-check` command enters through a separate executable-only wrapper;
only an explicit command invocation reads the requested profile and reports.

#### Canonical declaration location (issue #315)

A consumer's declaration lives at `governance/repository-profile.json` —
`CANONICAL_REPOSITORY_PROFILE_PATH`, exported alongside the schema version
constants below. This is settled, not merely a convention: an aggregator has
to know where to look, and "wherever that repository decided" defeats the
point of packaging one evaluator for every consumer to share.

Locating a declaration is `repository-check`'s job, not this subpath's — the
pure library still performs no I/O. Run with no argument, or with a directory
argument, and the CLI searches that root for a declaration without being told
exactly where it is:

```console
$ repository-check                      # searches the current working directory
$ repository-check path/to/repository   # searches an explicit repository root
$ repository-check path/to/profile.json # validates exactly that file, no search
```

The canonical path is always checked first and, when present, is always what
gets used — nothing found elsewhere can shadow it. When nothing is at the
canonical path, the search continues for a declaration parked somewhere else
(the canonical filename under another directory, or a known former filename
under the canonical directory). A declaration found there is never reported
the same way as no declaration at all: it produces its own
`declaration-non-canonical-location` finding, distinct from
`declaration-not-found`, so a repository that has a declaration in the wrong
place is never read as a repository that declares nothing.

Requirements flow one way: a repository declares what it needs, an account
workspace discovers and aggregates those declarations, and machine bootstrap
may use the resulting report to compose an explicit configuration. Guidance
and mutation do not flow upward through this API. If a caller later chooses to
apply a configuration, it resolves that manifest itself and passes it to a
separate engine; this subpath neither produces nor applies one.

Repository-root vocabulary belongs here because it describes the direct
children of one repository. Account-container discovery and composition do not:
they coordinate multiple repositories and stay caller-owned. For that reason
this package adds no broad top-level workspace package and no
`@vespeneventures/controller/workspace` subpath.

#### Profile schema v3

```ts
import {
  REPOSITORY_PROFILE_VERSION,
  validateRepositoryProfile,
  type RepositoryProfileV3,
} from "@vespeneventures/controller/repository";

const profile: RepositoryProfileV3 = {
  schemaVersion: REPOSITORY_PROFILE_VERSION,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [".github/workflows/**"],
  requirements: [
    {
      id: "runtime.example",
      scope: "machine",
      constraint: { kind: "one-of", values: ["variant-a", "variant-b"] },
    },
    {
      id: "tool.formatter",
      scope: "repository",
      constraint: { kind: "present" },
    },
    {
      id: "runtime.node",
      scope: "machine",
      constraint: { kind: "minimum-version", floor: "20" },
    },
  ],
  rootEntries: [
    { name: "source", classification: "canonical", disposition: "required" },
    { name: ".tooling", classification: "extension", disposition: "allowed" },
    { name: "special-case", classification: "exception", disposition: "allowed" },
    { name: "old-link", classification: "compatibility-alias", disposition: "prohibited" },
    { name: "archive", classification: "legacy-artifact", disposition: "allowed" },
  ],
};

const findings = validateRepositoryProfile(profile);
```

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `3` | New declarations use `REPOSITORY_PROFILE_VERSION`. The closed v1 and v2 shapes remain accepted deliberately; see compatibility below. |
| `defaultBranch` | `string` | A valid Git branch name. |
| `commands` | `RepositoryCommand[]` | Ordered, dense array (at most 10,000 entries); names are unique. |
| `protectedPaths` | `string[]` | Ordered, dense repository-relative paths or the supported `*`/`**` patterns; duplicates are rejected. |
| `requirements` | `RepositoryRequirement[]` | Ordered, dense array of unique `(scope, id)` declarations. Foundry supplies no entries. |
| `rootEntries` | `RepositoryRootEntry[]` | The caller's exact direct-child vocabulary. Names are unique single path segments; every entry has an explicit classification and disposition. |

#### Requirement-id grammar (issue #316)

A requirement id is exactly two dot-separated segments, `<category>.<subject>`,
where `category` is one of `REQUIREMENT_ID_CATEGORIES` (`runtime`, `tool`,
`dependency`) and `subject` is lowercase words joined by hyphens — for example
`runtime.node`, `tool.git`, `tool.package-manager`, `dependency.controller`.

The governing principle: **the id names the slot, the constraint names the
value.** Two planes evaluating the same capability must arrive at the same
id regardless of which value each currently accepts — an id that bakes in its
own precision or answer (`runtime.node.major`, adding a granularity segment
the constraint already owns; `package-manager.npm`, folding the concrete tool
into what should be the category) makes that impossible: the same slot then
reads as two unrelated requirements. `validateRepositoryProfile` and the
requirements evaluator both reject an id shaped like that with a
`requirement-id-value-embedded` finding rather than accepting it — the drift
is reported, never silently re-introduced. A malformed id that isn't even
shaped like `<category>.<subject>` (wrong characters, an empty segment, no
category at all) is the more generic `requirement-id` finding instead.

A requirement's scope is:

- `repository`: resolved independently for the declaration source;
- `workspace`: shared by every declaration in one caller-selected evaluation;
- `machine`: shared by every declaration in one caller-selected evaluation.

These labels describe a requirement's resolution domain only. They do not
define discovery layout or account-container precedence. Profile v3 adds the
separate root-entry vocabulary because that vocabulary is repository-local.

`{ kind: "present" }` accepts any conclusive observed value. `{ kind:
"one-of", values: [...] }` accepts only the caller-enumerated values. Multiple
workspace- or machine-scoped `one-of` declarations are compatible when their
value intersection is non-empty.

`{ kind: "minimum-version", floor: "20" }` (issue #318) accepts any observed
value at or above `floor` — the open-ended shape neither `present` nor
`one-of` can honestly express: an `engines.node: ">=20"`-style requirement is
not "Node must merely exist" (`present` understates it) and not an
exhaustive, closed enumeration of every accepted major (`one-of` requires a
list that goes stale the moment a new satisfying value is released). `floor`
is a bare dotted-numeric version string — `"20"`, `"20.11"`, or `"10.33.0"` —
never a range operator (`>=20` itself is rejected as an unparseable floor).
Multiple declared floors for the same requirement combine by keeping the
strictest (highest); combined with a `one-of` declaration for the same
requirement, the two are jointly required and report `conflicting` when no
accepted value clears the floor. An observed value that does not itself
parse as a dotted-numeric version is `unsatisfied`, never `satisfied` — an
unparseable floor on the constraint itself is a strict-shape `constraint-floor`
finding, reported through the same closed `status: "invalid"` path as every
other malformed constraint, never silently treated as satisfied.

The evaluator exposes the compatible `one-of` intersection and the binding
`minimum-version` floor but never selects a value or decides precedence
beyond combining what the declarations themselves state.

#### Pure multi-repository evaluation

```ts
import { evaluateRepositoryRequirements } from "@vespeneventures/controller/repository";

const report = evaluateRepositoryRequirements({
  declarations: [
    { source: "account/repository-a", requirements: profile.requirements },
    {
      source: "account/repository-b",
      requirements: [{
        id: "runtime.example",
        scope: "machine",
        constraint: { kind: "one-of", values: ["variant-a"] },
      }],
    },
  ],
  observations: [
    { id: "runtime.example", scope: "machine", state: "observed", value: "variant-a" },
    { id: "tool.formatter", scope: "repository", source: "account/repository-a", state: "observed", value: "available" },
  ],
});
```

Each valid requirement result has exactly one status:

| Status | Meaning |
| --- | --- |
| `satisfied` | Conclusive caller-supplied evidence satisfies the compatible declaration. |
| `unsatisfied` | Evidence says the capability is absent or its observed value is not accepted. |
| `conflicting` | Shared declarations have no common accepted value. Observation cannot override a declaration conflict. |
| `unknown` | Evidence is explicitly `unknown` or no observation was supplied. This fails closed and emits `requirement-unknown`. |

Malformed input returns top-level `status: "invalid"`, no partial requirement
results, and strict shape findings. Otherwise the report includes every
requirement result and every non-satisfied finding; one bad requirement never
hides another. Overall status precedence is `conflicting`, `unknown`,
`unsatisfied`, then `satisfied`, while the per-requirement entries preserve all
four distinctions.

Observations are normalized facts, not discovery instructions. `state` is
`observed`, `absent`, or `unknown`; only `observed` carries `value`.
Repository-scoped observations must name their declaration `source`, and
shared observations must not. Duplicate declarations, requirements,
constraint values, sources, and observations are rejected rather than merged
silently.

#### Pure exact-root evaluation

```ts
import { evaluateRepositoryRoot } from "@vespeneventures/controller/repository";

const rootReport = evaluateRepositoryRoot({
  rootEntries: profile.rootEntries,
  observedEntries: ["source", ".tooling", "archive"],
});
```

The caller discovers direct children and passes only their names. Foundry
compares those normalized observations with the declaration:

- `required` must be observed;
- `allowed` may be observed;
- `prohibited` must not be observed;
- every observed name absent from `rootEntries` is `unknown` and fails closed.

`canonical`, `extension`, `exception`, `compatibility-alias`, and
`legacy-artifact` classify why a caller declared an entry. They imply no
disposition: aliases and legacy artifacts still require the caller to choose
`required`, `allowed`, or `prohibited` explicitly. This is how compatibility
and retention choices stay visible without Foundry deciding whether anything
should be kept or removed.

Malformed input returns `status: "invalid"` with no partial entry results.
Valid but nonconforming input returns every missing required entry, observed
prohibited entry, and unknown direct child in one deterministic report. The
evaluator never scans a directory, resolves an alias, deletes an artifact, or
mutates its inputs.

#### The runner: `runRepositoryProfileCheck` and `repository-profile-check` (issues #321, #324)

Everything above is the contract: schema, validator, pure evaluators. None of
it locates a declaration, observes a repository's real state, or decides an
exit code — that is a separate job, and shipping the contract without it
left five consumer repositories to each hand-write their own runner for one
purpose. Three of them even shared a filename, with three different hashes.
Every one of those five had to independently get the same property right: a
check that cannot run must not report success. It already shipped wrong
once — one hand-written runner parsed a declaration as JSON and handed it
straight to its own evaluation logic without validating the schema first, so
a `commands` value that was a string got iterated character by character,
every character "evaluated" to nothing, and the runner reported a clean
result against a declaration it had never actually understood.

`runRepositoryProfileCheck` is the one runner. It locates nothing itself —
that stays the caller's job, exactly as it already is for `repository-check`
above — but it does the rest: validate the declaration's schema
unconditionally, before evaluation is even attempted; evaluate its declared
requirements and root vocabulary against caller-injected discovery; and
resolve everything to exactly one of this repository's shared ternary
verdicts (`@vespeneventures/controller/gates`'s `GateResult`:
`satisfied` / `violated` / `indeterminate`).

```ts
import { runRepositoryProfileCheck, REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE } from "@vespeneventures/controller/repository";

const result = runRepositoryProfileCheck({
  declaration: { kind: "parsed", path: "governance/repository-profile.json", canonical: true, value: profile },
  requirementObservations: [
    { id: "runtime.node", scope: "machine", state: "observed", value: "20" },
    {
      id: "tool.package-manager",
      scope: "repository",
      source: REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
      state: "observed",
      value: "npm",
    },
  ],
  rootObservedEntries: ["README.md", "src"],
});
```

**Discovery is injected, never performed by this function.** The five
hand-written runners differed mostly in HOW they observed reality — one
shelled out to `git ls-tree`, others read the filesystem directly, one
cross-referenced a manifest. `runRepositoryProfileCheck` takes those
observations as already-collected, caller-normalized data — the exact shapes
`evaluateRepositoryRequirements` and `evaluateRepositoryRoot` already accept
— and performs no filesystem, Git, process, or network I/O of its own. That
keeps it hermetically testable and working in a sandboxed CI runner with no
shell or network access, and it is why `RepositoryProfileRunInput.declaration`
is a plain discriminated union (`not-found` / `unreadable` / `invalid-json` /
`parsed`) rather than a path this function reads itself — resolving that
union is `repository-profile-check`'s job (below), the same division
`repository-check`'s own CLI already established.

`rootObservedEntries: undefined` and `rootObservedEntries: []` are
deliberately different inputs. `[]` is a real, evaluable observation ("the
root has zero direct children"); `undefined` means root discovery never
ran at all. Collapsing the two would turn "I never looked" into "I looked
and found nothing" — for a profile that declares any `required` root entry,
a false `violated` where the honest answer is `indeterminate`.
`requirementObservations` needs no equivalent split: `RepositoryRequirementObservation`'s
own `state` already carries `unknown` as a first-class value, and
`evaluateRepositoryRequirements` already folds an entirely absent
observation to that same `unknown` state per requirement, so an empty array
is already indistinguishable, in its effect, from "nothing was observed."

| `declaration.kind` | Verdict | Reason it isn't `satisfied` |
| --- | --- | --- |
| `not-found` | `violated` | Conclusively determined (the whole tree was searched), not missing evidence. |
| `unreadable` / `invalid-json` | `indeterminate` | Nothing conclusive can be evaluated from unreadable input. |
| `parsed`, fails `validateRepositoryProfile` | `indeterminate` | **Never routed into either evaluator, unconditionally** — the exact defect described above. |
| `parsed`, valid, non-canonical location | `violated` | Conclusively determined; bundled with any requirement/root findings. |
| `parsed`, valid, a declared requirement has no observation | `indeterminate` | Fails closed on incomplete evidence, same as `evaluateRepositoryRequirements`'s own `unknown` status. |
| `parsed`, valid, root entries declared but `rootObservedEntries` is `undefined` | `indeterminate` | Discovery never ran; never silently evaluated as an empty root. |
| `parsed`, valid, every declared axis evaluated and holds | `satisfied` | The only path that reaches it. |

**Custom axes for derived cross-reference checks (issue #324).** The two
built-in axes above cover the requirements axis and the root-vocabulary
axis. They do not cover a DERIVED comparison against a consumer's own
source of truth — checked against real evidence found in two independent
consumer repositories: one cross-references `commands[].run`'s
`npm run <script>` against its manifest's real `scripts` map and
`protectedPaths` against the live path-matching predicate in its own
merge-governance workflow, clause by clause; another verifies a `run` file
path exists on disk and that each `protectedPaths` entry's basename is
referenced across a set of governance files. Neither can be expressed as a
`RepositoryRequirementObservation` or a root entry — a migration that
dropped them would convert a real evaluation into silence, exactly the
failure mode this package exists to prevent.

`RepositoryProfileRunInput.customAxes` is the fix: an optional list of
already-evaluated `{ name, result }` pairs, where `result` is a
`GateResult` the CALLER produced by performing whatever repository-specific
comparison it alone can do. This module never learns what `name` means and
never inspects a manifest, workflow file, or governance document itself —
it only folds `result` through the exact same `foldGateResults` call as the
two built-in axes above, so a custom axis gets the exact same precedence:
`indeterminate` beats `violated` beats `satisfied`, even when every
built-in axis is fully satisfied.

```ts
const result = runRepositoryProfileCheck({
  declaration: { kind: "parsed", path: "governance/repository-profile.json", canonical: true, value: profile },
  requirementObservations: [],
  rootObservedEntries: undefined,
  customAxes: [
    {
      name: "commands-vs-manifest-scripts",
      result: { verdict: "satisfied", evaluated: profile.commands.length },
      // or, having found a mismatch:
      // result: { verdict: "violated", findings: [{ rule: "command-script-missing", severity: "error", path: "$.commands[0].run", message: "..." }] }
      // or, unable to read the manifest at all:
      // result: { verdict: "indeterminate", reason: "manifest-unreadable", detail: "..." }
    },
  ],
});
```

A custom axis whose `result` is not itself a well-formed `GateResult` —
missing `verdict`, a `satisfied` with no positive `evaluated`, a `violated`
with empty `findings`, an `indeterminate` with no `reason` — is never
ignored and never treated as `satisfied`. It folds to `indeterminate` under
`custom-axis-invalid`, naming which axis was malformed; a well-formed
`indeterminate` custom axis folds under `custom-axis-indeterminate`,
quoting the axis's own `name` and `reason` in its `detail` so a caller
reading the output can always tell which custom axis was responsible.
Omitting `customAxes` entirely is identical to supplying `[]` — every
caller from before issue #324 keeps working unchanged.

`repository-profile-check` is the single command wrapping this function:
it locates a declaration exactly the way `repository-check` does
(issue #315 — the canonical location is always checked first), reads one optional
`--discovery <file>` JSON file for the injected observations, and exits
`0` / `1` / `2` through `gateResultToExitCode`.

```console
$ repository-profile-check                                    # searches the current working directory, no discovery
$ repository-profile-check path/to/repository --discovery observed.json
```

```json
{
  "requirementObservations": [
    { "id": "runtime.node", "scope": "machine", "state": "observed", "value": "20" }
  ],
  "rootObservedEntries": ["README.md", "src"],
  "customAxes": [
    { "name": "commands-vs-manifest-scripts", "result": { "verdict": "satisfied", "evaluated": 1 } }
  ]
}
```

All three discovery keys are optional and independent; omitting
`--discovery` entirely is exactly `{}`. `customAxes` (issue #324) carries
already-evaluated results for a derived cross-reference check the CLI has
no way to compute itself — reading it out of this same file is not new I/O,
and producing the comparison remains entirely the caller's own CI job's
responsibility, performed before this command is ever invoked. The printed
report is legible on its own — which declaration was found and where, the
verdict, and every finding for a `violated` result — so a consumer does not
need its own reporting layer to learn which surface, built-in or custom,
drifted.

#### Deliberate v1 and v2 compatibility

`RepositoryProfileV1` preserves the original exact shape: schema version `1`,
`defaultBranch`, `commands`, and `protectedPaths`. `RepositoryProfileV2`
preserves schema version `2` with `requirements` and no root declaration.
`RepositoryProfile` is the explicit v1/v2/v3 union, and
`validateRepositoryProfile` accepts all three. Older closed schemas cannot add
newer fields silently: v1 must opt into v2 for requirements, and v2 must opt
into v3 for `rootEntries`.

Accepting all three versions means `validateRepositoryProfile` validates a
different amount depending on which one it got: a v1 profile has no
`requirements` or `rootEntries` fields at all, and a v2 profile has
`requirements` but not `rootEntries`, so those checks are skipped entirely
for older versions rather than failing. An empty `findings` array therefore
does not by itself say whether `requirements`/`rootEntries` were genuinely
checked and found correct, or never examined because the profile's own
schema version predates them (issue #309). `repositoryProfileValidationCoverage(value)`
answers that directly — same input, no re-validation, no I/O — returning
which of those two checks actually ran:

```ts
import { repositoryProfileValidationCoverage } from "@vespeneventures/controller/repository";

repositoryProfileValidationCoverage({ schemaVersion: 1, /* ... */ });
// => { requirementsChecked: false, rootEntriesChecked: false }
repositoryProfileValidationCoverage({ schemaVersion: 3, /* ... */ });
// => { requirementsChecked: true, rootEntriesChecked: true }
```

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateRepositoryProfile(value)` | function | Strictly validates v1, v2, or v3 without I/O or throwing. |
| `repositoryProfileValidationCoverage(value)` | function | Reports which schema-version-gated checks `validateRepositoryProfile` actually ran for `value`, without re-validating it. |
| `validateRepositoryRequirementsEvaluationInput(value)` | function | Strictly validates discovered declarations and normalized observations. |
| `evaluateRepositoryRequirements(value)` | function | Returns deterministic per-requirement states and findings; invalid and unknown inputs fail closed. |
| `validateRepositoryRootEvaluationInput(value)` | function | Strictly validates an exact root vocabulary and caller-normalized direct-child observations. |
| `evaluateRepositoryRoot(value)` | function | Returns every classified direct-child result; missing, prohibited, and unknown entries fail closed. |
| `main(argv)` / `run()` / `CliInputError` | CLI API | Preserved importable command API. Importing it is inert; only calling it reads input, writes a report, or sets an exit code. `main`/`run` also locate a declaration (issue #315) when given no path or a directory path. |
| `RepositoryCheckReport` | type | `repository-check`'s own `{ ok, findings }` report shape. |
| `runRepositoryProfileCheck(input)` | function | The runner (issue #321): validates schema unconditionally before evaluating declared requirements, root entries, and any caller-supplied custom axes (issue #324) against injected discovery, and resolves to one shared `GateResult` verdict. Zero I/O. |
| `REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE` | constant | The fixed `source` a repository-scoped requirement observation must name to match a single-profile run — never the declaration's resolved file path. |
| `REPOSITORY_PROFILE_RUN_REASONS` | constant | The declared `indeterminate` reason vocabulary `runRepositoryProfileCheck` can ever emit (`createGateReasons`, from `./gates`), including `custom-axis-invalid` and `custom-axis-indeterminate` (issue #324). |
| `RepositoryProfileRunInput` / `RepositoryProfileRunDeclarationState` | types | Strict input to `runRepositoryProfileCheck`: the caller-resolved declaration state, injected discovery, and the optional `customAxes` list (issue #324). |
| `RepositoryProfileRunCustomAxis` / `RepositoryProfileRunCustomFinding` | types | One caller-supplied, already-evaluated derived-check result (`{ name, result }`) and the finding shape its `violated` case may report through (issue #324). |
| `RepositoryProfileRunResult` / `RepositoryProfileRunFinding` / `RepositoryProfileRunIndeterminateReason` | types | The runner's `GateResult` verdict, its unified finding shape (built-in and custom), and its declared indeterminate reasons. |
| `CANONICAL_REPOSITORY_PROFILE_PATH` | constant | `"governance/repository-profile.json"` (issue #315) — the one location a declaration lives. |
| `REPOSITORY_PROFILE_VERSION` / `PREVIOUS_REPOSITORY_PROFILE_VERSION` / `LEGACY_REPOSITORY_PROFILE_VERSION` | constants | Current `3` plus deliberately supported `2` and `1`. |
| `REQUIREMENT_ID_CATEGORIES` | constant | `["runtime", "tool", "dependency"]` (issue #316) — the closed requirement-id category vocabulary. |
| `RepositoryProfileV1` / `RepositoryProfileV2` / `RepositoryProfileV3` / `RepositoryProfile` | types | Closed profile versions and their explicit union. |
| `RepositoryRequirement` / `RepositoryRequirementConstraint` / `RepositoryRequirementScope` | types | Neutral declaration grammar. |
| `RepositoryPresenceConstraint` / `RepositoryOneOfConstraint` / `RepositoryMinimumVersionConstraint` | types | The three constraint shapes `RepositoryRequirementConstraint` closes over — bare presence, a closed enumeration, and an open-ended minimum-version floor (issue #318). |
| `RepositoryRequirementIdCategory` | type | One category admitted by the requirement-id grammar. |
| `RepositoryRequirementDeclaration` / `RepositoryRequirementObservation` | types | Caller-associated declarations and caller-normalized evidence. |
| `RepositoryRequirementsEvaluationInput` / `RepositoryRequirementsEvaluation` | types | Strict evaluator input and report. |
| `RepositoryRequirementEvaluation` / `RepositoryRequirementStatus` | types | One requirement's resolved state. |
| `RepositoryRootEntry` / `RepositoryRootEntryClassification` / `RepositoryRootEntryDisposition` | types | Caller-owned exact-root declaration grammar. |
| `RepositoryRootEvaluationInput` / `RepositoryRootEvaluation` / `RepositoryRootEvaluationStatus` | types | Strict root evaluator input and complete report. |
| `RepositoryRootEntryEvaluation` | type | One declared or unknown direct child's result. |
| `RepositoryProfileFinding` / `RepositoryRequirementFinding` / `RepositoryRootFinding` / `RepositoryRootFindingRule` | types | Stable structural and evaluation findings. |
| `RepositoryProfileValidationCoverage` | type | `{ requirementsChecked, rootEntriesChecked }` (issue #309) — `repositoryProfileValidationCoverage`'s return shape. |
| `RepositoryDeclarationLocationFinding` / `RepositoryDeclarationLocationFindingRule` | types | `declaration-not-found` and `declaration-non-canonical-location` (issue #315) plus every `RepositoryProfileFindingRule`. |

### `./composition`: pure cross-plane effective-state resolution

`@vespeneventures/controller/composition` resolves only data supplied by its
caller. It does not inspect a filesystem, repository, account, environment,
provider, scheduler, or machine; choose scope authority or source precedence;
read the clock; install anything; construct a provisioning manifest; or mutate
input. `evaluatedAt` is explicit input so expiry decisions remain deterministic.

Every declaration names one exact `{ plane, id }` scope. The closed plane
vocabulary is `producer`, `workspace`, `repository`, and `machine`, but that
list is not an authority ladder: an array position, a more specific label, or
a later source can never weaken a requirement or policy. Callers choose which
declarations belong to the same exact scope before invoking the evaluator.

```ts
import {
  COMPOSITION_SCHEMA_VERSION,
  evaluateComposition,
} from "@vespeneventures/controller/composition";

const machineScope = { plane: "machine", id: "member-machine" } as const;
const result = evaluateComposition({
  schemaVersion: COMPOSITION_SCHEMA_VERSION,
  evaluatedAt: "2026-08-15T00:00:00.000Z",
  declarations: [
    {
      kind: "requirement",
      id: "producer.runtime",
      capability: "runtime.example",
      scope: machineScope,
      constraint: { kind: "one-of", values: ["stable", "preview"] },
      provenance: { source: "producer", reference: "urn:example:producer-runtime" },
    },
    {
      kind: "policy",
      id: "workspace.runtime",
      capability: "runtime.example",
      scope: machineScope,
      constraint: { kind: "one-of", values: ["stable"] },
      provenance: { source: "workspace", reference: "urn:example:workspace-policy" },
    },
    {
      kind: "preference",
      id: "repository.runtime",
      capability: "runtime.example",
      scope: machineScope,
      value: "stable",
      provenance: { source: "repository", reference: "urn:example:repository-preference" },
    },
  ],
  supplies: [{
    id: "machine.runtime",
    capability: "runtime.example",
    scope: machineScope,
    state: "available",
    values: ["stable", "preview"],
    provenance: { source: "machine", reference: "urn:example:machine-observation" },
  }],
  decisions: [],
  exceptions: [],
});
```

Requirements and policies are hard constraints. Preferences may select one
otherwise-compatible supplied value, but never override a hard constraint.
When compatible supply still leaves several preferred or unpreferred values,
the result is `unknown` until the caller supplies one operator decision. A
decision is never inferred from source order, scope labels, paths, or account
state.

An exception has an exact scope, non-empty reason, durable provenance
reference, targeted hard-declaration identifiers, explicitly allowed values,
and optional `reviewBy` and `expiresAt` timestamps. It changes an outcome only
when a decision references it, its selected value is explicitly supplied and
allowed, every target matches the decision's capability and scope, and neither
its review nor expiry bound has been reached at the caller-supplied
`evaluatedAt`. An unreferenced, mismatched, review-due, or expired exception has
no weakening effect.

Each resolution is `effective`, `exception-mediated`, `conflicting`, or
`unknown`. `selectedValue` appears only for the first two. The result includes
the compatible supplied values, every hard constraint's `satisfied`,
`excepted`, `violated`, or `unresolved` state, and normalized provenance for
every contributing declaration, supply, decision, and exception. Valid output
ordering is canonical and independent of input ordering. Malformed input is
`invalid` and produces no partial resolutions.

This subpath deliberately does not accept `RepositoryProfileV2` or
`RepositoryProfileV3`. `@vespeneventures/controller/repository` continues to
own repository-authored upward requirements and exact-root semantics. A caller
may cite a validated repository result when it authors a separate composition
declaration, but Foundry performs no implicit conversion, discovery, or
authority assignment between those contracts.

#### Exact public export

| Export | Kind | Purpose |
| --- | --- | --- |
| `COMPOSITION_SCHEMA_VERSION` | constant | The closed input schema version, currently `1`. |
| `validateCompositionEvaluationInput(value)` | function | Strict hostile-input validation without I/O, mutation, or throwing. |
| `evaluateComposition(value)` | function | Pure deterministic effective-state resolution with fail-closed invalid, conflicting, and unknown outcomes. |
| `CompositionPlane` / `CompositionScope` | types | Closed plane vocabulary plus caller-owned exact scope identity. |
| `CompositionProvenance` / `CompositionProvenanceEntry` / `CompositionContributorRole` | types | Durable input attribution and normalized result provenance. |
| `CompositionPresenceConstraint` / `CompositionOneOfConstraint` / `CompositionConstraint` | types | Closed hard-constraint vocabulary. |
| `CompositionRequirementDeclaration` / `CompositionPolicyDeclaration` / `CompositionPreferenceDeclaration` / `CompositionDeclaration` | types | Hard requirements, authoritative policy, non-binding preference, and their union. |
| `CompositionCapabilitySupply` / `CompositionOperatorDecision` / `CompositionException` | types | Explicit normalized supply, selection, and narrowly referenced exception data. |
| `CompositionEvaluationInput` / `CompositionEvaluation` / `CompositionEvaluationStatus` | types | Complete evaluator input and report. |
| `CompositionResolution` / `CompositionResolutionStatus` / `CompositionConstraintResult` | types | One exact capability/scope outcome and its hard-constraint explanations. |
| `CompositionFinding` / `CompositionFindingRule` | types | Stable validation and fail-closed outcome findings. |

#### Consumer adoption order

1. Wait for the exact governance release containing this subpath to be
   published and independently qualified; never adopt from a branch, pull
   request, workspace link, or copied implementation.
2. Validate repository profile v2/v3 declarations and exact-root observations
   through `@vespeneventures/controller/repository` without changing their
   semantics.
3. Outside Foundry, discover the consumer's planes and author composition
   declarations, policies, preferences, normalized supply, decisions,
   exceptions, scope identities, values, timestamps, and provenance.
4. Call `evaluateComposition` and fail closed on `invalid`, `conflicting`, or
   `unknown`; retain the complete result as decision evidence.
5. Only after an `effective` or explicitly `exception-mediated` outcome may a
   separate caller translate selected values into its own next action. Any
   future provisioning input remains fully explicit and separate.
6. Adopt the same published contract independently in each consumer workspace;
   no workspace copies the evaluator or mutates a machine as part of adoption.

### `./review` schema: `ReviewPolicy` and `ReviewEvidenceBundle`

`@vespeneventures/controller/review` defines a provider-neutral snapshot of
evidence gathered while reviewing one proposed change, and the consumer-owned
policy it must satisfy. `validateReviewEvidence` fails closed: incomplete
pagination, a stale (different-head) item, an unresolved thread, or an
unsatisfied policy requirement all produce findings rather than a silent
pass.

```ts
import {
  validateReviewEvidence,
  type ReviewEvidenceBundle,
  type ReviewPolicy,
} from "@vespeneventures/controller/review";
```

`ReviewPolicy` — the consumer-owned requirement set:

| Field | Type | Notes |
| --- | --- | --- |
| `requiredChecks` | `string[]` | Names of checks that must report `"success"` for the current head; no duplicates. |
| `requireApproval` | `boolean` | Whether one current-head approval is required. |
| `requireSecondaryReview` | `boolean` | Whether a second, independent review reaching `depth: "secondary"` and a clean decisive state is required, on top of whatever `requireApproval` already demands. Required, no default, same discipline as `requireApproval`/`decisionUse` below — an omitted value is a `"require-secondary-review"` finding. `requireSecondaryReview: true` combined with `decisionUse: "advisory"` is rejected as an `"advisory-secondary-conflict"` finding, the same way `requireApproval: true` under `"advisory"` is. A `"secondary-incomplete"` record, or a `"secondary"` record whose state is not clean, never satisfies this. |
| `decisionUse` | `"advisory" \| "authoritative"` | Whether `requireApproval` (and `requireSecondaryReview`) is merge-blocking clearance (`"authoritative"`) or an audit signal only (`"advisory"`). Required, no default — an omitted or unsupported value is a `"decision-use"` finding. `requireApproval: true` combined with `decisionUse: "advisory"` is rejected as an `"advisory-approval-conflict"` finding at policy-validation time, before any evidence is read: an advisory model can never let an approval grant clearance. |

`ReviewEvidenceBundle` — the provider-neutral snapshot for one head:

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `3` | Must equal `REVIEW_EVIDENCE_VERSION`. A version-1 or version-2 bundle is rejected outright, never coerced. |
| `headSha` | `string` | Exactly 40 lowercase hexadecimal characters — the exact commit this snapshot was observed against. |
| `baseSha` | `string` | Exactly 40 lowercase hexadecimal characters — the exact base commit this snapshot was observed against, so evidence cannot outlive a base-branch change that alters the merge result. |
| `patchId` | `string?` | Optional. A caller-supplied identity for the change itself (the diff, not the commit), stable across a base-only advance the way `headSha` is not. Git's `patch-id` is the established analogue, but this package never computes one and never constrains this field to `headSha`/`baseSha`'s 40-lowercase-hex shape — it is opaque, caller-supplied data. Absence carries no ambiguity: it means only "no patch-identity information," and `isRevalidatableReviewEvidence` (below) can never return `true` for such a bundle. |
| `paginationComplete` | `boolean` | Must be `true`. `false` means at least one paginated collection below was not fully consumed and the bundle must not be treated as approval-ready. |
| `checks` | `ReviewCheck[]` | Dense array, at most 10,000 entries. |
| `reviews` | `ReviewRecord[]` | Dense array, at most 10,000 entries. |
| `threads` | `ReviewThread[]` | Dense array, at most 10,000 entries. |

`ReviewCheck`: `name` (`string`), `conclusion` (one of `"success"`,
`"failure"`, `"neutral"`, `"skipped"`, `"cancelled"`, `"timed-out"`,
`"action-required"`, `"pending"`, `"unknown"`), `headSha` (must match the
bundle's `headSha`, or the check is reported as stale evidence and excluded
from grading), and `completedAt` (`string?`, RFC 3339, the completion time of
THIS run — optional because a check that has not finished yet genuinely has
none, unlike `ReviewRecord.submittedAt` below, which is always required).

A provider's check collection reports every RUN for one `name` at a head, not
one current value per name — the same check can legitimately appear more
than once (a failed attempt and its later, passing re-run are two separate
`ReviewCheck` entries). `requiredChecks` is graded against the MOST RECENT
current-head run of each name, decided strictly by `completedAt`, never by
array position — grading the first (or last) entry seen for a repeated name
was issue #391, and let a required check that had failed once stay failed
forever even after it re-ran clean. A name with only one current-head entry
needs no `completedAt` at all, since there is nothing to order it against.
Grading a required check reports exactly one of three findings, never more
than one for the same name:

- `"missing-required-check"` — no current-head run for this name at all.
- `"required-check-failed"` — the most recent current-head run's
  `conclusion` was not `"success"`.
- `"required-check-indeterminate"` — this package will not guess which run
  counts. Fires while `paginationComplete` is not `true` (an unread page
  could hold a newer run than anything already observed, so even an
  already-observed `"success"` cannot be trusted as the latest one), or when
  more than one current-head run exists for the name and recency cannot be
  decided without guessing (a run with no `completedAt` in the mix, or
  multiple runs tied for the latest `completedAt` that disagree on
  `conclusion`). Never a pass and never a failure — see
  `ReviewFindingRule`'s own doc comment for the full reasoning.

`ReviewRecord`: `id` (`string`), `reviewerId` (`string`, opaque,
provider-neutral, and purely descriptive), `instanceId` (`string`, opaque,
required, unique per review session — validation groups and applies
latest-wins on `instanceId`, not `reviewerId`: a consuming account's records
can carry the same `reviewerId`, even the same login, for every audit it
runs, so `reviewerId` alone cannot tell two genuinely independent review
sessions apart from one review revising itself), `provider` (`string`,
opaque and required — which analyzer produced this record; this package
defines no vendor enum and no notion of a "trusted" provider, and no
provider's presence grants clearance, same as `decisionUse` above),
`submittedAt` (RFC 3339 timestamp with `Z` or an explicit offset, up to
millisecond precision), `state` (one of `"approved"`, `"changes-requested"`,
`"commented"`, `"dismissed"`, `"pending"`, `"unknown"`), `depth` (one of
`"primary"`, `"secondary"`, `"secondary-incomplete"` — how far this record's
review actually went, never derivable from `state`; only a `"secondary"`
record reaching a clean decisive state can ever satisfy
`ReviewPolicy.requireSecondaryReview`, and a `"secondary-incomplete"` record
never does even with a clean `state`), and `headSha` (must match the
bundle's `headSha`). Only each *instance's* latest current-head decisive
state (`approved`, `changes-requested`, or `dismissed`) is effective;
`commented`/`pending`/`unknown` never replace a decisive state, and two
decisive states sharing a timestamp for the same instance are reported as
ambiguous rather than resolved by array order.

`ReviewThread`: `id` (`string`), `isResolved` (`boolean` — `false` on a
current-head thread is reported as an unresolved-thread finding), and
`headSha` (must match the bundle's `headSha`).

```json
{
  "schemaVersion": 3,
  "headSha": "0123456789abcdef0123456789abcdef01234567",
  "baseSha": "76543210fedcba9876543210fedcba9876543210",
  "patchId": "fedcba9876543210fedcba9876543210fedcba98",
  "paginationComplete": true,
  "checks": [
    { "name": "test", "conclusion": "success", "headSha": "0123456789abcdef0123456789abcdef01234567", "completedAt": "2026-01-01T00:00:00.000Z" }
  ],
  "reviews": [
    {
      "id": "review-1",
      "reviewerId": "reviewer-1",
      "instanceId": "review-session-1",
      "provider": "review-analyzer-1",
      "submittedAt": "2026-01-01T00:00:00.000Z",
      "state": "approved",
      "depth": "primary",
      "headSha": "0123456789abcdef0123456789abcdef01234567"
    }
  ],
  "threads": [
    { "id": "thread-1", "isResolved": true, "headSha": "0123456789abcdef0123456789abcdef01234567" }
  ]
}
```

#### Revalidation after a base-only advance

A branch-protection rule that requires branches be current before merging
forces a branch update — which changes `headSha` — even when a pull
request's own diff never changed. `isRevalidatableReviewEvidence(evidence,
currentPatchId)` answers whether stale-by-head evidence remains usable in
that specific case: `true` only when `evidence.patchId` and `currentPatchId`
are both non-empty strings and equal. It is a separate, pure predicate, not
a `validateReviewEvidence` finding rule or parameter — every `headSha`
comparison inside `validateReviewEvidence` is a within-bundle consistency
check (does this item match this bundle's own `headSha`), never a comparison
against some other, live head; that comparison, and now this one, are both
entirely the caller's own job. `isRevalidatableReviewEvidence` never mutates
or re-derives `evidence`, and never decides whether a caller should actually
treat revalidated evidence as current for a merge — it supplies the fact
only, never the consequence.

```ts
import { isRevalidatableReviewEvidence } from "@vespeneventures/controller/review";

if (evidence.headSha !== pullRequest.headRefOid && isRevalidatableReviewEvidence(evidence, currentPatchId)) {
  // The base advanced but the diff is byte-identical; the caller decides
  // whether that is sufficient, or whether to gather fresh evidence anyway.
}
```

Types found in `packages/controller/src/review/types.ts`; validation rules
found in `packages/controller/src/review/validate.ts`. The optional
`./review/github` subpath (`normalizeGitHubReviewEvidence`) converts a
caller-provided GitHub-shaped payload into this same `ReviewEvidenceBundle`
shape without performing any network request itself. It reads `baseSha` from
`pullRequest.baseRefOid` and reads `provider` only from whatever the caller
already attached to a review node — it never infers a provider by
pattern-matching a login or any other GitHub-shaped field.

#### `changes-requested` and `unresolved-thread` are policy-independent

A current-head `changes-requested` review and a current-head unresolved
thread are always reported, regardless of `requireApproval`, `decisionUse`,
or `requiredChecks` — including when a policy requires nothing at all. No
policy can opt out of this: a consumer that could silently waive a live
objection would be able to make evidence with an unaddressed objection read
as clean. `isReviewEvidenceBundle` narrows past exactly these two rules plus
`review-decision-ambiguous` deliberately, because those three describe a
decision outcome, not a defect in the evidence's shape — a bundle can narrow
to `ReviewEvidenceBundle` while still carrying a live objection a caller must
inspect `validateReviewEvidence`'s findings to see.

#### Adoption and coverage: a shared vocabulary for account-owned data

`isReviewPolicyAdoptionState` and `isReviewPolicyCoverageState` validate two
neutral, tri-state, and *structurally independent* vocabularies:

| Type | Values | Meaning |
| --- | --- | --- |
| `ReviewPolicyAdoptionState` | `"adopted"` \| `"not-adopted"` \| `"assessment-pending"` | Whether a repository has turned a review policy on. |
| `ReviewPolicyCoverageState` | `"verified"` \| `"not-verified"` \| `"assessment-pending"` | Whether that repository's real pull requests have actually been reviewed under it. |

Both are tri-state so "not yet assessed" is always distinguishable from
"assessed and failing" — a two-state field cannot express "unchecked" without
letting an unchecked repository silently read as passing. Coverage is never
derivable from adoption: a repository adopting a policy is not evidence its
pull requests were reviewed under it, so the two vocabularies are disjoint
(`isReviewPolicyCoverageState` rejects `"adopted"`/`"not-adopted"`, and
`isReviewPolicyAdoptionState` rejects `"verified"`/`"not-verified"`) and
share no validator or internal state, only the same "not yet assessed"
literal. This package supplies the vocabulary and its validators only — the
per-repository adoption and coverage values themselves are each consuming
account's own data, never foundry's.

### `./cleanup`: pure workspace-cleanup classification

`@vespeneventures/controller/cleanup` is the deterministic decision core
shared by every account-plane cleanup skill: it turns caller-normalized
repository inventory and observations into a typed `owned` / `safe-candidate`
/ `blocked` proposal. Registry discovery, origin verification, live task
ownership checks, evidence collection, account boundaries, exact operator
confirmation, and guarded application all remain entirely the caller's own
job — this subpath never does any of them.

**Hard boundary.** `classifyCleanupCandidate` performs no Git, filesystem,
GitHub, scheduler, credential, network, or deletion I/O. It contains no
account names, no absolute paths, no standing authority, and no mutation
hook of any kind. This subpath exports **no deletion API** — not a "propose
and also execute" convenience, not a callback hook, nothing. See
`src/cleanup/no-deletion-api.test.ts` for the test that fails the moment
either guarantee regresses: one asserts the subpath's exact runtime export
list, and a second independently checks every export name against a
deletion/removal/mutation-shaped pattern.

```ts
import { classifyCleanupCandidate } from "@vespeneventures/controller/cleanup";
import type { CleanupCandidate } from "@vespeneventures/controller/cleanup";

const candidate: CleanupCandidate = {
  repositoryId: "example/widgets#worktree-a",
  origin: {
    known: true,
    observed: "https://example.invalid/example/widgets.git",
    expected: "https://example.invalid/example/widgets.git",
  },
  location: { kind: "worktree", workingTreeKnown: true, workingTreeClean: true },
  branch: { name: "feature/widgets", isDefaultBranch: false, trackingKnown: true, hasUpstream: true, aheadCount: 0 },
  prune: { known: true, safeWithoutForce: true },
  pullRequest: { known: true, state: "merged" },
  ownership: { known: true, ownedByActiveTask: false },
};

const proposal = classifyCleanupCandidate(candidate);
// proposal.status === "safe-candidate" — a PROPOSAL, never authorization.
// The caller still owns confirming with its operator and applying the
// change through its own guarded mechanism.
```

#### Status precedence, fixed and tested

`classifyCleanupCandidate` evaluates two tiers, always in this order:

1. **`"owned"` — structural, unconditional, checked first.** A candidate
   whose `location.kind` is `"canonical"`, or whose `branch.isDefaultBranch`
   is `true`, is `"owned"` immediately, with only that structural reason.
   None of the tier-2 checks below run in that case — an owned location is
   categorically not a cleanup candidate no matter what else is true about
   it, so a worktree's dirty/missing-evidence/etc. reasons are simply not
   relevant facts about it. (This is the one deliberate judgement call in
   the precedence order, called out for a reviewer to double-check against
   intent — see `src/cleanup/classify.ts`'s own doc comment.)
2. **`"blocked"` — every check runs; none short-circuits the others.**
   Origin, working tree, branch/tracking, prune dry-run, pull-request, then
   active-task ownership — mirroring the order the underlying inputs are
   listed in issue #215 itself. Every check that fails contributes its own
   reason code; a candidate blocked for three independent reasons reports
   all three, in this fixed order, not just the first one found.

A candidate reaches `"safe-candidate"` only by falling through both tiers
with zero reasons collected: every check ran, on complete evidence, and
every one passed.

#### Missing vs. incomplete evidence — both block, identically

"The caller never gathered this evidence" (e.g. `origin.known: false`) and
"the caller claims to have gathered it but the value is unusable" (e.g.
`origin.known: true` with `observed` left `undefined`) are treated
identically: both block, with the same `*-evidence-missing` reason code. A
check that cannot actually be answered from what it was given fails closed,
never passes — the same discipline
[CONTRIBUTING.md](../../CONTRIBUTING.md) documents for `check-release-
readiness.mjs`, and the same shape this package's own
`FoundationReport.complete` (`src/gates/types.ts`) and `Catalog.skipped`
(`src/catalog/build.ts`, `src/catalog/types.ts`) already use: the decline
case is DATA, never silence.

#### Reason codes

| Code | Status | Meaning |
| --- | --- | --- |
| `canonical-repository` | owned | This location is the repository's canonical clone. |
| `default-branch` | owned | This location is a checkout of the repository's default branch. |
| `origin-evidence-missing` | blocked | Repository origin was not observed, or was claimed known with no value. |
| `origin-mismatch` | blocked | Observed origin differs from the expected origin. |
| `working-tree-evidence-missing` | blocked | Working tree clean/dirty state was not observed, or was claimed known with no verdict. |
| `dirty-working-tree` | blocked | Working tree has uncommitted changes. |
| `tracking-evidence-missing` | blocked | Upstream tracking state (or the ahead count once an upstream is known) was not observed. |
| `unpushed-commits` | blocked | No upstream tracking branch at all, or the branch is ahead of its upstream. |
| `prune-evidence-missing` | blocked | No non-destructive dry-run evidence was observed. |
| `prune-requires-force` | blocked | A dry run reported this candidate would need a force flag to remove. |
| `pull-request-evidence-missing` | blocked | No pull-request search evidence was observed, or its state was missing/unrecognized. |
| `pull-request-not-found` | blocked | A pull-request search completed and found nothing. |
| `pull-request-open` | blocked | The associated pull request is still open. |
| `pull-request-closed-unmerged` | blocked | The associated pull request was closed without merging. |
| `ownership-evidence-missing` | blocked | No active-task ownership evidence was observed. |
| `active-task-ownership` | blocked | Another active task currently claims this candidate. |

Types found in `packages/controller/src/cleanup/types.ts`; classification
logic in `packages/controller/src/cleanup/classify.ts`.

#### Thin-adapter guidance for a consuming skill

An account plane's own cleanup skill stays a thin adapter around this
subpath:

1. **Discover.** Walk the plane's own registry of repositories and their
   worktrees. This package has no opinion on how — that discovery is
   entirely the skill's own, account-scoped concern.
2. **Gather evidence.** For each candidate location, read its real origin,
   working-tree state, branch/tracking state, run a non-destructive prune
   dry run, search for an associated pull request, and check the plane's
   own active-task registry for ownership. Every one of these is real I/O
   the skill performs, never this package.
3. **Normalize.** Map what was gathered onto one `CleanupCandidate` per
   location — explicitly marking any evidence the skill could not gather as
   `known: false`, never guessing or defaulting it to a passing value.
4. **Classify.** Call `classifyCleanupCandidate` once per candidate. This is
   the only step this package performs, and it is pure — safe to call
   repeatedly, safe to call speculatively, safe to unit test without any
   real repository present.
5. **Report and confirm.** Present every `CleanupProposal` to the operator,
   grouped by `status`. A `"safe-candidate"` result is a proposal to review,
   never a command to run.
6. **Apply, guarded, and only for what the operator explicitly confirmed.**
   Perform the actual removal through the skill's own guarded mechanism,
   entirely outside this package — which, again, exports no deletion API at
   all for a skill to reach for by mistake.

Two skills on different account planes gathering the same underlying facts
through differently written adapters still land on the same `status` and
the same `reasons[].code`, in the same order — see
`src/cleanup/parity.test.ts`, which proves this with two independently
constructed adapters that deliberately disagree on field names,
construction style, and even which literal origin URL string "matches," and
still converge on identical classifications. (Reason *messages* also match
whenever neither adapter fed the classifier a plane-specific literal value —
the two test adapters deliberately use different origin URL strings, so
only the `origin-mismatch` message differs between them; every other
message matches exactly.)

### `./conventions`: account-neutral agent conventions

`@vespeneventures/controller/conventions` is the account-neutral agent
conventions two parties can share without either owning the other, plus the
checks that enforce their grammar: branch provenance, skill naming, agent
interoperability, routine and schedule declarations, live-state
reconciliation, CI gate naming, neutrality, and a capability-first skill
registry.

The split is the design. This subpath enforces the *grammar* and ships the
*prose* as a default. It never gates on byte-identity with that prose: a
consumer that adopts the shipped documents verbatim and one that rewrites
them entirely are both conforming, so long as what they declare satisfies
the grammar. A standard that required its own wording back would be a
seeder wearing a standard's clothes.

```ts
import {
  TAXONOMY_PREFIXES,
  validateBranchName,
  SKILL_VERBS,
  validateSkillName,
  validateRoutineDeclaration,
  validateScheduleDeclaration,
  validateLiveStateSurfaceDeclaration,
  reconcileLiveState,
  GATE_VERBS,
  validateGateName,
  scanNeutrality,
  validateSkillRegistry,
  documentPath,
  adapterPath,
} from "@vespeneventures/controller/conventions";

const findings = validateBranchName("claude/fix-the-thing", { taxonomy: TAXONOMY_PREFIXES });
```

### `liveStateSurface` (#255): the shared reconciliation contract

`reconciliationFindingKinds` (routine tier, `./routines.ts`) and
`scheduleReconciliationFindingKinds` (schedule tier, `./schedules.ts`) are
each a tier-specific wording of the same four drift findings. `live-state.ts`
names that shape once, canonically, and adds the fifth state neither
tier-specific vocabulary named on its own:

```ts
import {
  LIVE_STATE_SURFACE_FINDING_KINDS,
  liveStateCouldNotVerify,
  reconcileLiveState,
  validateLiveStateSurfaceDeclaration,
} from "@vespeneventures/controller/conventions";

liveStateCouldNotVerify("deployment.web", ""); // throws — never a silent pass

const report = reconcileLiveState<string, string>({
  subject: "toolchain.runtime.node",
  declared: { value: "20.11.1" },
  observation: { attempted: true, live: "18.19.0" },
  agrees: (declared, live) => declared === live,
});
// report.result.verdict === "violated"
```

`reconcileLiveState` returns exactly one of `verified` / `drifted` /
`could-not-verify` — never a boolean — built on this package's own
`GateResult` ternary (`./gates`). Those three names are this module's own
vocabulary for `report.result.verdict`, which is always one of `GateResult`'s
own three literals: `verified` is `satisfied`, `drifted` is `violated`, and
`could-not-verify` is `indeterminate` (carrying `declared-but-not-verifiable`
as its one declared reason, and the named blocker as `detail`). See
`conventions/documents/live-state-reconciliation.md` for the shared document, and
`routine-declaration.md` / `schedule-declaration.md` for how the two
existing tiers specialize it without any change to their own behaviour.
`@vespeneventures/builder` re-exports this module's exports verbatim rather
than keeping its own copy; `@vespeneventures/observer` keeps a deliberate,
explained duplicate to preserve its own zero-runtime-dependency contract —
see that package's own README.

`documentPath(id)`/`adapterPath(id)` resolve absolute paths to the real
shipped files under `./conventions/documents/*` and `./conventions/adapters/*`
— resolving a path is not I/O; reading the file is the caller's own job, the
same discipline `./policy` holds for digests. `renderProductLoader(options)`
renders a small pointer file a consuming product installs so its own agent
adapter can find the shared guidance without duplicating it.

| Export | Kind | Purpose |
| --- | --- | --- |
| `TAXONOMY_PREFIXES` / `validateBranchName` | constant / function | Agent branch-naming grammar and its validator. |
| `SKILL_VERBS` / `validateSkillName` / `validateSkillSet` | constant / functions | Skill-naming grammar and its validators. |
| `validateRoutineDeclaration` / `validateRoutineSet` / `validateScheduledSkillDescription` / `reconciliationFindingKinds` | functions / constant | Routine-declaration grammar and its tier-specific live-reconciliation findings. |
| `isCronExpression` / `validateScheduleDeclaration` / `validateScheduleSet` / `scheduleReconciliationFindingKinds` | functions / constant | Schedule-declaration grammar and its tier-specific live-reconciliation findings. |
| `LIVE_STATE_SURFACE_FINDING_KINDS` / `validateLiveStateSurfaceDeclaration` / `reconcileLiveState` / `liveStateVerified` / `liveStateDrifted` / `liveStateCouldNotVerify` / `liveStateReconciliationReasons` | constant / functions | The shared `liveStateSurface` reconciliation contract (#255) the two rows above specialize. |
| `GATE_VERBS` / `validateGateName` / `validateGateSet` | constant / functions | CI gate-naming grammar and its validators. |
| `scanNeutrality` | function | Structural neutrality scan — the same scan `scripts/check-neutrality.mjs` runs against this subpath's own shipped documents/adapters. |
| `SKILL_REGISTRY_SCHEMA_VERSION` / `validateSkillRegistry` / `computeCapabilityCoverage` / `validateRoutineCoverage` | constant / functions | The capability-first skill registry's grammar, coverage computation, and routine-coverage cross-check. |
| `CONVENTION_DOCUMENTS` / `CONVENTION_ADAPTERS` / `DOCUMENTS_ROOT` / `ADAPTERS_ROOT` / `documentPath` / `adapterPath` / `templatedFilenames` | constants / functions | The shipped document/adapter manifest and path resolution — no I/O. |
| `renderProductLoader` | function | Renders a small pointer file a consuming product installs to reach shared guidance without duplicating it. |
| `ConventionDocument` / `ConventionAdapter` / `RoutineDeclaration` / `RoutineRegistry` / `ScheduleDeclaration` / `ScheduleRegistry` / `Finding` / `Severity` | types | Shapes shared across the validators above. |
| `LiveStateSurfaceDeclaration` / `LiveStateSurfaceFindingKind` / `LiveStateDriftKind` / `LiveStateFinding` / `LiveStateSubjectReport` / `LiveStateReconciliationResult` / `LiveStateReconciliationReason` / `LiveStateObservation` / `LiveStateDeclarationValue` / `ReconcileLiveStateInput` | types | The `liveStateSurface` declaration, its finding vocabulary, and the shapes `reconcileLiveState` reads and returns. |

### `./policy`: the content-addressed binding primitive

`@vespeneventures/controller/policy` is a content-addressed commitment to a
policy document: a `policyId`, a hash algorithm, and a digest — never the
document itself. A digest is safe to commit even when the document it
points at is not: it reveals nothing about the input, but lets a later,
separately-obtained copy be checked against it byte-for-byte. `./gates` and
`./artifacts` both bind rules and governed artifacts to documents through
this exact mechanism (`verifyBinding`) rather than reimplementing it.

```ts
import { computeDigest, validateBindingShape, verifyBinding } from "@vespeneventures/controller/policy";
import type { PolicyBinding } from "@vespeneventures/controller/policy";

const binding: PolicyBinding = { policyId: "example", digestAlgorithm: "sha256", digest: computeDigest("content") };
const findings = verifyBinding(binding, "content"); // []
```

This subpath does zero I/O and has zero dependency of its own — not even on
a sibling subpath of this same package. It does not know what a "denylist"
is, does not read a file, and does not decide what should happen when
`verifyBinding` reports a mismatch (fail a build, warn, block a release) —
that decision belongs to whatever calls it, most likely `./gates`.

| Export | Kind | Purpose |
| --- | --- | --- |
| `DIGEST_ALGORITHMS` / `DigestAlgorithm` | constant / type | The closed, currently-`sha256`-only hash-algorithm vocabulary. |
| `computeDigest(content, algorithm?)` | function | Digests a `string` or `Uint8Array` and returns lowercase hex. Throws on an unsupported algorithm — a producer-side programmer error, not a finding to collect. |
| `validateBindingShape(value)` | function | Strictly validates an untrusted value as a well-formed `PolicyBinding`, without throwing. |
| `verifyBinding(binding, content)` | function | Validates shape, then compares `binding.digest` against `computeDigest(content, binding.digestAlgorithm)`. |
| `PolicyBinding` / `Finding` | types | The binding shape and this subpath's own finding shape — not borrowed from any sibling subpath. |
| `OWN_LICENSE_BINDING` | constant | A self-hosting example bound to this package's own MIT licence, verified by a test against the real committed `LICENSE` bytes. |

## Former package names

Former package names are retired and do not forward. For a current mapping,
use the lifecycle contract; new integrations import the Controller subpath
that owns the needed capability directly.

## Lifecycle registry

Store consumer-owned package state in JSON. The registry must name every
package the workspace catalog finds. Deprecated and retired entries are the
deliberate exception: they may remain after source removal as auditable
terminal evidence.

```json
{
  "schemaVersion": 1,
  "packages": [
    {
      "name": "@example/core",
      "status": "adopted",
      "qualifiedEvidence": { "reference": "https://example.invalid/ci/core-release-proof", "date": "2026-07-01" },
      "adoptedEvidence": { "reference": "https://example.invalid/consumers/core-integration", "date": "2026-08-01" }
    },
    {
      "name": "@example/legacy-core",
      "status": "deprecated",
      "replacement": { "name": "@example/core", "range": "^1.0.0" },
      "deprecatedOn": "2026-08-11",
      "decision": "https://example.invalid/decisions/core-replacement",
      "migration": "https://example.invalid/migrations/legacy-core",
      "forwardsToReplacement": true
    }
  ]
}
```

A new registry entry uses one of these maturity states:

| Status | Meaning |
| --- | --- |
| `incubating` | Source exists but no registry release is asserted. |
| `published` | A releasable package version is available from its intended registry. |
| `qualified` | Published and has passed the owner-defined integration or release proof. |
| `adopted` | Qualified and in confirmed consumer use. |
| `deprecated` | Still available while consumers migrate. |
| `retired` | No longer current or installable from this workspace; retained as durable migration evidence. |

`active` remains valid for schema-v1 compatibility, but carries no maturity
claim and should not be used for new records. A replacement must also be
listed with `published`, `qualified`, `adopted`, or legacy `active` status;
its range must be a semver range. Decision and migration values are durable
paths or URLs, not self-attested completion booleans. This is only an
intentional record of migration state; it does not deprecate a registry
package or remove any files.

For a terminal retirement with no successor, replace `replacement` with a
non-empty `noReplacementReason`; it remains subject to the date, decision,
and migration evidence requirements. A `deprecated` record requires
`deprecatedOn`; a `retired` record requires `retiredOn` and may retain its
earlier `deprecatedOn` as historical evidence.

### Promotion evidence: `qualifiedEvidence` and `adoptedEvidence`

Reaching `qualified` or `adopted` is evidence-gated exactly like reaching
`deprecated` or `retired` is: a status claim without a citation is not
accepted. Each is an object with the same two durable, checkable fields used
throughout this registry — never a self-attested completion boolean:

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | `string` | A URL or a repo-relative path to something a reader can actually open; non-empty. |
| `date` | `string` | A real calendar date in `YYYY-MM-DD` form. |

An entry with status `qualified` requires `qualifiedEvidence` citing the
owner-defined integration or release proof it passed. An entry with status
`adopted` requires **both** `qualifiedEvidence` and `adoptedEvidence` —
`adopted` means qualified *and* in confirmed consumer use, so the registry
requires proof of each, not just the newer claim. Either field may also be
recorded early (on an `incubating`/`published` entry, before the status
itself is bumped) or retained afterward as historical evidence on a
`deprecated`/`retired` entry — presence is never rejected outside
`qualified`/`adopted`, only required starting there.

### `forwardsToReplacement`

A `deprecated` entry must declare `forwardsToReplacement: true` or `false`,
so a reader of the registry — not just of prose in a decision doc — can tell
"deprecated, but the old import path still resolves to working code" apart
from "deprecated, and importing it is now a hard break requiring a
rewrite" without opening the package's source. `true` means the deprecated
package still ships a real compatibility re-export to its replacement;
`false` means it does not, so importing the old name is an immediate break,
not a deprecation warning. A `retired` entry may also declare it — always
`false`, since a
retired package is by definition no longer installable from this workspace —
but is not required to, since that is already implied by the status itself.
It is rejected on any non-terminal status; declaring it early makes no sense
because there is nothing yet to forward.

## Usage

```ts
import {
  planNewPackage,
  runGovernanceCheck,
  type PackageLifecycleDocument,
} from "@vespeneventures/controller";

const plan = planNewPackage({
  name: "@example/widgets",
  description: "Widget contracts.",
});
// plan.readiness === "starter". Review plan.requiredActions and plan.files,
// then write them in the caller's own change process.

const lifecycle: PackageLifecycleDocument = {
  schemaVersion: 1,
  packages: [{ name: "@example/widgets", status: "incubating" }],
};
const report = runGovernanceCheck(process.cwd(), lifecycle, { scope: "@example" });
if (!report.ok) process.exitCode = 1;
```

### Profiled package plans

The default plan intentionally cannot be published: it is private and omits
repository-specific build, test, registry, ownership, license, and changelog
details. Do not treat it as a package template for another workspace.

To request a complete file plan, the caller supplies every convention that
governance cannot safely invent. `profile.manifest` must include `private`,
`author`, `license`, `repository`, `bugs`, `homepage`, `engines`, `scripts`,
and non-empty `devDependencies`; public packages also need
`publishConfig.registry`. The profile must supply actual source, test,
TypeScript, README, license, and dated-changelog contents. Governance still
only returns the proposed files; it never writes them.

For a proposed release, add the isolated tarball proof already owned by
`release`:

```ts
import { preflightGovernedPackage } from "@vespeneventures/controller";

const report = await preflightGovernedPackage(process.cwd(), "packages/widgets", lifecycle, {
  scope: "@example",
});
if (!report.ok) process.exitCode = 1;
```

## CLI

`foundry-governance` reads one lifecycle JSON file and prints a deterministic,
compact text report by default. It never runs package scripts or writes
workspace state.

```bash
foundry-governance package-lifecycle.json . --scope @example
foundry-governance package-lifecycle.json . --scope @example --format json
foundry-governance package-lifecycle.json . --scope @example --verbose
```

It exits `0` for a complete clean report, `1` for a governance finding, and
`2` when it cannot read or parse its arguments, lifecycle file, or workspace
root. `--format json` prints the compact machine-readable summary; add
`--verbose` to either format for the complete report. Use
`foundry-governance --help` for the full invocation contract.

Two subcommands (issue #377) give `preflightGovernedPackage` /
`preflightPackage` / `packRoundTrip` and `verifyPublishedArtifact` — all
three previously public library exports with no CLI path at all — a real
entry point on this same bin, dispatched on the literal `argv[0]`:

```bash
# Packs packages/widgets, installs it into a genuinely isolated directory,
# imports every declared subpath, AND folds in the lifecycle/catalog report
# above — a real gap this repository's own contributor publishing guide
# previously named explicitly.
foundry-governance preflight package-lifecycle.json packages/widgets . --scope @example

# Verifies already-fetched published content against an expected sha256
# digest, via this package's own ./policy binding verifier.
foundry-governance verify-published <sha256-digest> ./fetched-artifact.tgz
```

`preflight` exits `0` when the package installs and imports cleanly AND has
no lifecycle/catalog error finding, `1` when either half fails, `2` when it
could not run. `verify-published` exits `0` on a digest match, `1` on a
mismatch (or another binding finding), `2` when it could not run. Use
`foundry-governance preflight --help` / `foundry-governance verify-published
--help` for each subcommand's own invocation contract.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `PACKAGE_LIFECYCLE_VERSION` | constant | Supported lifecycle schema version, currently `1`. |
| `planNewPackage(input)` | function | Returns a deterministic, no-write private starter or repository-profiled package plan. |
| `validatePackageLifecycle(value)` | function | Purely validates a lifecycle document without workspace I/O. |
| `evaluateLifecycleCoverage(value, packageNames, packageVersions?)` | function | Validates a lifecycle document, checks it names exactly the supplied packages, and — when `packageVersions` is supplied — flags a terminal entry whose declared `replacement.range` no longer covers the replacement's actual version. |
| `evaluateDependencyInstallability(value, edges)` | function | Does every dependency of a still-installable package terminate somewhere installable? Reports `dependency-not-installable` only where the depender can still be installed and its dependency cannot — a deprecated package depending on a deprecated package is correct, and a retired one depending on a retired one cannot break. This is the ordering constraint on a retirement. Run by `runGovernanceCheck`, which reads the edges from the catalog's own manifests. |
| `runGovernanceCheck(root, lifecycle, options?)` | function | Composes the existing foundation check and build order with lifecycle coverage. |
| `preflightGovernedPackage(root, packageDir, lifecycle, options?)` | function | Combines `release`'s existing package preflight with a governance report. |
| `PackageLifecycleDocument` / `PackageLifecycleEntry` / `PackageLifecycleStatus` | types | Consumer-owned maturity registry, one lifecycle entry, and its status vocabulary. |
| `PackageLifecyclePromotionEvidence` | type | Durable `{ reference, date }` citation shape used by `qualifiedEvidence` and `adoptedEvidence`. |
| `LifecycleFinding` / `LifecycleFindingRule` | types | Deterministic lifecycle validation result and rule vocabulary. |
| `GovernanceReport` | type | Foundation report, build order, lifecycle findings, and combined status. |
| `NewPackagePlanInput` / `NewPackagePlanProfile` / `NewPackagePlan` / `NewPackagePlanReadiness` / `PackageScaffoldFile` | types | New-package input, repository-owned profile, readiness state, and reviewable generated file plan. |
| `GovernedPreflightOptions` / `GovernedPreflightReport` | types | Options and result for the release-plus-governance preflight. |

## Requirements

Node 20+. ESM only. **Zero unconditional runtime dependencies.** Before
issue #282, this package (as `@vespeneventures/governance`) declared exactly
one: `@vespeneventures/controller/policy`. That dependency is gone — not removed, but
absorbed: `policy`'s source now lives inside this package as the `./policy`
subpath, so there is nothing left outside this package to depend on.

TypeScript is declared an **optional** peer dependency again
(`peerDependencies: { typescript: "~6.0.0" }` +
`peerDependenciesMeta: { typescript: { optional: true } }`) — the same
shape the former `@vespeneventures/auth` package used for optional peers such
as `svix`. This flag has flipped twice, and both changes were correct for
their own moment:

- It was originally optional. Issue #411 found that flag dishonest:
  `packages/controller/src/gates/secret-gates.ts` imports `typescript`
  unconditionally, at module scope, and at the time that module was
  re-exported unconditionally from the SHARED `./gates` barrel — so a
  consumer who believed "optional," skipped installing `typescript`, and
  imported anything from `./gates` got a hard `ERR_MODULE_NOT_FOUND`, not a
  degraded gate. #411's fix made `typescript` a required peer instead,
  honest about what the barrel actually demanded.
- That fix broke a different, worse thing: with `typescript` required,
  `npm install --offline` on the published tarball had no cache to resolve
  the peer from, and failed outright — a consumer wanting nothing from
  `./gates` but, say, `./repository`'s `repository-check` could no longer
  install this package at all. **`./gates/secrets` (below) is the actual
  fix**, closing the real defect — one gate's compiler dependency forcing
  itself on every `./gates` consumer — instead of trading it for a
  different one. With `secret-gates.ts` isolated behind its own subpath,
  `optional` is honest again: a consumer of `./gates` (or anything else)
  never reaches it, and `./gates/secrets` still demands the same
  unconditional import it always has.

See `secret-gates.ts`'s, `gates/index.ts`'s, and `gates/secrets.ts`'s own
header comments for the full history, and
`gates/typescript-required.test.ts` for tests that exercise the actual
absent-peer import behavior on both sides of the split, not just the
manifest declaration.

A plain `import "@vespeneventures/controller"` (the root entry) still never
loads TypeScript at runtime: `runGovernanceCheck` and
`preflightGovernedPackage` import the specific foundation/build-order
functions they need directly, never a barrel. **Breaking change:** if you
were importing the
source-aware secret-surface checks (`checkCredentialInventory`,
`checkSecretReadiness`, `checkLocalSecretFiles`, `checkValueFreeSecretCatalog`,
`checkProviderResourceNames`, `checkSecretName`, `detectRawSecretReads`,
`checkCredentialSurfaceDrift`, or their associated types) from
`@vespeneventures/controller/gates`, that subpath no longer carries them —
import `@vespeneventures/controller/gates/secrets` instead, and install
`typescript` if you have not already.

An installed-but-incompatible `typescript` is still guarded explicitly:
`secret-gates.ts` calls `assertPeerVersion` at import time, which throws a
named, actionable error (never a silent pass) instead of whatever the
compiler API itself happens to crash on first for a genuinely out-of-range
version. See `src/internal/peer-version.ts` for the guard's own contract.

**Registry note:** `npm.pkg.github.com`'s packument has historically
omitted `peerDependenciesMeta` from published metadata (see
[issue #226](https://github.com/vespeneventures/foundry/issues/226)), so an
installer resolving `@vespeneventures/controller` from that registry sees
`typescript` as required regardless of the `optional: true` declared here —
a consumer who only ever imports the root or `./gates` (and never
`./gates/secrets`) still installs a TypeScript compiler onto this package's
account. `installed-bin.test.ts`, the test that proves this package installs and its
bins execute offline, packs and installs a LOCAL tarball (`npm pack` against
this very source tree) rather than fetching from that registry, so it sees
this manifest's real `peerDependenciesMeta` as written and is unaffected by
the registry gap either way.

This is a TypeScript-specific guarantee, not a general "the root does no
I/O" one. Both root functions genuinely read the real filesystem
(`node:fs`) — `runGovernanceCheck` for real workspace discovery via this
package's own `./catalog`, exactly as this file's own "Boundaries" section
above already says. `preflightGovernedPackage` goes further and also uses
`node:child_process`: packing a real tarball and running `npm install`
against it in a temp directory is the actual job `./release` does, has
always done, and cannot do any other way. Neither of those is new, and
neither is what issue #152 was ever about — only TypeScript itself (a
whole compiler, unusable in a browser/edge bundle regardless of whether
`node:fs`/`node:child_process` are even reachable there) was the surprising,
avoidable weight.

## Licence

MIT
