# The package lifecycle

Every package in this repository moves through seven states. This document
says what each state means, what evidence ends it, and where each package
actually stands today.

One rule governs all of it:

> **A package's state is derived from evidence, never declared. A state
> claimed ahead of its evidence is a defect, not a plan.**

That rule exists because the obvious alternative — a build-then-register
pipeline whose stages are marked done by the person doing them — was tried
here and failed silently. The failure is recorded below rather than
paraphrased, because it is the whole reason this document has a different
shape than a checklist.

## Why states, and not a pipeline

The natural way to describe this work is a sequence: build a package to
standard, register it, get consumers to adopt it, retire what it replaces,
refine it. Each of those is real. As a pipeline they do not work, and the
reason is measurable in this repository.

On 2026-08-22, three of the six packages in the operation program had
cleared every check this repository runs. Each had a lifecycle entry, a
visibility declaration, README parity, clean contamination classes, and
between 76 and 171 test cases. None of the three had ever been executed
against a real tree by anything, including this repository.

Measured by scanning every executable invocation site — `package.json`
scripts, `scripts/`, and `.github/workflows/`:

| package | invocation sites in this repository |
| --- | --- |
| `controller` | 6 |
| `builder` | 1 |
| `inspector` | 1 |
| `locksmith` | **0** |
| `integrator` | **0** |
| `observer` | **0** |

Each of the three zeros is referenced only in documentation, contract files,
the lockfile, and its own source. A pipeline reported all three as finished,
because every stage in it accepted a declaration as its exit criterion. A
package can satisfy "built to standard" and "registered" completely while
never having run.

The states below are the same work with one change: each ends on evidence a
second person could reproduce without asking the first.

## The seven states

| # | state | the question it answers | evidence that ends it |
| --- | --- | --- | --- |
| 1 | **designed** | Is there a job here, and can it be graded? | The versioned [role-package contract](contracts/role-loop-archetypes.json) parses with one job question, one owned metric, one primary mode, a durable boundary, and the universal consumer-binding requirements. |
| 2 | **implemented** | Does it build and hold its own contracts? | `npm run check` and release readiness, both green. |
| 3 | **staged** | Has the author's own repository run it? | An executable invocation site here, **and a recorded run in which the gate went red on a genuine violation, alongside a control that stayed green**. |
| 4 | **published** | Can someone else install exactly this? | A registry artifact, a lifecycle entry, a clear name-collision check, and a declared visibility. |
| 5 | **adopted** | Does it block in a consumer's tree? | Installed at the current version, invoked by dist path, in blocking position, proven by a deliberate failure — and the consumer's hand-written equivalent deleted. |
| 6 | **grounded** | Is the loop worth having? | An independent measurer reads host-owned outcome records, and a metric outside the package demonstrably moves in response to a real change. Conformance gates may use `observer` catch and escape outcomes; other loop shapes may use an externally produced standing count or observed outcome. |
| 7 | **closed** | Is the loop done? | The close condition, as written in the package's own README, reads satisfied. Revocable. |

An eighth value is not a state but a verdict a cell may carry:
**`not-applicable`, with a reason.** It is distinct from "not yet" and from
"unknown", and the distinction is load-bearing: a capability requiring zero
targets must not grade identically to one fully covered.

### 1. designed

A package named for a thing has no natural metric, so nothing ever says
whether it is working. A package named for a job has a control loop by
construction. That is the test this state applies. The job question, one owned
metric, primary and secondary modes, durable boundary, and required consumer
bindings are normalized in
[`contracts/role-loop-archetypes.json`](contracts/role-loop-archetypes.json);
[`LOOPS.md`](LOOPS.md) explains how the durable charter differs from a
consumer installation.

The close condition must name a measurement **outside the package**. "Our
tests pass" is not a close condition; it is the system grading its own
homework. `inspector`'s close condition is the model — it closes when
`observer` reports an escape rate, never when `inspector`'s own run history
looks clean.

### 2. implemented

This is the only state this repository currently gates well, and it is also
the state that proves the least. Everything in the table in the previous
section had cleared it.

### 3. staged

The author's own repository is the producer's staging site, and it is the
cheapest one: no cross-repository coordination, no pin to move, no second
party to schedule. It is also the last chance to make a package fail before
anyone else installs it. Staging here never makes the author a consumer.

The evidence is deliberately not "it is wired". A gate that has run green
since the day it was added has not been shown to work — it has been shown to
run. **The absence of a failure is not evidence of success.** So this state
ends on a recorded run in which the gate went red.

