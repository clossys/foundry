# @vespeneventures/review

Dependency-free contracts and deterministic validation for evidence gathered
while reviewing a proposed change. The root package is provider-neutral. Its
optional GitHub subpath translates caller-provided payloads only; it does not
perform network requests, inspect credentials, or choose repository policy.

```bash
npm install @vespeneventures/review
```

## Usage

```ts
import {
  validateReviewEvidence,
  type ReviewEvidenceBundle,
  type ReviewPolicy,
} from "@vespeneventures/review";

const policy: ReviewPolicy = {
  requiredChecks: ["test"],
  requireApproval: true,
};

const evidence: ReviewEvidenceBundle = {
  schemaVersion: 1,
  headSha: "0123456789abcdef0123456789abcdef01234567",
  paginationComplete: true,
  checks: [{ name: "test", conclusion: "success", headSha: "0123456789abcdef0123456789abcdef01234567" }],
  reviews: [{ id: "review-1", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha: "0123456789abcdef0123456789abcdef01234567" }],
  threads: [{ id: "thread-1", isResolved: true, headSha: "0123456789abcdef0123456789abcdef01234567" }],
};

const findings = validateReviewEvidence(evidence, policy);
if (findings.length > 0) process.exitCode = 1;
```

## GitHub payload normalization

`@vespeneventures/review/github` accepts a complete, caller-provided snapshot.
It maps GitHub check and review states into the root contracts and marks the
result incomplete when any connection reports another page in either
direction.

```ts
import { normalizeGitHubReviewEvidence } from "@vespeneventures/review/github";

const evidence = normalizeGitHubReviewEvidence(payload);
```

The caller owns request execution, pagination, authentication, and every
repository-specific selection. A `false` `paginationComplete` result must not
be treated as approval-ready evidence.

## Validation behavior

`validateReviewEvidence` fails closed when evidence is incomplete, an item was
observed at a different head commit, a required check is absent or unsuccessful,
an approval is required but absent, a current review requests changes, or a
current thread remains unresolved. Each review carries an opaque reviewer ID
and RFC 3339 timestamp with `Z` or an explicit offset, so only that reviewer's
latest current-head decision is effective on every machine. Dismissed reviews
are retained as evidence but do not request
changes or count as approvals.
Commented, pending, and unknown states do not replace a reviewer's latest
approval or change request.

Findings have stable rule identifiers, input paths, and messages. Validation is
pure, deterministic, and performs no I/O.

## Ownership boundary

Foundry owns public-safe schemas, validators, and payload adapters. A consumer
owns workflow YAML, required check names, branch and ruleset policy, protected
paths, commands, and project values. User or machine account choices, browser
routing, credential references, cookies, OAuth or session state, and native
agent configuration are outside this package.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `REVIEW_EVIDENCE_VERSION` | constant | Supported evidence schema version, currently `1`. |
| `validateReviewPolicy(value)` | function | Validates consumer-owned required-check and approval policy values. |
| `isReviewPolicy(value)` | function | Narrows a value after policy validation succeeds. |
| `validateReviewEvidence(value, policy)` | function | Returns deterministic findings for incomplete, stale, or unsatisfied evidence. |
| `isReviewEvidenceBundle(value)` | function | Narrows a complete, structurally valid evidence bundle. |
| `ReviewList` | type | Dense, read-only collection contract used by the public models. |
| `ReviewCheck` / `ReviewCheckConclusion` | types | A check and its normalized completion state. |
| `ReviewDecision` / `ReviewRecord` | types | A review state and current-head decision record, including opaque reviewer identity and submission timestamp. |
| `ReviewThread` | type | A review thread and its resolution state. |
| `ReviewEvidenceBundle` | type | The provider-neutral snapshot for one proposed-change head. |
| `ReviewPolicy` | type | Consumer-owned required checks and approval requirement. |
| `ReviewFinding` / `ReviewFindingRule` | types | Stable validation result shape and rule vocabulary. |

## GitHub subpath

The following exports are available only from `@vespeneventures/review/github`.

| Export | Purpose |
| --- | --- |
| `normalizeGitHubReviewEvidence` | Converts caller-provided GitHub-shaped payloads without provider I/O. |
| `GitHubPageInfo` / `GitHubConnection` | Minimal pagination marker and connection shape. |
| `GitHubCheckNode` / `GitHubReviewNode` / `GitHubReviewThreadNode` | Accepted GitHub-shaped check, review, and thread payloads. |
| `GitHubReviewEvidencePayload` | Complete caller-provided GitHub snapshot. |

## Requirements

Node 20+. ESM only. Zero runtime dependencies.

## CLI

`review-check` validates one evidence JSON file against one policy JSON file.
It performs no network requests, Git operations, credential lookups, or other
provider I/O.

```bash
review-check review-evidence.json review-policy.json
```

It writes one JSON report to standard output and exits with `0` when the
evidence satisfies the policy, `1` for validation findings, or `2` for invalid
arguments, unreadable files, or invalid JSON. Use `review-check --help` for
the invocation contract.

## Licence

MIT.
