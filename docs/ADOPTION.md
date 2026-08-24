# Consumer adoption

Foundry ships durable **role packages**. A consumer hires one by creating an
**installed position** for a specific business outcome. The package charter
and the consumer position are the only authorities: package READMEs explain
APIs, and this document explains the adoption flow; neither creates a second
portfolio record.

An install is not adoption. A valid position is not independent grounding.
No package reaches `grounded` or `closed` until an independent observer reads
consumer-owned outcome evidence.

## The two records

1. [`role-loop-archetypes.json`](contracts/role-loop-archetypes.json) is the
   durable package charter: one job question, owned metric, loop mode, and
   boundary for every active role.
2. [`installed-position-contract.json`](contracts/installed-position-contract.json)
   is the machine-readable consumer-ledger contract. Each consumer creates
   its own complete ledger in its control plane and becomes the authority for
   its own position records.

The consumer position binds one role to a complete L1/L2/L3 business metric
path, causal hypothesis, measured baseline, setpoint, operating scope,
authority, evidence source, cadence, budget, guardrails, escalation path, and
worker components, and one nonempty `stageBindings` activity for every
universal loop stage. Its joined first-day assessment records the baseline once,
then gaps, target state, open questions, critical path, deferred work,
recommendation, and evidence references. It is an evidence-backed operating
record, not a mission document.

Validate a consumer-owned ledger against the current role vocabulary before
calling a position ready:

```bash
foundry-position-check path/to/foundry-positions.json path/to/role-loop-archetypes.json
```

Every consumer ledger explicitly marks all active roles `open` or
`not-applicable`. Open roles cite one or more complete positions;
not-applicable roles require a reason. The producer fixture only validates the
contract and is not consumer evidence.

## Active role packages

Every row below is a current role package. New consumers use these names only;
retired donor and compatibility names are not adoption targets.

| Operating area | Role packages | Consumer job |
| --- | --- | --- |
| Operating control | `controller`, `architect`, `inspector`, `builder`, `locksmith`, `integrator`, `observer` | Define rules and topology; judge changes; reconcile machine and package state; steward keys; independently measure outcomes. |
| Strategy and expression | `strategist`, `writer`, `designer`, `publisher`, `influencer` | Trace strategy, govern copy and design, verify publication, and learn from audience response. |
| Agreements and custody | `bouncer`, `butler`, `messenger`, `giver`, `keeper` | Reconcile authority, confirm intent, transport messages, close obligations, and steward held information. |

The exact scoped identifier is `@vespeneventures/<role>`. The release and
evidence contracts are the current source for publish status and maturity:

- [`package-lifecycle.json`](contracts/package-lifecycle.json) records whether
  an artifact is published or retired.
- [`package-evidence.json`](contracts/package-evidence.json) records the
  evidence-derived lifecycle position.

## Adoption flow

1. **Diagnose and open a position.** Run an evidence-based first-day
   assessment. If the business metric tree or causal hypothesis is unresolved,
   resolve that work before choosing an operating role. Do not install a
   package just because it exists.
2. **Bind the position.** Record every required field in the consumer-owned
   ledger, including the baseline and first-day recommendation. A package may
   have multiple positions across consumers; a consumer may have multiple
   positions for one role when their scopes and outcomes differ.
3. **Install the exact public artifact.** Configure the consumer's registry
   access, install the selected version into its own manifest and lockfile,
   and prove the export or CLI it actually uses from a clean install. Registry
   credentials and configuration remain consumer-local.
4. **Wire the loop.** Connect the position's evidence source to its role's
   `sense → judge → act → verify → learnOrEscalate` loop. The consumer decides
   blocking placement, approval boundaries, provider configuration, and every
   live mutation.
5. **Measure independently.** Record host-owned outcomes and give `observer`
   an independent measurement path. A green package test, provider acceptance,
   or a scheduled routine is not outcome evidence.
6. **Learn or escalate.** Re-measure after a bounded adjustment, revise the
   causal hypothesis only with evidence, or follow the recorded escalation
   path. Update the position record rather than creating parallel status docs.

## Install planning note

GitHub Packages currently resolves optional peers as required dependencies.
Before making a package a blocking dependency, perform the clean install and
lockfile proof for its actual consumer. This is material for `bouncer`,
`butler`, `controller`, `designer`, `keeper`, `messenger`, and `publisher`.
It does not change the position record or supply a consumer's authority,
provider credentials, or outcome evidence.

## Consumer-local responsibilities

Foundry does not own a consumer's business values, topology choices, provider
resources, secret values, routes, customer data, approval decisions, or live
mutations. Those belong in the consumer's own workspace and position record.
The role package supplies the reusable judgment and loop mechanism; the
consumer supplies the business context and authority to use it.
