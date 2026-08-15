# @vespeneventures/governance

The read-only process authority for a package workspace. It defines the
package-creation, maintenance, review, release-readiness, and retirement
records that the owning repository must prove; plans reviewable private
starters or repository-profiled package files; and owns the package-process
catalog, gates, release, repository-profile, review-evidence, and
workspace-cleanup-classification subpaths.

```bash
npm install @vespeneventures/governance
```

## Boundaries

`governance` does not write a scaffold, invoke a declared command, publish a
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

Install `@vespeneventures/governance` once and import the focused capability
you need. The root remains lifecycle and scaffold planning; the subpaths keep
their established contracts separate without making consumers select five
separately versioned packages.

| Subpath | Includes |
| --- | --- |
| `@vespeneventures/governance/catalog` | Workspace discovery and dependency-graph evaluation. |
| `@vespeneventures/governance/gates` | Foundation checks, deterministic build order, secret-surface gates, a ratchet primitive, override-range and dependency-scope gates, and `foundry-check`. |
| `@vespeneventures/governance/release` | Isolated packed-artifact and installed-import proof. |
| `@vespeneventures/governance/repository` | Consumer-owned repository profiles, upward requirements, exact-root declarations, pure evaluation, and `repository-check`. |
| `@vespeneventures/governance/review` | Provider-neutral review evidence contracts, validation, and `review-check`. |
| `@vespeneventures/governance/review/github` | Pure normalization of caller-provided GitHub-shaped review evidence. |
| `@vespeneventures/governance/artifacts` | Deterministic, fail-closed verification for a consumer-owned governed artifact: declared kind + schema version, exact-content checksum, and structural provenance. |
| `@vespeneventures/governance/cleanup` | Pure workspace-cleanup classification: caller-normalized inventory and observations in, a typed `owned` / `safe-candidate` / `blocked` proposal out. No I/O, no deletion API. |

### `./artifacts`: governed artifact verification

A reusable contract for verifying a consumer-owned governed artifact that
combines a declared kind + schema version, an exact-content checksum, and
structural source/revision provenance — closing the gap issue #195 opened
over: a checksum could pass while the schema version was unsupported, or
provenance could be attached without ever being checked.

```ts
import { verifyGovernedArtifact, verifyGovernedArtifacts } from "@vespeneventures/governance/artifacts";
import type { GovernedArtifactManifest, GovernedArtifactVerificationOptions } from "@vespeneventures/governance/artifacts";

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
   `@vespeneventures/policy`'s own `verifyBinding`; this package hashes
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

`checksum.algorithm` is typed as `@vespeneventures/policy`'s own
`DigestAlgorithm` — currently just `"sha256"` — rather than a second,
independent union, so this contract can never claim to accept an algorithm
`policy` itself does not support. Both the digest's SHAPE (is it the right
number of lowercase hex characters for its algorithm) and its VALUE (does
it match `content`) are checked by handing a small synthetic
`PolicyBinding` to `policy`'s own `validateBindingShape`/`verifyBinding` —
this package never re-derives which algorithms are known, how long a
digest should be, or how to hash anything.

#### Fail-closed vocabulary

Every finding is a `Finding` from `@vespeneventures/policy`, shaped
`{ rule, severity, message, path? }` and re-exported from this subpath.
Rules prefixed `artifact/` are owned here; `policy-id-shape`,
`digest-algorithm-known`, `digest-shape`, and `digest-mismatch` are
`@vespeneventures/policy`'s own rule names, passed through verbatim so a
caller can see exactly which layer reported the problem. See
`GovernedArtifactFindingRule` (documentation-only — `Finding.rule` itself
stays plain `string`) for the full vocabulary.

The package owns structural metadata validation and deterministic
orchestration only. The consumer owns artifact bytes, semantic decoding,
schema-specific validation, storage, transport, and trust policy —
including deciding what `provenance.source`/`provenance.revision` actually
mean and whether to trust them.

### `./gates` additions: ratchet, override bounds, dependency scope

Three small, independent, pure gates alongside the existing foundation,
build-order, policy, and secret-surface checks — none of them do I/O; a
caller reads whatever real data each one needs and passes it in.

#### `evaluateRatchet(current, baseline)`

A generic "warn-first with a checked-in baseline, ratchet monotonically
toward zero" primitive — count whatever a caller wants to track down to
zero (lint warnings, TODOs, `any` usages, anything), read a checked-in
baseline, and call this with both numbers.

```ts
import { evaluateRatchet } from "@vespeneventures/governance/gates";

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
import { checkOverrideTargetRanges } from "@vespeneventures/governance/gates";

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
import { buildCatalog } from "@vespeneventures/governance/catalog";
import { checkDependencyScope } from "@vespeneventures/governance/gates";

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

