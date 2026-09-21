# First-wave productization and install sequence

This is the standing order for making the current `@clossys` catalogue
actually installable and re-runnable as closed-loop packages for a first-wave
consumer. It is a producer sequence. It is not a live lifecycle-position
table, not a publication allowlist, and not permission to install every
package into every consumer.

One rule governs how it is used:

> **Operational integrity before frontend development.** Engagement, trusted
> base, operating rules, operating control, and agreements are productized
> before strategy, copy, design, publication, and audience-response surfaces.

The machine-readable record is
[`contracts/first-wave-sequence.json`](contracts/first-wave-sequence.json).
The checker is `npm run check:first-wave-sequence`. A sequence claimed in
prose that the checker would reject is a defect, not a plan.

## Three orders, three questions

This repository already has two other orders. They remain correct for the
questions they answer, and they are the wrong entry point for first-wave
installability.

| Order | Question it answers | What it must not be used for |
| --- | --- | --- |
| [`governance/release-catalog.json`](../governance/release-catalog.json) | Which source packages may publish, and in which runtime-closed upload order? Writer and designer sit early because publisher cannot publish without them. | Ranking the remaining productization backlog. Frontend packages do not jump the operating-control queue merely because a later package depends on them. |
| [ADOPTION.md](ADOPTION.md) | How does one consumer open one evidenced position? Advisor first, then only justified roles, never a blanket install. | Ranking producer work. A consumer that does not need publication never installs publisher. |
| This sequence | In what order does Foundry make the current packages honestly installable and closed-loop, so a first-wave consumer can pin, run, and re-run them? | Claiming adoption, grounding, or closure. Those remain consumer-owned. |

Issue #517 still presents itself as the session entry point and tells a
reader to run `node scripts/check-package-programs.mjs`, which does not
exist. Issue #897 is a real per-package audit, but it ranks packages by
consumer-facing surface area, most-exposed first — controller, then observer,
then locksmith, then publisher and designer, with advisor eleventh. That
order is right for "what already burned a consumer," and wrong for "what a
first-wave consumer must be able to install as a closed loop." This document
is the latter.

The consumer-adoption hold and its clearing condition remain #806, decided in
#567, recorded as [decision 19](DECISIONS.md#19-the-consumer-adoption-hold-and-what-actually-clears-it).
This sequence does not lift that hold.

## The sequence

Read the contract; do not quote a hand-copied table as current membership.
Flattened, and checked against the manifests' first-party runtime graph:

1. **Catalogue integrity** — no package. Unblocks every later wave: source and
   registry at the same version, latest tarball honestly public, installer-linked
   bins that actually run, install docs that do not demand a GitHub token for
   public npm.