**The violation may be injected.** What matters is that it is real in *kind*,
not in *origin*. Requiring a naturally-occurring defect would make this state
reachable only by luck — a well-maintained package could never reach it, and
the incentive would be to have worse code. Two other places in this
repository already say `deliberate` and this one is the outlier that drifted:
state 5 below requires "a deliberate failure", and the fleet adoption
checklist requires "a deliberately failing case". This paragraph settles it in
their favour.

Three things make an injected failure evidence rather than theatre:

- **The input is something a consumer could really produce.** A stylesheet
  with a genuine contrast violation counts. A stub that returns a failure does
  not.
- **The gate's own judgment produces the red.** Not a mocked return, not a
  forced exit code — the same path a real defect would travel.
- **A control stays green in the same run.** This is the part that is easy to
  skip and the part that carries the proof: a gate that fails on *any* input
  is not a working gate, and a red run alone cannot tell the two apart. The
  same discipline as running a positive control before believing a zero.

The record says which it was. An injected failure is recorded as injected —
a reader who cannot tell an injected red from a natural one is back to
trusting a summary instead of reading a measurement.

The record is `stagedBy`, and every field names something a reader can go and
check for themselves — because the gate checks that the record is *present*,
never that it is *true*:

```json
"stagedBy": {
  "run": "https://github.com/…/actions/runs/…",
  "defectOrigin": "injected",
  "defect": "what actually went wrong, in reproducible terms",
  "control": "what stayed green in the same run"
}
```

`run` may be a CI run URL **or** a local run described in enough detail to
reproduce — the input, the command, and what it printed. Requiring a URL would
make this state unreachable for any gate whose CI job is a *required status
context*: the only ways to make one go red are a pull request that then
carries a failing required check, or a push to the default branch. A state
reachable only by damaging the branch protection the gate exists to serve is
not a state, which is the same argument that settles origin above.

`control` is the field most likely to be left out and the one that carries the
proof. The first real candidate in this repository *had* a control — a second
theme that stayed clean while the injected one failed — and its author had not
noticed it was one, reporting it as a feature of the gate rather than as the
half that made the red mean anything.

### 4. published

[docs/PUBLISHING.md](PUBLISHING.md) is this state in full, written as a
checklist because the failure mode — publishing something private — is not
reversible.

### 5. adopted

Installing is one of three parts, and on its own it changes nothing
measurable.

- **Install** the package at the current version. Consumers here pin exact
  versions, so nothing published reaches a consumer without a pull request in
  that consumer's own repository.
- **Wire the gate into that consumer's CI, by dist path.** Bin-name dispatch
  has already left a gate silently unreachable in this fleet.
- **Prove the wiring with a deliberately failing case**, so that a green
  result distinguishes "ran and passed" from "never ran".
- **Delete the hand-written equivalent.** A consumer that still maintains a
  parallel runner beside the package has not adopted it, no matter how clean
  its own runs report. Five hand-written runners repeated the same judgment
  independently before the shared one shipped.

An installed package that nothing invokes proves only that a resolver could
find the name.

A repository may record the exact transition into this state with Controller's
separate repository-package adoption contract: stable profile coverage,
non-vacuous exact-head review, a post-main canary, an atomic provider-ruleset
before-to-after cutover, and blocking activation are adoption evidence.
Foundation, post-main canary, and atomic cutover are phase-local readiness
rather than an adoption claim; activation is independently satisfiable state-5
evidence. They do not close the loop. The
separate completion-evidence record still needs independently owned outcome
and cadence evidence, exactly reconciled to the adoption artifact and retained
operational references, before state 6 or 7 can be claimed.

**The author's repository is never a consumer.** Wiring a package into this
repository earns *staged* and nothing above it, however blocking the wiring
is. That rule is not pedantry about who owns a tree: *adopted* exists because
an author's repository bends to fit its own gate, and this catalogue has the
receipts — three operation packages passed every check here while having
never been executed by anything. If this repository could grade itself as a
consumer, *staged* and *adopted* would collapse into one measurement and the
ladder would lose the exact rung that caught that.

Adoption evidence is therefore authored by the direct consuming repository.
An account workspace may read and aggregate that repository's published
self-observation, but the aggregation does not transfer authorship or let the
workspace claim adoption on the repository's behalf.

### 6. grounded

A loop's outcome cannot be graded by the package that produced it. The metric
must live outside that package, be read by an independent measurer from
host-owned outcome records, and demonstrably move in response to a real
change. A self-produced test result or run history is not independent
grounding.