`@vespeneventures/governance/repository` owns a strict grammar and pure,
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
`@vespeneventures/governance/workspace` subpath.

#### Profile schema v3

```ts
import {
  REPOSITORY_PROFILE_VERSION,
  validateRepositoryProfile,
  type RepositoryProfileV3,
} from "@vespeneventures/governance/repository";

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

A requirement identifier is lowercase words separated by `.`, `-`, or `:`.
Its scope is:

- `repository`: resolved independently for the declaration source;
- `workspace`: shared by every declaration in one caller-selected evaluation;
- `machine`: shared by every declaration in one caller-selected evaluation.

These labels describe a requirement's resolution domain only. They do not
define discovery layout or account-container precedence. Profile v3 adds the
separate root-entry vocabulary because that vocabulary is repository-local.

`{ kind: "present" }` accepts any conclusive observed value. `{ kind:
"one-of", values: [...] }` accepts only the caller-enumerated values. Multiple
workspace- or machine-scoped `one-of` declarations are compatible when their
value intersection is non-empty. The evaluator exposes that intersection but
never selects a value, interprets version syntax, or decides precedence.

#### Pure multi-repository evaluation

```ts
import { evaluateRepositoryRequirements } from "@vespeneventures/governance/repository";

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
import { evaluateRepositoryRoot } from "@vespeneventures/governance/repository";

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

#### Deliberate v1 and v2 compatibility

`RepositoryProfileV1` preserves the original exact shape: schema version `1`,
`defaultBranch`, `commands`, and `protectedPaths`. `RepositoryProfileV2`
preserves schema version `2` with `requirements` and no root declaration.
`RepositoryProfile` is the explicit v1/v2/v3 union, and
`validateRepositoryProfile` accepts all three. Older closed schemas cannot add
newer fields silently: v1 must opt into v2 for requirements, and v2 must opt
into v3 for `rootEntries`.

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateRepositoryProfile(value)` | function | Strictly validates v1, v2, or v3 without I/O or throwing. |
| `validateRepositoryRequirementsEvaluationInput(value)` | function | Strictly validates discovered declarations and normalized observations. |
| `evaluateRepositoryRequirements(value)` | function | Returns deterministic per-requirement states and findings; invalid and unknown inputs fail closed. |
| `validateRepositoryRootEvaluationInput(value)` | function | Strictly validates an exact root vocabulary and caller-normalized direct-child observations. |
| `evaluateRepositoryRoot(value)` | function | Returns every classified direct-child result; missing, prohibited, and unknown entries fail closed. |
| `main(argv)` / `run()` / `CliInputError` | CLI API | Preserved importable command API. Importing it is inert; only calling it reads input, writes a report, or sets an exit code. |
| `REPOSITORY_PROFILE_VERSION` / `PREVIOUS_REPOSITORY_PROFILE_VERSION` / `LEGACY_REPOSITORY_PROFILE_VERSION` | constants | Current `3` plus deliberately supported `2` and `1`. |
| `RepositoryProfileV1` / `RepositoryProfileV2` / `RepositoryProfileV3` / `RepositoryProfile` | types | Closed profile versions and their explicit union. |
| `RepositoryRequirement` / `RepositoryRequirementConstraint` / `RepositoryRequirementScope` | types | Neutral declaration grammar. |
| `RepositoryRequirementDeclaration` / `RepositoryRequirementObservation` | types | Caller-associated declarations and caller-normalized evidence. |
| `RepositoryRequirementsEvaluationInput` / `RepositoryRequirementsEvaluation` | types | Strict evaluator input and report. |
| `RepositoryRequirementEvaluation` / `RepositoryRequirementStatus` | types | One requirement's resolved state. |
| `RepositoryRootEntry` / `RepositoryRootEntryClassification` / `RepositoryRootEntryDisposition` | types | Caller-owned exact-root declaration grammar. |
| `RepositoryRootEvaluationInput` / `RepositoryRootEvaluation` / `RepositoryRootEvaluationStatus` | types | Strict root evaluator input and complete report. |
| `RepositoryRootEntryEvaluation` | type | One declared or unknown direct child's result. |
| `RepositoryProfileFinding` / `RepositoryRequirementFinding` / `RepositoryRootFinding` / `RepositoryRootFindingRule` | types | Stable structural and evaluation findings. |

### `./review` schema: `ReviewPolicy` and `ReviewEvidenceBundle`

`@vespeneventures/governance/review` defines a provider-neutral snapshot of
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
} from "@vespeneventures/governance/review";
```

