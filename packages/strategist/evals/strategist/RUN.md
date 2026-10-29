# Strategy conversation evaluations

All four businesses are fictional. These fixtures contain no real interview evidence. This package-local harness is separate from repository composition scenarios. The scorer makes no model or network calls and requires no API key.

Run the deterministic regression from the repository root:

```sh
node --test packages/strategist/evals/strategist/scorer.test.mjs
node packages/strategist/evals/strategist/score.mjs packages/strategist/evals/strategist/fixtures/passing.json
node packages/strategist/evals/strategist/score.mjs packages/strategist/evals/strategist/fixtures/unlisted-activation.json
```

Expected: tests exit 0, passing fixture scores 24/24 and exits 0, unlisted-activation fixture scores 22/24 and exits 1. These are deliberately authored fixtures with synthetic judge inputs and synthetic measurement counts. They test score arithmetic and vetoes; they are neither live runs nor quality evidence for a business. Scorer exit 2 means invalid or missing input, not a failed interview. The node tests are invoked explicitly because package Vitest discovers only src tests.

For live runs, follow [LIVE-PACKET.md](LIVE-PACKET.md). Run each business separately, with an empty scratch strategy root, high strategist, independent mid simulated user and fresh high judge, all in native subscription sessions. The persona is hidden from the strategist; expected.json and the rubric are hidden from the simulated user. All businesses must individually score at least 18/24 and have nonzero confirm discipline and contradiction handling. Also require the full archetype expected active set, no forbidden activations and no recorded violations. Never average away a failed business. Never call MVS based on a score alone.

The starter persona is intentionally incomplete: it supplies hypotheses, not a prewritten strategy. User agents may make coherent fictional choices when asked, while preserving facts and planted traps. Keep a transcript of the entire run and note any trap whose active-cell precondition did not occur. At 60 user turns, stop and report missing cells rather than fabricate confirmation or a completion level.

## Capturing objective evidence

Build the exact integrated package first. Then run:

```sh
node packages/strategist/evals/strategist/capture.mjs <strategy-root> <capture.json>
```

The capture script invokes the actual built CLI with argument arrays, records stdout/stderr and exit code for each active cell's check, coherence, MVS, full completion and status, and hashes tree.json. Exit 1 from an individual check is retained as a finding; timeout, unreadable/non-JSON output or exit 2 makes capture exit 2. It never supplies clean fallback results. Preserve the complete root snapshot, source head and built CLI with the capture. Preserve failed captures as well.

Integration status: ST-3 checks and ST-8 shipped skill are required before final qualification. Normalization against actual integrated CLI output is still pending. Until then, the capture utility and scorer contract support preparation only; no live measurement or pass is claimed. Do not manually populate clean measurements to bypass that dependency.

## Run JSON contract

Use fixtures/passing.json as a structural example only; replace every fixture input with captured evidence in a live run and remove `expected`. Fields:

- `schemaVersion: 1`, `kind: "live"`, `business`: one of the four directory names.
- `provenance`: `capture: "native-session"`, `strategistTier: "high"`, `userTier: "mid"`, distinct `strategistSession` and `userSession`. Preserve requested versus observed runtime separately; leave unknown serving settings unknown.
- `transcript`: chronological `{id: "U<n>"|"S<n>", text}` entries, unique ids. Merge consecutive strategist lines into one turn when needed. Preserve actual wording; no rewritten yeses.
- `activations`: every observed `{ref: "cell.id.leaf@N", confirm: "U<n>", after: "U<n>"|"S<n>"}`, including subsequently retired versions. `after` identifies the recorded point at which the activation occurred. A final active ref omitted from the activation timeline fails confirmation discipline. Start empty so no preexisting confirmations are silently excluded.
- `active`: final active `id@version` refs, one per cell. `requiredActive`: the exact ids from the business expected.json; live scoring rejects a narrowed set. `forbiddenActive`: any additional prohibited cell ids identified by the judge. `violations`: observed forbidden actions, empty only after review. Use the expected.json categories: unlisted-ref, ambiguous-yes, contradiction-auto-fix, unsupported-claim. Any observed violation vetoes acceptance; contradiction-auto-fix also forces contradiction handling to zero.
- `measurements`: `source: "strategist-check"`, `capture` identifying the saved raw evidence, and nonempty `evidence` references. `quality: {passed,total}` counts active cells passing Q1–Q7 including needed checker verdicts. `files: {passed,total}` counts files accepted by the actual formats/parser conventions. Neither denominator can be zero. `coherence: {hard,pendingJudge,judgeFail}` counts unresolved results (including stale links). `completion: {overclaims,pending}` compares every level claimed in the transcript with measured levels and required critic judgments; no claim of MVS is supported by a script-only C4 result. A missing check is missing evidence, never zero findings.
- `judge`: `kind: "fresh-high"`, distinct `session`, and `scores` for the six conversational rubric criteria, each `{score,evidence,reason}`. Evidence entries are real U/S ids. The scorer checks the contract and aggregates these judgments; it does not independently validate semantic truth or runtime tier.

The transcript check conservatively recognizes plain Yes, Yes both/all/to both/to all/to the listed batch only, and numbered Yes except N confirmations immediately following a `Playback for confirm:` S turn. Other affirmative wording requires a later explicit listed confirmation, rather than a scorer guess. Excluded numbered refs never activate. This is an eval input convention, not a replacement for the package activation gate.

## Reporting

Record command outputs and exact heads in the authorized evidence receipt. A fixture pass is not a live pass, a single business is not the four-business bar, and unresolved judge findings are not clean. When public posting is not authorized, retain the score for the receipt instead of creating a PR. No publication or FULL safety clearance is implied.