Conformance gates may ground in `observer`'s catch and escape outcomes: a
gate that has never gone red is either perfectly effective or completely
broken, and its run history looks identical in both cases. Reconciliation,
interaction, custody, and actuation loops may instead ground in an externally
produced standing count or observed outcome. The control shapes differ; the
no-self-grading rule does not. An independent measurer must never become the
thing it measures.

### 7. closed

Revocable, and the only state that is. Grounded-and-open is a normal
position: an escape rate of five percent is a real number and a bad one. A
closed loop reopens the moment its metric moves back.

## Supersession runs in parallel, not afterwards

Retiring what a package replaces is not a stage that follows adoption. It is
an obligation that opens the moment superseding is decided and closes only
when the last consumer has un-pinned the donor. Its own three positions:

- **deprecated** — a lifecycle entry naming the replacement, its version
  range, and a migration document.
- **un-pinned** — measured across the fleet, with a positive control, that no
  consumer pins the donor.
- **retired** — no longer installable.

Two invariants hold across the contract files at all times: the published and
deprecated names together are exactly the registry, and the retired names are
exactly what is absent from it. A third holds across manifests: **a package
that is still installable may not depend on a name that is retired**, because
that is a broken install for anyone who follows the pointer.

Modelling this as a stage is what let fifteen names sit in `deprecated`
without anything noticing. The compatibility packages that preceded them were
created for a real reason, and that reason expired with nothing in the
catalogue reporting it.

## Standing obligations

The portfolio and its evidence evolve continuously, so normalisation is not a
stage a package passes through once. Two obligations run continuously rather
than in sequence:

- **One role-package contract.** Every role package declares one job question,
  one owned metric, one primary mode, optional secondary modes, and one durable
  boundary in
  [`contracts/role-loop-archetypes.json`](contracts/role-loop-archetypes.json).
  The same contract fixes the universal stages and required consumer bindings;
  the checker reads it rather than relying on prose.
- **One vocabulary per shared concept.** A live-state vocabulary declared
  twice agrees only by luck.

## Where this repository actually is

This section used to carry a table of positions measured by hand on
2026-08-22. It has been deleted, and the deletion is the point.

Within a day it disagreed with the evidence contract in several package counts,
states, and invocation totals. Nothing was wrong with the measurement — it was
correct when taken, and it was a declaration by the following morning. That is
the failure this document describes, committed by this document.

Refreshing the numbers would have re-committed it with fresher digits. So the
position is not written here. It is read:

```bash
node scripts/check-package-evidence.mjs
```

`docs/contracts/package-evidence.json` is the record and that command is its
reader. A prose table returns here only once it is generated and the gate
fails when the committed copy drifts from the derived one — #493.

<!-- lifecycle-position-table:start -->

