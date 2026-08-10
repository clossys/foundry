# @vespeneventures/governance

A small, tenant-neutral policy engine for a GitHub App adapter. It verifies a
webhook HMAC, evaluates exact pull-request facts against caller-injected
policy, and returns a completed check-output payload. It does not call GitHub,
read configuration, retain secrets, or contain any tenant-specific values.

```bash
npm install @vespeneventures/governance
```

## Usage

```ts
import { evaluatePullRequestGovernance, verifyWebhookSignature } from "@vespeneventures/governance";

const verified = verifyWebhookSignature(rawRequestBody, request.headers.get("x-hub-signature-256") ?? undefined, webhookSecret);
if (!verified) throw new Error("Webhook signature did not verify.");

const result = evaluatePullRequestGovernance(pullRequestFacts, tenantPolicy);
await github.checks.create(result.check);
```

The adapter supplies `pullRequestFacts` from GitHub and loads `tenantPolicy`
from its own secure configuration. The package intentionally does neither.

## API

| Export | Purpose |
| --- | --- |
| `verifyWebhookSignature(payload, signature, secret)` | Verifies GitHub's `sha256=` HMAC header with constant-time comparison. Returns `false` for absent or malformed input. |
| `evaluatePullRequestGovernance(input, policy)` | Produces findings and an `AppCheckOutput` for the exact supplied pull-request head. It fails closed for incomplete changed-file lists, stale review evidence, dismissed/changes-requested state, findings, unresolved threads, and missing acknowledgement for configured sensitive paths. |
| `AppCheckOutput` | Completed GitHub Checks API payload shape. An App adapter owns posting it. |
| `PullRequestGovernanceInput` / `CurrentHeadReview` | Exact base/head, changed-file, configured-reviewer, current-head review, and optional acknowledgement facts supplied by the adapter. |
| `TenantGovernancePolicy` | Caller-injected check identity, reviewer/owner identities, sensitive-path regular expressions, and optional changed-file limit. No policy is shipped here. |
| `GovernanceEvaluation` / `GovernanceFinding` / `GovernanceConclusion` / `ReviewState` | Result and supporting public types for a caller that needs to inspect the decision before posting its check. |

## Boundaries

This package is deliberately not a GitHub App, worker, webhook server, secret
store, policy registry, or merge authority. It performs no network or
filesystem I/O. The caller retrieves secret material, verifies the event
before parsing it, gathers GitHub facts, injects a tenant's policy, posts the
returned check, and decides whether a merge is allowed.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
