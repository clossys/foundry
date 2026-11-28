# CP1-REVIEWPLAN report

Unit branch: `claude/r2f-0048-cp1-reviewplan` at `64a8a0e911dfebafd21568d55171e47317b480f2` (pushed, fast-forward, no PR).

## Base

- `claude/r2f-0048-cp1-reviewplan` created from `claude/r2f-int2` at `e8deb2e7391eb29276aaa7500957697f9fc72d3c`.
- Merged `claude/r2f-0048-cp1-reviewqueue` at `613f4697a03ca533b593402cfa60f6ef167657b6` -> `2958f47e6`. One conflict, `packages/producer/src/cli/args.ts` USAGE: int2 had changed the "Record suites" line and reviewqueue had added `${FAST_USAGE}` above it. I kept both: the FAST_USAGE line, then int2's Record suites line.
- Merged `claude/r2f-0048-cp1-factory0` at `009240d0023b3d05b893d9aefe9d4bc66642f059` -> `13b115268`. No conflicts.
- `git cat-file -e <sha>^{commit}` succeeded for all three base shas after fetching.
- Unit commits: `99869e511` (the feature) and `64a8a0e91` (a package.json `"//"` comment key is read as a comment in the pass/fail scan).

## Preflight (all exit 0)

| command | exit |
|---|---|
| `git remote get-url origin` (names clossys/foundry) | 0 |
| `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-reviewqueue claude/r2f-0048-cp1-factory0` | 0 |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-reviewplan` | 0 |
| `node -v` (v22.23.5), `npm -v` (10.9.9) | 0 |
| `npm ci` (26s) | 0 |
| `npm run agent:cloud:bootstrap`, `npm run agent:cloud:check` | 0, 0 |

## What was built

- **(a) Class.** `clossys review plan <unit> --base <ref>` classifies base...head from the gate lexicon. The lexicon is data only, in `packages/producer/src/review/gate-lexicon.ts`: gate paths, gate lines, contract surfaces and pass/fail terms. Contract surfaces are READMEs, public contracts (`docs/contracts/**`, `packages/*/contracts/**`, `*.schema.json`), digests, and export lists (an `index.ts` whose changed lines are only re-exports). A diff whose only gate surface is one of these is non-gate. No D5 was needed: the lexicon could be stated as data.
- **(b) Passes.** The output ends with one of `NEXT: mechanical|blind|second-blind|closure-delta <head>`, `CLEARED`, `WAITING` or `REFUSED`. The budget it applies:
  - mechanical first;
  - a non-gate diff needs no judgement pass;
  - a gate diff gets 1 blind, or 2 when pass/fail logic changes or the first blind finds a P0/P1;
  - no final, ever;
  - one closure delta per fix round;
  - fix cap 2, so a third round is REFUSED.

  `--ask <pass>` exits 1 on a pass the budget does not allow.
- **Exact-head evidence.** `--evidence <github snapshot.json>` goes through the `@clossys/controller` adapter in `packages/producer/src/review/evidence.ts`. It uses `normalizeGitHubReviewEvidence` and `validateReviewEvidence`, and requires the evidence to be complete and at the exact head. `packages/producer/package.json` gains the dependency `"@clossys/controller": "^0.10.0"`, and `package-lock.json` gains the one matching line. No version changed.
- **(c) Carry.** `clossys review carry <cleared> <new> [--onto <ref>]` prints `CARRY|VOID <new>: <reason>` and exits 0 or 1. It returns VOID when:
  - the new head does not contain the cleared head;
  - there is an own non-merge commit;
  - an own-path blob changed;
  - a non-own path is not the default branch's blob.

  The code is `packages/producer/src/review/carry.ts`.
- **(d) Verdict record.** `clossys review verdict <unit> --role ... --head ... (--clear | --not-clear <reason> --severity Pn) [--blind] --log <jsonl>` appends a record in `clossys.review-verdict/1` format: the line `CLEAR <sha>` or `NOT CLEAR <sha>: <reason>`, plus the role and the blind attestation. A blind or second-blind verdict without `--blind` is refused, and so is any final.
- **(e) Rule and skill.**
  - `R-REVIEW-BUDGET` and `R-REVIEW-CARRY` are registered in `scripts/rules/registry.json` with `owner_agent: reviewer`. Both are stated verbatim in `packages/reviewer/skill/SKILL.md` and listed in its owned-rules block.
  - `check:review-plan` (`scripts/check-review-plan.mjs`) fails on every violation fixture: skill missing a rule, a final after a CLEAR, a third fix round, an unattested blind, a CARRY over an own-path change.
  - It runs from `@clossys/reviewer`'s `test`. Its gate test `scripts/check-review-plan.test.mjs` is auto-discovered by check:gates.
- **(f) Parity: NOT met as specified, see BLOCKED.** The parity test is "carry matches the recorded carry and wave cases" in `packages/producer/src/review/carry.test.ts`. It runs 3 cases from `packages/producer/src/review/__fixtures__/plan-parity/`: carry-held, carry-voided-own-path and gate-pass-sequence. The packet says the launch prompt attaches 3 recorded cases, but **none were attached**. These fixtures are reconstructed from the packet's own description of each case, and each says so in its `provenance` field. They prove the code agrees with the packet's stated rule. They do not prove it agrees with what `carry-check.py`, `wave-check.py` and the log actually recorded.

## Dogfood on this unit's own diff

Built with `npm run build -w @clossys/producer` (exit 0, 25s), then ran the verbs against the pre-change merge commit:

- `review plan HEAD --base 13b115268 --mechanical <demo PASS record> --ask blind`
  - result: exit 0, class gate, pass/fail changed (`check:review-plan` script line and new check sources), 2 blinds, `NEXT: blind`.
  - This matches the packet: "a second blind is required because the diff changes pass/fail logic".
- `review plan ... --ask final`
  - result: `REFUSED final: a final pass is not in the review budget`.
- `review carry 613f4697a 2958f47e6 --onto origin/claude/r2f-int2`
  - result: exit 1, `VOID 2958f47e6...: own-path blob change: governance/release-qualification-policy.json, package.json, packages/producer/src/cli/args.ts and 1 more`.
  - This is correct by the rule: the clearance of the reviewqueue unit at its own head does not carry onto this merged base, because int2 and the merge resolution changed reviewqueue's own paths.

## Commands and exit codes

| command | exit | time |
|---|---|---|
| `npm run build -w @clossys/controller` | 0 | 4s |
| `npm run build -w @clossys/director` | 0 | 3s |
| `npm run build -w @clossys/writer` | 0 | 7s |
| `npm run build -w @clossys/designer` (first try, before director/writer were built) | 2 | 36s |
| `npm run build -w @clossys/designer` (retry) | 0 | 36s |
| `npm run build -w @clossys/publisher` (first try, before writer was built) | 2 | 17s |
| `npm run build -w @clossys/publisher` (retry) | 1 | 757s |
| `npm run build -w @clossys/reviewer` | 0 | <5s |
| `npm run build -w @clossys/producer` | 0 | 25s |
| `npm run typecheck -w @clossys/controller` | 0 | 3s |
| `npm run typecheck -w @clossys/producer` | 0 | 12s |
| `npm run typecheck -w @clossys/reviewer` | 0 | 0s |
| `npx vitest run src/review` (producer; 7 files, 69 tests) | 0 | 42s |
| `npx vitest run` on 5 producer CLI/loop/help test files (110 tests) | 0 | 109s |
| `npm test -w @clossys/reviewer` (vitest 6 tests + check:fast-before-review + check:review-fail-closed + check:review-plan, each 0 findings) | 0 | 1s |
| `node --test scripts/check-review-plan.test.mjs scripts/check-review-fail-closed.test.mjs scripts/check-rules.test.mjs` (21 pass) | 0 | <2s |
| `node scripts/check-rules.mjs` (head) | 1 | ~15min |
| `node scripts/check-rules.mjs` (base 13b115268) | 1 | 308s |
| `npm run check:safety` (PARTIAL: no denylist in cloud, so not a clearance) | 0 | 4s |
| `npm run check:conflict-markers` | 0 | 2s |
| `npm run check:workspace-links` | 0 | 0s |
| `npm run check:lock-workspace-versions` | 0 | 0s |
| `npm run check:package-skills` | 0 | 0s |
| `npm run check:agents-definition` | 0 | 1s |
| `npm run check:changelog-location` | 0 | 0s |
| `npm run check:import-purity` | 0 | 1s |
| `npm run check:scope` | 0 | 0s |
| `npm run check:package-evidence` | 0 | 15s |
| `npm run check:loop-matrix` | 0 | 0s |
| `npm run check:orphan-checks` | 1 | 1s |
| `npm run check:root-entry` | 1 | 0s |
| `npm run check:foreign-references` | 2 | 0s |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 | <1s |
| `git push -u origin claude/r2f-0048-cp1-reviewplan` | 0 | <5s |

Notes on the non-zero exits:

- **designer and publisher first tries:** failed only because director and writer were not built yet. Both retries ran after those builds.
- **publisher retry (exit 1):** tsc emitted dist, then the build's `check:client-boundary` step reported `FAIL ./web/admin-pages (production): 0 inputs`. This unit does not touch publisher.
- **check:rules (head):** every fixture run of R-REVIEW-BUDGET (4) and R-REVIEW-CARRY (2) is `FAILS AS REQUIRED`. Other rules are base-red, listed below.
- **check:orphan-checks, check:root-entry, check:foreign-references:** each is base-red, listed below.

## Mutations

Each mutation was applied to the final source, ran the named test, was restored, and was checked with `cmp` (cmp exit 0 both times).

| mutation | named test that failed | test exit | cmp |
|---|---|---|---|
| always allow a final pass (`allowPass` returns allowed for `final`) | "plan refuses a final after a CLEAR blind" | 1 | 0 |
| ignore own-path changes in carry (`ownChanged = []`) | "carry voids on an own-path blob change" | 1 | 0 |

## Named tests (all pass)

- "plan gives one blind for a gate diff that leaves pass/fail logic unchanged"
- "plan adds a second blind when pass/fail logic changes"
- "plan refuses a final after a CLEAR blind"
- "plan refuses a third fix round"
- "carry voids on an own-path blob change"
- "carry matches the recorded carry and wave cases" (runs on reconstructed cases, see (f))

## Related tests: new red vs base red

- **New red:** none.
- **Base red** (same at the pre-change merge commit `13b115268`):
  - check:orphan-checks: 8 orphans under packages/producer, the same 8 at base. Reachable files went from 1227 to 1229, and the 2 added files are this unit's tests.
  - check:root-entry: `receipts` is an undeclared root entry. It comes from the reviewqueue merge.
  - check:foreign-references: exit 2, cannot validate `governance/approved-design-sources.json` provenance.
  - check:rules failing rules at head: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER. These are a subset of base's failing set, which also includes R-SHADCN-STOCK.

## Files touched (`git diff --stat 13b115268 HEAD`: 29 files, +1472 −2)

- package-lock.json
- package.json (`check:review-plan` and its `//` note)
- packages/producer/package.json (dependency on @clossys/controller)
- packages/producer/src/cli/review.ts
- packages/producer/src/cli/review-plan.ts
- packages/producer/src/review/gate-lexicon.ts
- packages/producer/src/review/plan.ts
- packages/producer/src/review/plan.test.ts
- packages/producer/src/review/carry.ts
- packages/producer/src/review/carry.test.ts
- packages/producer/src/review/evidence.ts
- packages/producer/src/review/__fixtures__/plan-parity/carry-held.json
- packages/producer/src/review/__fixtures__/plan-parity/carry-voided-own-path.json
- packages/producer/src/review/__fixtures__/plan-parity/gate-pass-sequence.json
- packages/reviewer/package.json (test script runs check:review-plan)
- packages/reviewer/skill/SKILL.md
- scripts/check-review-plan.mjs
- scripts/check-review-plan.test.mjs
- scripts/rules/registry.json
- scripts/rules/fixtures/R-REVIEW-BUDGET/skill/packages/reviewer/skill/SKILL.md
- scripts/rules/fixtures/R-REVIEW-BUDGET/verdicts/packages/reviewer/skill/SKILL.md
- scripts/rules/fixtures/R-REVIEW-BUDGET/verdicts/{final-after-clear,third-fix-round,unattested-blind,within-budget}.jsonl
- scripts/rules/fixtures/R-REVIEW-CARRY/skill/packages/reviewer/skill/SKILL.md
- scripts/rules/fixtures/R-REVIEW-CARRY/carry/packages/reviewer/skill/SKILL.md
- scripts/rules/fixtures/R-REVIEW-CARRY/carry/{carry-own-path,void-own-path}.json

Not touched: retired-leaves.ts, versions, changelogs, the release catalog, docs/review.md (its generator is unchanged), and any check, allowlist, baseline or gap list.

## Notes for the planner

- `clossys review plan|carry|verdict` dispatch on the first argument, so a base ref literally named `plan`, `carry` or `verdict` can no longer be passed as `clossys review <base> <head>`.
- Carry's default `--onto` is `origin/main`. Pass `--onto origin/claude/r2f-int2` while units fold onto the integration branch.
- To finish (f), drop the 3 scrubbed recorded cases into `packages/producer/src/review/__fixtures__/plan-parity/` in the same shape, replacing the reconstructed files, and re-run `npx vitest run src/review/carry.test.ts`. If a recorded verdict differs, that is a real parity finding against the code, not against the fixtures.

BLOCKED: preflight passed and every objective except (f) is implemented and verified at 64a8a0e911dfebafd21568d55171e47317b480f2, which is pushed to claude/r2f-0048-cp1-reviewplan. The packet says the launch prompt attaches 3 recorded parity cases (a carry that held, a carry voided by an own-path change, a gate unit's pass sequence), but none were attached and the packet forbids reading outside the repository. The parity test therefore runs on cases reconstructed from the packet's description, each marked as such in its provenance field. That proves the code agrees with the stated rule, not with what carry-check.py, wave-check.py and the log recorded. The planner's post-fold step retires those scripts on the strength of this parity, so I am not reporting it as DONE. Unblock by attaching the 3 scrubbed recorded cases. They drop into packages/producer/src/review/__fixtures__/plan-parity/, and no code change is expected unless they disagree with the code.
model: claude-opus-5-5
