# CP1-REVIEWQUEUE report

Unit branch `claude/r2f-0048-cp1-reviewqueue`, head `613f4697a`, base `claude/r2f-0048-cp1-fastcheck` at `4120d541e`. Cloud session, no denylist (safety gate PARTIAL only), nothing published, no PR.

## Outcome

Delivered and pushed: (a) fail closed, (b) base reds, (c) patch mutations, (e) rule and skill, the queue engine of (d), and parity records for (f). Not delivered, so the unit is BLOCKED:

1. **D5: queue capacity.** No existing config holds a per-machine heavy-slot count. I searched the repository for heavy, slot, capacity, concurrency and machine config. The only machine-capacity readings are hardcoded core formulas (`check --fast` uses `availableParallelism() - 1`, `check-readme-examples` uses `MAX_DEFAULT_JOBS`), and the "3 heavy slots" in the evidence lives in the planner-side tool, outside this repository. So `RunQueue` requires its caller to pass `capacity` and has no default, and `clossys review` is **not yet wired to wait in the queue**: wiring it needs that capacity source. Options:
   - A. A per-machine file, e.g. `$XDG_CONFIG_HOME/clossys/machine.json` `{ "heavySlots": n }`. A missing file is a usage error, never a default. (Recommended: it is per machine, as the packet asks.)
   - B. Add `heavySlots` to `ReviewConfig` (`packages/producer/src/review/config.ts`). It already exists, but it is per repository, not per machine.
   - C. Derive it from cores, as `check --fast` does (e.g. `max(1, floor(cores / 2))`). A formula, not config.
   - D. A required `--heavy-slots <n>` flag on each `clossys review` call. The caller (planner) owns the number.
2. **(f) parity on fixture 2 lists.** Verdict and command red match, and the recorded new red is found, but the engine finds 4 further new reds (details below). I did not drop real reds to force equal lists.
3. **Full `clossys review` was not run at the fixture heads.** It was measured as infeasible here: at 43s per producer test file alone, the covering sets of 336, 1288 and 324 files come to roughly 4h, 15h and 4h before mutation. Parity was measured on the related set (`check --fast` selection) plus the packet command, through the engine's own functions.

## What changed

- **(a) Fail closed.** `exec.ts` gets `observeRuns`. `review.ts` counts every command except git plumbing, and adds two findings:
  - `review.no-commands`: zero commands ran. An empty diff is now FAIL. The existing test "passes the same commit…" was changed to expect FAIL, which strengthens it.
  - `run.missing`: any command exited 127.
  - The report carries `ran`, `newRed`, `baseRed` and `line`. `--record <file>` writes the JSON record, and the last printed line stays `MECHANICAL: PASS|FAIL <head> <tree>`.
  - `clossys receipt` ends `RECEIPT: PASS|FAIL <head>` and fails on no commands, any 127, or an unexpected exit. `receipt.json` gains `verdict` and `line`. The review fails `receipt.no-commands`.
- **(b) Base reds.** A red covering test is listed per test (`file :: full name` from vitest FAIL lines, else the file) and re-run alone at the merge base, in a tree with the head tree's `node_modules` linked in.
  - Same id red at base: base-red, a note. Anything else: new red, a FAIL.
  - `--fast <fast.json>` (same head and merge base, else `fast.record` FAIL) lends its base-red list.
  - A file that fails at base without naming a test lends base-red only when the test file's blob is identical at the merge base and head. This matches `check --fast`'s per-file rule; parity fixture 3 found it (commit `1b9747a91`).
  - The decision is the pure `splitRed`/`mechanicalVerdict`.
- **(c) Patch mutations.** `clossys review --mutation <patch> --expect-fail <regex> [--run <cmd>]… [--record]` works on the checkout:
  - fingerprints every tracked and untracked non-ignored file (mode plus sha256);
  - runs `git apply`, then the commands (default: the tests reaching the patched files), then `git apply -R` in a `finally`;
  - fingerprints again;
  - is PASS only if a command failed with output matching the regex, the tree is byte-identical, something ran, and nothing exited 127.
  - It ends `MUTATION: PASS|FAIL <head> <patch sha256>`.
- **(d) Queue engine** (`queue.ts`):
  - one JSON file under an mkdir lock; a dead holder's lock is taken over;
  - order: active-executor installs, then reviews, then re-runs; longer critical path first; then sequence;
  - strict head-of-line admission against `capacity`;
  - `wait()` loops until admitted or cancelled, with no try count;
  - `enqueue()` cancels the unit's queued or running runs at other heads and signals the running ones;
  - `queueFindings` is mirrored by the rule check.
