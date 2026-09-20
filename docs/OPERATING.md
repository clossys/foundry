# How this repository lands and ships

This document is the standing contract for merge-train operation and release
evidence on this repository. Like [`LIFECYCLE.md`](LIFECYCLE.md), every claim
here is supposed to be checkable from the tree or from a recorded run — not
from a chat transcript.

## Three governors today

Three separate surfaces currently steer what may merge and what may publish:

| governor | what it actually controls | failure mode |
| --- | --- | --- |
| **GitHub ruleset required contexts** | A long list of named check contexts on `main` | Slot cost: deep stacks replay nearly the full matrix on every merge commit |
| **Role packages and their bins** | Graded contracts, qualification joins, inspector verdicts | Correct but fragmented: policy lives in many READMEs and dist paths |
| **Chat / agent prompt** | Human or agent chooses merge order, restack, and “ready for review” | Unbounded: no single executable fails closed when the prompt drifts |

**Target after first-wave publish:** role **packages and their bins** are the
constitution; the ruleset names **one** attestation context that proves the
tree-equivalence job ran; chat **invokes** a repository conductor script
rather than inventing merge policy.

## What stays true regardless of wave

**FULL public-safety.** Identity and credential scanning runs in FULL mode with
an explicit denylist — a partial pass is not clearance. See
[`SECURITY.md`](../SECURITY.md) and `AGENTS.md`.

**Qualify exact bytes on the pinned runtime.** Release qualification refuses
to run unless Node, npm, and zlib match the pin in
[`scripts/lib/release-runtime.mjs`](../scripts/lib/release-runtime.mjs). Workflow
and release commands must agree on that tuple.

**Tarball reproducibility.** Candidate evidence binds digests derived from
`npm pack` dry-run output, not hand-copied path lists. See
`scripts/lib/candidate-qualification.mjs`.

**Merge commits only on this train.** Squash is excluded because the forge
synthesizes contributor trailers from profile data at merge time. The declared
permitted methods live in
[`governance/merge-policy.json`](../governance/merge-policy.json); the
merge-train conductor uses **`--merge` only**.

**Live qualify stays out of pull-request CI.** Qualification installs the
candidate against the public registry and belongs on the publish path, not on
every stacked PR.

**Staged ≠ published ≠ adopted.** Those rungs are defined and enforced in
[`LIFECYCLE.md`](LIFECYCLE.md) and `scripts/check-package-evidence.mjs`. This
document does not add pipeline-declared states.

**Inspector does not compute its own escape rate.** That measurement is
`observer`'s job; inspector README states the boundary explicitly.

**Qualification joins rebound from the packed tree, never copied.** Join fields
in a qualification record are recomputed from the reviewed ref and packed
artifact manifest (`currentQualificationJoins` in
`scripts/lib/candidate-qualification.mjs`). Pasting digests from an earlier
run is a defect, not a shortcut.

## Overkill this wave deliberately avoids

These problems are real; fixing them before first-wave publish would steal CI
slots from the active merge stack and duplicate work owned elsewhere.

- **Deep independent stacks** (~19 PRs) each paying for a near-full required
  context matrix on every merge.
- **Full CI on no-op merge trees** — merge commits whose tree equals the second
  parent should attest equivalence instead of re-running the entire graph. A
  repo-local start for that attestation may land on `main` under separate CI
  work; this branch does not assume it is already present.
- **~19 named required jobs** in rulesets where one tree-equivalence
  attestation plus package gates would suffice.

## Target after publish

| change | intent |
| --- | --- |
| **Assembly from catalog DAG** | Replace ad-hoc workflow fan-out with evidence-driven ordering from the release catalog |
| **Tree-equivalent attestation as a packaged pure function** | Move `treesEquivalent` semantics into `controller` gates once packages are publish-stable; until then `scripts/lib/tree-equivalent.mjs` holds the helper |
| **One required GitHub context** | Ruleset names a single attestation job; other enforcement stays in bins |
| **Conductor in `scripts/`** | `scripts/land-stack.mjs` lands stacked PRs with injectable git/gh; not a package — packages do not hold forge credentials or mutate GitHub |
| **Observer outside the gate** | Measures minutes-per-identical-tree and similar host outcomes; does not become a required check by itself |
| **Adoption** | Tracked in issue **#806**; not part of this branch |

## Where policy lives

| concern | home | why |
| --- | --- | --- |
| Merge method declaration vs forge drift | `governance/merge-policy.json` + `scripts/check-merge-policy.mjs` | Observable read-only gate; cannot write settings |
| Stacked PR land policy (ready one, merge, restack) | `scripts/land-stack.mjs` | Credentials stay in `gh`; pure policy is testable without network |
| Package lifecycle rungs | `docs/LIFECYCLE.md` + `docs/contracts/package-evidence.json` | Evidence record, not chat |
| Job matrix cap, intercepted egress, conversation-safety silence | [`SECURITY.md`](../SECURITY.md) | Operational hazards that are not package APIs |
| Release runtime pin | `scripts/lib/release-runtime.mjs` | Single source for qualify/publish toolchain bytes |

## Conductor rules (`land-stack`)

The after-publish conductor encodes a fail-closed merge train:

- Merge method is **`merge` only** — never squash, never rebase for this train.
- **Ready** only the PR at the stack tip; others stay draft.
- **Unknown or failing mergeability** → do not merge.
- **Behind `main`** → restack (`git merge origin/main`, push without force), then re-check; do not merge while behind.
- **Checks** block unless `status` is `COMPLETED` and `conclusion` is `SUCCESS`, `SKIPPED`, or `NEUTRAL`.
- Do not enable auto-merge, do not delete unmerged heads, do not comment on PRs.

One-shot CLI today: `--status`, `--merge`, `--restack` — no long sleep loops.