| package | current position | staged here | adoption | grounding | closure |
| --- | --- | --- | --- | --- | --- |
| `@vespeneventures/starter` | implemented | not yet | N/A — executable tooling | N/A — executable tooling | N/A — executable tooling |
| `@vespeneventures/advisor` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/controller` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/architect` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/inspector` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/builder` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/locksmith` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/integrator` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/observer` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/strategist` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/writer` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/designer` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/publisher` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/influencer` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/strategy` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/copy` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/ui` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/surface` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/ledger` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/auth` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/consent` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/comms` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/messenger` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/domain` | retired | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/bouncer` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/butler` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/giver` | published | yes | not yet | unknown — #484 | not yet |
| `@vespeneventures/keeper` | published | yes | not yet | unknown — #484 | not yet |

<!-- lifecycle-position-table:end -->

Two claims about position are structural rather than counted, and survive:

**No role package in this catalogue has independent grounding evidence.**
*Grounded* is not merely zero, it is unmeasured: this repository has not
connected an independent measurer to host-owned outcome records. `observer`
can read conformance catch and escape outcomes, while other control shapes need
their own externally produced standing count or observed outcome. A rate or
count that reads zero because nothing could be read is not a measurement
(#484). Explicit executable tooling has no role loop, so adoption, grounding,
and closure are N/A rather than unknown.

**No role package in this catalogue has reached *closed*.**

## How this is enforced

This document is not the record. `docs/contracts/package-evidence.json` is,
and `scripts/check-package-evidence.mjs` grades it on every run of
`npm run check`:

```bash
npm run check:package-evidence
```

Every package in the workspace must declare a position. The gate derives what
this repository can actually see — whether a package directory exists,
how many **dist-path** invocation sites it has across `package.json`,
`scripts/` and `.github/workflows/`, and its status in the lifecycle contract
— and fails when a declared position runs ahead of that evidence.

Three rules make it more than a formality.

**Invocation sites never satisfy `staged` on their own.** They prove a gate
runs. Only a recorded run in which it failed on a real defect proves it
works, and that record cannot be derived, so it must be declared and pointed
at.

**A role state this repository cannot derive is never assumed.** `adopted`,
`grounded` and `closed` need a consumer's tree or `observer`'s output.
Silence about them fails; it is not read as satisfied. Explicit executable
tooling is not a role loop: those three cells are rendered N/A, not silently
satisfied or fabricated as unknown.

**A shortfall must be acknowledged, not baselined.** The states are a ladder
and this repository published ten packages before the ladder existed. A gate
that simply refused every unsupported position would report ten-plus
violations on its first run and could never be wired, which makes it
decorative. So a shortfall below a declared state is declared in that
package's `gaps`, with prose saying what is actually missing and an issue
tracking it — the same shape `@vespeneventures/integrator` already ships for
currency opt-outs, where every opt-out carries a required reason. An
*unacknowledged* shortfall fails. So does an acknowledgement that outlives
its reason: once the evidence exists, the gap is a `stale-gap` finding until
it is removed. The list is a countdown, not a baseline, and the gate refuses
to let it go quiet.

A **retired** package has left the ladder, and the gate reads that from the
lifecycle contract rather than from a second declaration of its own — one
concept declared in two contracts agrees only by luck. It is reported where it
stopped and is not graded for stopping, because grading a retired package
against `published` would report it as running ahead of its evidence for
having been retired on purpose. Its `gaps` must then be dropped: a gap on a
retired package tracks work that will never be done, which is the precise way
an acknowledgement outlives its reason.

Bin-name invocations are reported separately and never counted. A bin
resolves to whatever the installer happened to link, which has already left a
gate silently unreachable in this fleet.

The evidence record also distinguishes a default **role** package from an
explicit **executable-tooling** package. The latter is not a role: it has no
job question, owned metric, loop mode, installed position, adoption, grounding,
or closure claim, and it is deliberately absent from the role-loop charter.
It still ships a `bin` and is still graded for its implemented artifact. This
keeps reusable delivery mechanics runnable without laundering them into a
fourth role or using `shipsNoGate` as an exemption.

One further rule is graded here that is not a rung on this ladder at all.
[DECISIONS.md 11](DECISIONS.md#11-a-gate-behind-a-bin-or-a-declared-primitive)
states that an active role package and explicit executable tooling ship a bin.
A temporary
compatibility package may declare `shipsNoGate` with a reason and an issue,
which is a countdown like `gaps`; no package may claim permanent exemption.
The rule lives in this gate because this is
the file that already knows each package's lifecycle status, and
a rule needing a second copy of that data belongs beside the first. Shipping a
`bin` is the weaker, earlier question than `staged`: whether a consumer could
run anything at all, not whether what they ran has ever caught a defect.

The gate exits `0` clean, `1` on a finding, `2` when it could not run —
never a pass it did not earn.

## What this still cannot prove

The derivable half is now derived. The rest is not, and is declared:

- **`designed`** is graded structurally by the normalized loop declaration for
  all eighteen roles. That proves a parseable charter shape, not applicability
  in a consumer or independent grounding.
- **`staged`'s** second half — the recorded failing run — is a pointer this
  gate checks the presence of, not the truth of.
- **`adopted`** needs each consuming repository to report whether the gate is
  wired in blocking position and whether its hand-written equivalent was
  deleted. Absence is what has to be proven, and only that repository can
  prove it.
- **`grounded`** needs an independent measurer to read host-owned outcome
  records. `observer` can supply conformance catch and escape outcomes; other
  loop shapes may need an externally produced standing count or observed
  outcome.

**Historical note:** Two instances of exactly the drift this gate exists to
stop were found while writing this document, in prose the gate does not read: this
repository's own README described `builder` and `ledger` as each having one
runtime dependency, naming `governance` and `policy` respectively. Both of
those names are retired, and both packages actually depend on `controller`.
The README parity gate reads a package's exports, not prose claims about its
dependencies, so nothing caught it. Prose drifts exactly as fast as anything
else, and only a reader catches it.

## Related documents

- [DECISIONS.md](DECISIONS.md) — decisions 9 through 14 preserve the historical
  delivery recuts and role qualifications; decision 15 removes their A/B/C
  cohorts from the live operating model.
- [PUBLISHING.md](PUBLISHING.md) — state 4 in full.
- [ADOPTION.md](ADOPTION.md) — state 5, from the consumer's side.
- `docs/contracts/package-evidence.json` — the record this document
  describes, and the thing that is actually enforced.