- **(e) Rules.** `R-REVIEW-FAIL-CLOSED` and `R-REVIEW-RUN-QUEUE` are added with `owner_agent: reviewer`, stated verbatim in `packages/reviewer/skill/SKILL.md` and listed in its owned-rules block. `scripts/check-review-fail-closed.mjs` (root `check:review-fail-closed`, run from `@clossys/reviewer`'s `test`) carries 7 fixture runs, and every one FAILS AS REQUIRED.
- `packages/producer/docs/review.md` was regenerated by `clossys review --write-doc`.

## Files touched (31)

```
M package.json
M packages/producer/docs/review.md (generated by clossys review --write-doc)
M packages/producer/src/cli/review.ts
A packages/producer/src/review/__fixtures__/parity/{base-red-only,fail-new-red,pass}.json
M packages/producer/src/review/{doc,exec,receipt,review,review.test,types}.ts
A packages/producer/src/review/{parity.test,patch,patch.test,queue,queue.test}.ts
M packages/reviewer/package.json (test script only)
M packages/reviewer/skill/SKILL.md
A scripts/check-review-fail-closed.mjs, scripts/check-review-fail-closed.test.mjs
A scripts/rules/fixtures/R-REVIEW-FAIL-CLOSED/** (5 files), scripts/rules/fixtures/R-REVIEW-RUN-QUEUE/** (4 files)
M scripts/rules/registry.json
```

No version, changelog, release-catalog, baseline, allowlist, gap-list, scanner or `retired-leaves.ts` edits.

## Commits

`1959fba32` engine, `7ce2befe3` rules, `1b9747a91` unchanged-file base-red, `613f4697a` parity records.

## Commands and exit codes

| Command | Exit | Time |
|---|---|---|
| `git remote get-url origin` (clossys/foundry) | 0 | - |
| `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-fastcheck` (unit branch not yet on origin) | 0 | - |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-reviewqueue` | 0 | - |
| `node -v` v22.23.5 / `npm -v` 10.9.9 / `npm ci` | 0 / 0 / 0 | 22s |
| `npm run agent:cloud:bootstrap` / `npm run agent:cloud:check` | 0 / 0 | 25s / 1s |
| `npm run build -w` controller, director, designer, writer, publisher, producer, reviewer | 0 each (publisher 579s) | - |
| `npm run typecheck -w @clossys/producer` | 0 | 28s |
| `npm run typecheck -w @clossys/reviewer` | 0 | 1s |
| `npx vitest run src/review/` (producer) | 0, 54 passed | 37s |
| `npm test -w @clossys/reviewer` (vitest + check:fast-before-review + check:review-fail-closed) | 0, 6 passed | 2s |
| `node --test scripts/check-rules.test.mjs scripts/check-review-fail-closed.test.mjs scripts/check-fast-before-review.test.mjs` | 0, 21 passed | 1s |
| `node scripts/check-review-fail-closed.mjs` | 0 | <1s |
| `clossys review --check-doc` | 0 | - |
| `node scripts/check-orphan-checks.mjs` | 0 | - |
| `npm run check:safety` (PARTIAL, no denylist in cloud) | 0 | 6s |
| `node scripts/check-rules.mjs` at head | 1 | 238s |
| `node scripts/check-rules.mjs` at base `4120d541e` | 1 | 269s |
| `node scripts/check-single-reader.mjs --root scripts/rules/fixtures/R-SINGLE-READER` (re-run at head) | 1, finding detected as required | - |
| `node scripts/check-foreign-references.mjs` | 2 at head and at base (same message: governance/approved-design-sources.json) | - |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 1 | - |

`check:rules` details:

- Head and base fail the same pre-existing rules: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE and R-E2E-CONSUMER. These are environment checks: studio and e2e need builds this session lacks.
- Head also listed R-SINGLE-READER, but that run overlapped the history unshallow. Its fixture run detects correctly on a re-run (row above).
- The new rules print `FAILS AS REQUIRED` for all 7 fixture runs: R-REVIEW-FAIL-CLOSED x4 (missing-rule, pass-on-nothing, pass-on-missing, no-verdict) and R-REVIEW-RUN-QUEUE x3 (missing-rule, superseded-live, gave-up).

merge-tree details:

- Integration tip `25fe2a0e6`. The only conflict is `packages/producer/src/cli/args.ts`.
- `git merge-tree --write-tree origin/claude/r2f-int2 4120d541e` (the CP1-FASTCHECK base alone) gives the same single conflict. It is inherited from the base, not from this diff, which does not touch args.ts. It is for the planner's rebase onto the integration branch after CP1-FASTCHECK folds.

## Named tests (all pass)

- "review fails when zero commands ran", "review fails on a missing install", "a base-red test is not reported as new red": `src/review/review.test.ts`
- "patch mutation restores the tree byte for byte": `src/review/patch.test.ts`
- "queue cancels runs for a superseded head", "queue never gives up a wait" (500 looks held, then admitted): `src/review/queue.test.ts`
- "review matches the recorded mechanical verdicts": `src/review/parity.test.ts`

## Mutations

Each was run with this branch's own `clossys review --mutation` in an isolated clone at `7ce2befe3`. Each run uses `--expect-fail "FAIL .*> <test name>"` and `--run "cd packages/producer && npx vitest run <spec> -t '<test name>'"`, and is then checked with `cmp` against a copy saved before the run.

| Mutation | Patch | Killed by | review --mutation | cmp |
|---|---|---|---|---|
| treat zero commands as PASS | `if (ran.commands === 0)` -> `if (false)` in review.ts failClosed | review fails when zero commands ran | exit 0, MUTATION: PASS (18s) | 0 |
| drop the superseded-head cancel | the cancelled entry -> `return item;` in queue.ts enqueue | queue cancels runs for a superseded head | exit 0, MUTATION: PASS (15s) | 0 |
| skip the post-mutation tree comparison | `fingerprintDiff(before, fingerprint(repo))` -> `fingerprintDiff(before, before)` in patch.ts | patch mutation restores the tree byte for byte | exit 0, MUTATION: PASS (17s) | 0 |

The first patch for mutation 2 (`return item;` as the first statement) did not compile: TS2345 in the package's globalSetup build. The tool correctly reported it `mutation.not-killed`, FAIL. It was replaced by the patch above. Controls on the restored tree: each named test passes on its own, exit 0.

## Parity (f)

Method, per head: a fresh `git clone --shared` tree, `npm ci`, and package-scoped builds. Then this branch's `clossys check --fast --base <merge-base> --json`, which selects the related set. Where that stopped at its 5-minute budget (FAST INCOMPLETE on fixtures 2 and 3), the unrun units were run with no budget: one vitest batch per package, node units one by one. Every failing file was then run alone at head and alone at the merge base (head `node_modules` linked in), and the review's `failingTests` plus `mechanicalVerdict` were applied. Fixture 2 also ran its packet command.

| Fixture | Recorded | Engine | Lists |
|---|---|---|---|
| 1. `998fff8e8394` vs `c1589043af28` | PASS, no new red | PASS | new red: none. Base-red: 24 tests in 8 producer files |
| 2. `c0c32cdecd84` vs `c1589043af28` | FAIL: `node scripts/check-agent-lists.mjs` exit 1 expected 0; new red `packages/producer/src/package-path.test.ts :: the contamination check's --skill id packages (CONTAM-U3 D5) > are exactly the packages packagePath maps` | FAIL | Command red: identical. New red: the recorded test (fails at head, passes at base) **plus 4**: `scripts/accept-qualification-handoff.test.mjs`, `scripts/generate-qualification-record.test.mjs`, `scripts/run-candidate-qualification.test.mjs`, `scripts/validate-candidate-publish.test.mjs`. Base-red: 38 |
| 3. `c8bed8adaf15` vs `2065d5ef8ad2` | PASS; the producer related failures are all base-red | PASS | new red: none. Base-red: 31 (producer, plus one writer test whose unchanged file fails to set up at base) |

The fixture 2 extras are real, not sandbox noise. This head edits `governance/release-qualification-policy.json`. Run alone at head they fail with "release qualification policy failed its own shape validation" / "invalid qualification policy", and alone at the merge base they pass. The recording's related set did not include them. The parity record states this divergence and pins the observed list.

Timings in seconds:

| Fixture | Install | Builds | fast | Unrun batch | Classify |
|---|---|---|---|---|---|
| 1 | 27 | 666 | 428 | - | 566 |
| 2 | 20 | 768 | 315 | 915 | 941 |
| 3 | 17 | 732 | 328 | 272 | 744 |

The fixture records hold head, base, the recorded verdict and lists, and the observation. They are scrubbed: repo-relative paths only, no logs.

## After the fold

The planner migration ("planner runs mechanical review only through `clossys review`; `mech-review.py`, `mech-run.sh`, `mutate.py`, `receipt.py` retired") needs:

- a D5 decision on the capacity source;
- a follow-up that wires `clossys review` (and installs) to enqueue, wait and finish, with the superseded-head cancel keyed by unit id.

That retirement happens outside this repository.

BLOCKED: BLOCKED-D5. Queue capacity cannot be read from existing config without a new design: no per-machine heavy-slot setting exists in the repository, so `RunQueue` takes capacity from its caller and `clossys review` is not yet wired to wait in the queue. Pick options A–D above (A recommended). Everything else is pushed at `613f4697a` and passes its named tests, mutations and typechecks. Parity matches on fixtures 1 and 3. Fixture 2 matches its verdict, command red and named new red, and additionally reports 4 genuine new reds that the recorded related set never ran.
model: claude-opus-5-5