`ReviewPolicy` — the consumer-owned requirement set:

| Field | Type | Notes |
| --- | --- | --- |
| `requiredChecks` | `string[]` | Names of checks that must report `"success"` for the current head; no duplicates. |
| `requireApproval` | `boolean` | Whether one current-head approval is required. |

`ReviewEvidenceBundle` — the provider-neutral snapshot for one head:

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Must equal `REVIEW_EVIDENCE_VERSION`. |
| `headSha` | `string` | Exactly 40 lowercase hexadecimal characters — the exact commit this snapshot was observed against. |
| `paginationComplete` | `boolean` | Must be `true`. `false` means at least one paginated collection below was not fully consumed and the bundle must not be treated as approval-ready. |
| `checks` | `ReviewCheck[]` | Dense array, at most 10,000 entries. |
| `reviews` | `ReviewRecord[]` | Dense array, at most 10,000 entries. |
| `threads` | `ReviewThread[]` | Dense array, at most 10,000 entries. |

`ReviewCheck`: `name` (`string`), `conclusion` (one of `"success"`,
`"failure"`, `"neutral"`, `"skipped"`, `"cancelled"`, `"timed-out"`,
`"action-required"`, `"pending"`, `"unknown"`), and `headSha` (must match the
bundle's `headSha`, or the check is reported as stale evidence and ignored).

`ReviewRecord`: `id` (`string`), `reviewerId` (`string`, opaque and
provider-neutral), `submittedAt` (RFC 3339 timestamp with `Z` or an explicit
offset, up to millisecond precision), `state` (one of `"approved"`,
`"changes-requested"`, `"commented"`, `"dismissed"`, `"pending"`,
`"unknown"`), and `headSha` (must match the bundle's `headSha`). Only each
reviewer's latest current-head decisive state (`approved`,
`changes-requested`, or `dismissed`) is effective; `commented`/`pending`/
`unknown` never replace a decisive state, and two decisive states sharing a
timestamp for the same reviewer are reported as ambiguous rather than
resolved by array order.

`ReviewThread`: `id` (`string`), `isResolved` (`boolean` — `false` on a
current-head thread is reported as an unresolved-thread finding), and
`headSha` (must match the bundle's `headSha`).

```json
{
  "schemaVersion": 1,
  "headSha": "0123456789abcdef0123456789abcdef01234567",
  "paginationComplete": true,
  "checks": [
    { "name": "test", "conclusion": "success", "headSha": "0123456789abcdef0123456789abcdef01234567" }
  ],
  "reviews": [
    {
      "id": "review-1",
      "reviewerId": "reviewer-1",
      "submittedAt": "2026-01-01T00:00:00.000Z",
      "state": "approved",
      "headSha": "0123456789abcdef0123456789abcdef01234567"
    }
  ],
  "threads": [
    { "id": "thread-1", "isResolved": true, "headSha": "0123456789abcdef0123456789abcdef01234567" }
  ]
}
```

Types found in `packages/governance/src/review/types.ts`; validation rules
found in `packages/governance/src/review/validate.ts`. The optional
`./review/github` subpath (`normalizeGitHubReviewEvidence`) converts a
caller-provided GitHub-shaped payload into this same `ReviewEvidenceBundle`
shape without performing any network request itself.

### `./cleanup`: pure workspace-cleanup classification

`@vespeneventures/governance/cleanup` is the deterministic decision core
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
import { classifyCleanupCandidate } from "@vespeneventures/governance/cleanup";
import type { CleanupCandidate } from "@vespeneventures/governance/cleanup";

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

Types found in `packages/governance/src/cleanup/types.ts`; classification
logic in `packages/governance/src/cleanup/classify.ts`.

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

## Migrating from compatibility packages

The previous standalone names remain published compatibility packages while
consumers migrate. New integrations use the governance subpaths below. Root
imports and CLI command names remain compatible during the transition.

| Deprecated package | Supported import |
| --- | --- |
| `@vespeneventures/catalog` | `@vespeneventures/governance/catalog` |
| `@vespeneventures/gates` | `@vespeneventures/governance/gates` |
| `@vespeneventures/release` | `@vespeneventures/governance/release` |
| `@vespeneventures/repository` | `@vespeneventures/governance/repository` |
| `@vespeneventures/review` | `@vespeneventures/governance/review` |
| `@vespeneventures/review/github` | `@vespeneventures/governance/review/github` |

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
package still ships a real compatibility re-export to its replacement (as
`@vespeneventures/catalog` does, forwarding to
`@vespeneventures/governance/catalog`); `false` means it does not (as
`@vespeneventures/tokens` and `@vespeneventures/voice` do not — their
consolidation removed the source package entirely with no re-export left
behind, so importing either name is an immediate break, not a deprecation
warning). A `retired` entry may also declare it — always `false`, since a
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
} from "@vespeneventures/governance";

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
import { preflightGovernedPackage } from "@vespeneventures/governance";

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

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `PACKAGE_LIFECYCLE_VERSION` | constant | Supported lifecycle schema version, currently `1`. |
| `planNewPackage(input)` | function | Returns a deterministic, no-write private starter or repository-profiled package plan. |
| `validatePackageLifecycle(value)` | function | Purely validates a lifecycle document without workspace I/O. |
| `evaluateLifecycleCoverage(value, packageNames)` | function | Validates a lifecycle document and checks it names exactly the supplied packages. |
| `runGovernanceCheck(root, lifecycle, options?)` | function | Composes the existing foundation check and build order with lifecycle coverage. |
| `preflightGovernedPackage(root, packageDir, lifecycle, options?)` | function | Combines `release`'s existing package preflight with a governance report. |
| `PackageLifecycleDocument` / `PackageLifecycleEntry` / `PackageLifecycleStatus` | types | Consumer-owned maturity registry, one lifecycle entry, and its status vocabulary. |
| `PackageLifecyclePromotionEvidence` | type | Durable `{ reference, date }` citation shape used by `qualifiedEvidence` and `adoptedEvidence`. |
| `LifecycleFinding` / `LifecycleFindingRule` | types | Deterministic lifecycle validation result and rule vocabulary. |
| `GovernanceReport` | type | Foundation report, build order, lifecycle findings, and combined status. |
| `NewPackagePlanInput` / `NewPackagePlanProfile` / `NewPackagePlan` / `NewPackagePlanReadiness` / `PackageScaffoldFile` | types | New-package input, repository-owned profile, readiness state, and reviewable generated file plan. |
| `GovernedPreflightOptions` / `GovernedPreflightReport` | types | Options and result for the release-plus-governance preflight. |

## Requirements

Node 20+. ESM only. Exactly one unconditional runtime dependency:
`@vespeneventures/policy`.

TypeScript is not installed by a plain `npm install @vespeneventures/governance`.
It is declared as an optional peer dependency (`peerDependencies` +
`peerDependenciesMeta: { typescript: { optional: true } }`) — the same shape
`@vespeneventures/auth` uses for its own optional peers such as `svix`. A
consumer who never imports `./gates` never installs a compiler on this
package's account, including each of the five compatibility shims that
depend on `governance` and previously inherited it transitively through a
bare `dependencies` entry (issue #152).

TypeScript is needed only for the source-aware secret-surface checks
reachable through `./gates` (`packages/governance/src/gates/secret-gates.ts`
is the sole importer, gated behind that one subpath). A plain `import
"@vespeneventures/governance"` (the root entry) never loads it at runtime
either: `runGovernanceCheck` and `preflightGovernedPackage` import the
specific foundation/build-order functions they need directly, never the
`./gates` barrel those secret-surface checks also live in. If you want the
secret-surface checks, install `typescript` yourself and import
`@vespeneventures/governance/gates` — that subpath still carries the full
TypeScript dependency, unchanged; only the manifest changed, not what any
subpath does at runtime.

Marking `typescript` optional means npm gives no install-time signal if
it's missing or on an incompatible version. `secret-gates.ts` now guards
against both itself, at import time: an absent or out-of-range `typescript`
throws a named, actionable error (never a silent pass) instead of
whatever the compiler API itself happens to crash on first. See
`src/internal/peer-version.ts` for the guard's own contract.

**Registry note: the issue #152 fix above is undone one layer up by the
registry itself.** `typescript` is correctly declared `optional: true` in
`peerDependenciesMeta`, which is exactly what let the five compatibility
shims stop inheriting a compiler transitively. But `npm.pkg.github.com`'s
packument omits `peerDependenciesMeta` entirely, so an installer resolving
against this registry sees `typescript` as required regardless — a
consumer who only ever imports the root (`runGovernanceCheck`,
`preflightGovernedPackage`) and never touches `./gates` still gets a
TypeScript compiler installed on this package's account. See
[issue #226](https://github.com/vespeneventures/foundry/issues/226) for the
full evidence and why the declaration stays as-is.

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
