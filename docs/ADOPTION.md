# Consumer adoption

Foundry ships durable **role packages**. A consumer hires one by creating an
**installed position** for a specific business outcome. The package charter is
the authority for the durable role definition; each consumer position is the
authority for that direct installation. Package READMEs explain APIs, and this
document explains the adoption flow; neither creates a second portfolio
record or overrides the other scoped authorities below.

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

## Authority and evidence across a plane

Adoption crosses repositories without transferring authority between them.
The same package may be installed in an account workspace and in one or more
sister repositories, but each installation is a separate consumer position.

| Surface | Owns | Cannot prove or do |
| --- | --- | --- |
| Foundry | The durable role charter, public artifact, compatibility contract, producer-side staging, and evidence-derived package lifecycle. | Decide a plane's entitlement, install into a consumer, supply consumer authority, or claim adoption or grounding. |
| Account workspace | Its repository inventory; plane-level entitlements and reasoned opt-outs; its own positions when it is a direct consumer; rollout coordination, currency expectations, and aggregation of repository-published observations. | Mutate a sister repository, author that repository's position or observation, or turn an aggregate result into evidence that an unobserved repository adopted a package. |
| Consuming repository | Its role dispositions and installed positions; exact dependency pin and lockfile; direct invocation and CI placement; deliberate-failure proof; duplicate removal; rollback; and its own self-observation. | Claim another repository's adoption or replace independent outcome measurement with its own run history. |
| Independent observer | Host-owned outcome measurement against the position's metric and close condition. | Infer an outcome from package tests, provider acceptance, activity, or a missing observation. |

Applicability is always scoped. An account workspace records whether the plane
is entitled to a package and any plane-level opt-out. Each direct consumer
separately records whether the role is `open` or `not-applicable` in its own
complete ledger. A workspace can coordinate those decisions, but it cannot
make a sister repository's disposition by editing or replacing that ledger.

Diagnosis may begin in Foundry, an account workspace, or a consuming
repository. There is no mandatory "workspace first" installation hop: the
repository with the real job and direct consumer opens the position. If the
account workspace also consumes the package for its own control plane, that is
a second position with its own wiring and evidence, not a proxy adoption for
the rest of the plane.

## Active role packages

Every row below is a current role package. New consumers use these names only;
retired donor and compatibility names are not adoption targets.

| Operating area | Role packages | Consumer job |
| --- | --- | --- |
| Engagement direction | `advisor` | Reconcile each active engagement to a current, evidence-backed, authority-bound next decision or action. |
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

The unit of rollout is **one package × one direct consumer × one evidenced
position**. Work on several units may proceed in parallel only when their
mutation surfaces, direct consumers, and evidence paths are independent.
Package availability, a plane-wide inventory, or the historical A/B/C delivery
cohorts never authorize a bulk installation.

1. **Open Advisor first.** For a new or continuing engagement, create or
   reassess the Advisor position before opening a Controller or first-wave
   operating position. Advisor reconciles sponsor intent, offering fit,
   readiness, live state, constraints, concurrent initiatives, and every
   baseline, conflict, or prerequisite needed by the proposed first wave.
   An unresolved or indeterminate pre-work item is an actionable blocker with
   an owner, next action, and follow-up; it is never a passive `HOLD` and does
   not authorize execution.
2. **Diagnose and open a position.** Run an evidence-based first-day
   assessment. If the business metric tree or causal hypothesis is unresolved,
   resolve that work before choosing an operating role. Do not install a
   package just because it exists.
3. **Bind the position.** Record every required field in the consumer-owned
   ledger, including the baseline and first-day recommendation. A package may
   have multiple positions across consumers; a consumer may have multiple
   positions for one role when their scopes and outcomes differ.
4. **Install the exact public artifact.** Configure the consumer's registry
   access, install the selected exact version into its own manifest and lockfile,
   and prove the export or CLI it actually uses from a clean install. Registry
   credentials and configuration remain consumer-local.
