# Role package qualification

The canonical role-package matrix is
[`contracts/role-loop-archetypes.json`](contracts/role-loop-archetypes.json).
Despite its retained filename, schema version 4 has no separate archetype
concept. A role declares one primary **mode**, optional secondary modes, one
owned metric, one durable boundary, and one job question. The checker is
`npm run check:role-loop-archetypes`.

Package READMEs explain APIs and implementation detail. The contract is the
source of truth for role qualification. The lifecycle and package-evidence
contracts remain the sources of evidence-derived maturity. Historical delivery
groupings remain context in the decision record only; they are not live package
authority.

## One loop, six modes

Every mode executes the same five stages:

1. `sense`
2. `judge`
3. `act`
4. `verify`
5. `learnOrEscalate`

The mode changes the activity inside each stage. The definitive modes are:

- `assure` — judge a candidate against authoritative rules;
- `reconcile` — reduce a delta between declared and actual state;
- `fulfill` — make an accepted intent real and verify its outcome;
- `interact` — confirm and reconcile a person or actor request;
- `steward` — keep custody accountable through its lifecycle; and
- `optimize` — learn from independent signals and remeasure after adjustment.

The machine-readable mode declarations give every universal stage one
nonempty activity. A secondary mode is an internal control shape, not another
job or a partial permission for open-loop tooling.

## Charter and installation are different records

The package charter is durable. It answers:

- what material job question only this role answers;
- which one controllable metric it owns, including formula, unit and direction;
- which loop mode is primary;
- which responsibilities the package owns and explicitly excludes.
- which external measurement satisfies its `closeCondition`.

An installed position binds that charter to one consumer. Every consumer
supplies, in its own position record:

1. `businessMetricPath` — explicit L1 business value, L2 northstar, and L3
   operating metric;
2. `causalHypothesis`
3. `baseline`
4. `setpoint`
5. `operatingScope`
6. `authority`
7. `evidenceSource`
8. `cadence`
9. `budget`
10. `guardrails`
11. `escalationPath`
12. `workerComponents`
13. `stageBindings` — one consumer activity for each universal loop stage.
14. `firstDayAssessment` — gaps, target state, open questions, critical path,
    deferred work, recommendation, and evidence.

The position records its baseline once as the top-level `baseline`; the joined
first-day assessment records its gaps, target state, open questions, critical
path, deferred work, recommendation, and evidence references. Installing a
package does not supply these values and does not prove adoption. The runtime worker may combine
deterministic code, model decisions, human approval, and provider
integrations; that mix is an implementation choice inside the installed
position, not another package classification.

## One owned metric

Every role entry has exactly one `metric` object. The finite unit vocabulary is
`ratio`, `count`, `duration`, `currency`, and `rate`; the direction is exactly
`increase`, `decrease`, `maintain`, or `target-range`. Diagnostic measurements may still exist in package
APIs, but they do not become second owned metrics. Metric names must be unique
across roles so two packages cannot silently claim the same operating outcome.

Grounding is measured by someone other than the package author from host-owned
outcome records. A package's tests and staging fixtures can prove its judgment
discriminates; they cannot prove the owned metric moved in a real installation.

## Candidate qualification

The qualification vocabulary is deliberately small:

- `create` — the complete charter identifies a job and metric loop no current
  role owns;
- `extend` — one current role already owns and closes the same job and metric
  loop;
- `compose` — two or more current roles collectively already own and close that
  same job and metric loop;
- `reject` — the candidate lacks a coherent job, one controllable metric, a
  closed loop, a durable boundary, or acceptable guardrails.

Dependencies and adjacent workers are not coverage. A candidate may depend on
several existing roles and still qualify as `create` when none owns its job and
metric. Each `sameJobMetricLoopCoverage` citation therefore requires separate
job, metric, and loop-closure evidence.

The checker can qualify a caller-authored candidate assessment without writing
anything:

```bash
node scripts/check-role-loop-archetypes.mjs \
  docs/contracts/role-loop-archetypes.json \
  ./candidate-assessment.json
```

The verdict is a design decision only. It never inserts a candidate into
`package-evidence.json`, advances lifecycle maturity, or claims evidence.
After a `create` decision, `controller`'s `planNewPackage` may plan a no-write
starter; it is not part of qualification and does not create the package.