2. **Advisor** — engagement decision gate. Opens or reassesses the engagement
   before any operating position. [Decision 17](DECISIONS.md#17-qualifying-the-advisor-role-as-the-engagement-decision-gate).
3. **Starter** — executable tooling for trusted-base foundation and activation.
   Not a role. Adoption, grounding, and closure cells stay N/A.
4. **Controller** — operating rules. Runtime root for builder, inspector, and
   publisher. Advisor-before-Controller is engagement sequencing, not a
   manifest edge.
5. **Launcher** — executable tooling that creates, resumes, or appoints the
   account workspace hub. Not a role. It sits after the Trio so the hub
   scaffolder pins a productized Advisor rather than an unfinished one.
6. **Operating control** — `observer`, `architect`, `inspector`, `builder`,
   `locksmith`, `integrator`. Independent measurement first, then topology,
   change judgment, live-state realization, key custody, and package currency.
   Inspector and builder wait for controller at runtime; the sequence already
   placed controller.
7. **Agreements and custody** — `bouncer`, `butler`, `messenger`, `giver`,
   `keeper`. Person-facing operating integrity, still ahead of frontend
   surfaces.
8. **Strategy and expression** — `strategist`, `writer`, `designer`,
   `customer`, `publisher`, `influencer`. Designer and publisher are frontend work and
   wait. Customer inhabits a named audience for keep-or-fail before seal and
   can supply on-demand first-person testimony on feedback, alternatives,
   referral, churn, adopt, and worth. Publisher still waits for controller, writer, and
   designer at runtime. Influencer waits for publisher even though it has no
   runtime edge: audience-response measurement is the learn stage of
   publication, and productizing it first designs an open loop.

A first-wave consumer does not walk this list installing every name. They
open Advisor, bind only justified positions, and skip `not-applicable` roles
with a reason. The producer still productizes in this order, because a
package that is not yet a closed, installable loop must not be the thing a
consumer is told to pin.

## What "productized as a closed loop" means here

[LOOPS.md](LOOPS.md) is the charter. [LIFECYCLE.md](LIFECYCLE.md) is the
ladder. This list is the supplier-side rubric for first-wave *install and
re-run*, not a claim that state 5–7 have been reached.

| Criterion | Owner | Already gated? |
| --- | --- | --- |
| One job, one owned metric, one primary mode, durable boundary, close condition | supplier | `check:role-loop-archetypes` |
| Declared bin runs through the installer-linked name, not only by real path | supplier | `check:bin-reachability`; packed-consumer and qualification help/case probes use the same launch shape |
| README names public npm and needs no token | supplier | `check:install-docs` fails token-required install language (#924); missing public-npm claims are counted, not failed |
| README states the close condition a consumer binds | supplier | no dedicated gate — decision 25, tracked in #906. Advisor's README states the charter condition; Starter's README states that role-loop closure is N/A and names the trusted-base ternary; remaining packages are still the supplier gap |
| Owned metric is computed under the name the charter declares | supplier | no — decision 25 names the misses |
| Installed CLI produces native 0 / 1 / 2 with a matched control | supplier | staging evidence is presence-checked, not truth-checked |
| This repository can invoke it by dist path; a consumer can re-run the same path from an exact pin | supplier, then consumer | `check:package-evidence` for the author-side half |
| First-day roles declare `foundry.assessment` against a mapped bin | supplier | `check:role-assessment-surfaces` requires Advisor to declare one; other roles remain counted as the undeclared gap |

State 7 remains consumer-owned ([decision 25](DECISIONS.md#25-lifecycle-state-7-is-consumer-owned-by-design-and-the-supplier-side-gap-is-thirteen-readmes-not-the-shared-close-condition)).
A catalogue-wide `closed` count of zero is the expected steady state. The
supplier gap is README close conditions, reachable bins, honest install docs,
and metrics that actually compute — not a second close-condition string per
role.

## How to route the GitHub backlog

Do not re-open A/B/C as a live operating model ([decision 15](DECISIONS.md#15-removing-delivery-cohorts-from-the-operating-model)).
Do not start from #517. Classify each open issue against
`backlogRouting` in the contract:

- **Catalogue integrity** — source/registry drift, contaminated `latest`,
  missing current-version qualification, dead installer-linked bins, token
  install docs on public npm, consumer-facing success-over-unexamined-ground.
  This wave unblocks every package. Do it first.
- **Package productization** — a named package's closed-loop gap. Route it to
  *that package's wave*. An expression defect does not jump an operating-control
  defect.
- **Frontend expression** — visual, RTL, composition, dogfood `apps:site` /
  `apps:app` / `apps:admin`, audience-surface polish. These wait.
- **Consumer adoption** — pin, wire, deliberate failure, duplicate deletion,
  independent outcome. Foundry unblocks; only the consuming repository finishes.
- **New role** — not one of the current packages. Record it; do not sequence it in
  front of first-wave productization.
- **Historical tracking** — programme plans whose orientation command or
  position table no longer exists. Leave them open as history if they still
  hold evidence; do not orient a session from them.

Priority labels on the tracker today still mark several of those historical
issues `priority:p1`. The label is not this sequence. When a label and this
contract disagree, the contract wins until a human retags the tracker.

## What this still cannot prove

The checker proves the *order* is closed under the runtime graph and the
priority rule. It does not prove:

- that `latest` on the public registry is clean or at the source version;
- that a retained publication record covers the current manifest version
  ([decision 22](DECISIONS.md#22-state-4-published-is-keyed-by-nameversion-not-by-name));
- that the published tarball's installer-linked bin is the same bytes this
  source gate just spawned (`check:bin-reachability` is author-side);
- that any consumer has opened a position.

Those are measured elsewhere, on the date they are measured, and they expire.

## Related documents

- [ADOPTION.md](ADOPTION.md) — one package × one direct consumer × one evidenced position.
- [PUBLISHING.md](PUBLISHING.md) — state 4, including the runtime publication graph.
- [LIFECYCLE.md](LIFECYCLE.md) — the seven states; this sequence does not move a package along them.
- [LOOPS.md](LOOPS.md) — charter versus installed position.
- [DECISIONS.md](DECISIONS.md) — decision 27 records why this order is not the catalogue order and not #897.