5. **Wire the loop.** Connect the position's evidence source to its role's
   `sense → judge → act → verify → learnOrEscalate` loop. The consumer decides
   blocking placement, approval boundaries, provider configuration, and every
   live mutation.
6. **Measure independently.** Record host-owned outcomes and give `observer`
   an independent measurement path. A green package test, provider acceptance,
   or a scheduled routine is not outcome evidence.
7. **Learn or escalate.** Re-measure after a bounded adjustment, revise the
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

## Inverse observation handoff

Fleet visibility is inverted from a central scanner. Each consuming
repository runs its own gates against its own tree, retains the run evidence,
and publishes one observation bundle containing its reported results. The
account workspace reads and aggregates those supplied observations against its
inventory and freshness expectations; it does not rerun the gates by reaching
into sister checkouts.

Builder's observation-bundle transport supplies the generic write, validation,
aggregation, and freshness primitives. It deliberately supplies no storage,
scheduler, fetch mechanism, repository registry, or authority to mutate a
consumer. Its validator establishes the bundle's structure, not the truth of a
caller-supplied result or its opaque repository ref. Those choices and proofs
belong to the plane and its repositories. Missing, stale, duplicate, or
malformed evidence stays `indeterminate`; aggregation must never translate
absence into a clean result.

A position-ledger result in such a bundle reports that the repository's gate
concluded its ledger conformed to the installed-position contract. The bundle
transport does not prove that conclusion or bind it to the reported ref; the
repository's retained gate-run evidence must do that. Neither record by itself
proves the exact artifact was invoked, a deliberate failure reached the gate,
a local duplicate was removed, or the owned metric moved. Those are separate
adoption and grounding measurements and must remain so in both repository
reports and workspace aggregates.

## Completion evidence exchange

`@vespeneventures/controller/positions` ships the versioned
`completion-evidence-contract.json` and
`foundry-completion-evidence-check <completion-evidence.json> <position-ledger.json>`.
One record validates an open, consumer-owned position against an exact-version
artifact declaration and consumer-retained manifest/lockfile/clean-install
references, recorded CLI or export invocation, recorded placement where
applicable, distinct deliberate red and green control cases in one run,
duplicate disposition, rollback record, cadence runs, and separately attributed
before and after outcome observations with a close-window verdict.

The references are consumer-retained identifiers. The validator lexically
rejects explicit inline sensitive-payload assignments, but does not authenticate
the pointers or prove opaque references free of other sensitive material. It verifies that a
consumer supplied each evidence class, that the position linkage and owned
metric agree with the shipped role charter, and that known-offset RFC3339
evidence with at most millisecond precision obeys
`before < invocation/red/green ≤ rollback ≤ after ≤ close start < recurrence ≤ close end`.
The outcome must retain the linked baseline and evidence-source locator exactly,
move from outside to inside the linked setpoint, and name neither the measured
package, position, nor its action authority as its owner. Cadence must name the
linked review cadence; runs outside the close window are history, while an
in-window violation returns `violated`, an in-window indeterminate result keeps
the record `indeterminate` unless a violation is known, and satisfaction needs
at least one later in-window satisfied recurrence. A caller may report an
outcome as `indeterminate` only while a before or after observation is
unreadable; a readable measurement is always evaluated against the setpoint.
It cannot certify a provider observation or make a central adoption decision.
Unreadable/incomplete evidence returns `indeterminate`; a derived setpoint miss
or contradictory claimed verdict returns `violated`; only a complete,
structurally consistent close-window record returns `satisfied`.

The installed-position ledger remains schema-v1 compatible and therefore only
requires a nonempty baseline `observedAt`. Completion is a stricter maturity
check: its linked baseline must be exactly retained by a readable outcome
observation whose RFC3339 instant has at most millisecond precision before the
record can satisfy.

Reference safety is deliberately narrow: after bounded percent decoding plus
NFKC, case, invisible-character, and form-style `+` normalization in
root/query/fragment assignment contexts, the
validators reject an explicit sensitive-category label followed by a nonempty
`:` or `=` payload. They allow ordinary identifiers containing those words,
and do not resolve or authenticate any pointer.
