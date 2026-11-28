# CP1-FASTCHECK, second run: (a2) crash rider, (a3) base compare after the per-file fallback, (a4) base compare for every Validation command

Unit branch: `claude/r2f-0048-cp1-fastcheck`, pushed as a fast-forward `4120d541e..ba5165f5a`.
Measured in a 4-core cloud sandbox (Node 22.23.5, npm 10.9.9). This sandbox has no denylist, so the public-safety run is PARTIAL and is not a clearance.

## Preflight

| Step | Result |
| --- | --- |
| `git remote get-url origin` | names clossys/foundry |
| `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-fastcheck claude/r2f-0048-cp1-factory0` | exit 0. Tips match the brief: 4120d541e, 25fe2a0e6, 009240d00 |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-fastcheck` | exit 0 |
| `node -v` / `npm -v` | v22.23.5 / 10.9.9 |
| `npm ci` | exit 0, 18.6 s |

## Merges

1. `e2c4fbae3`: merges `claude/r2f-int2` at 25fe2a0e6. There was one conflict, in `packages/producer/src/cli/args.ts` (USAGE). Both sides were kept: this branch's `${FAST_USAGE}` line, and int2's longer `Record suites` line. `package.json` and `governance/release-qualification-policy.json` auto-merged; each side's entries are kept.
2. `fc5664341`: merges `claude/r2f-0048-cp1-factory0` at 009240d00. No conflicts (4 files: `docs/contracts/agents.json` and controller positions).

Generated fixtures: no generated file was changed on both sides. The only files changed on both sides were `args.ts`, `package.json` and the qualification policy, none of them generated. So no generator verb had anything to regenerate. Generated outputs that came from one side came in unchanged by git.

## What was implemented (commit `ba5165f5a`)

- **(a2) Crash rider.** A test file is a `crash`, never a fail or base-red, when it has no result row and any of these holds: vitest itself exited by signal (128 or above, now computed as 128 plus the signal number), vitest reports `Worker exited unexpectedly with signal … running test file <f>`, or the run's output shows a heap abort. A node unit exiting 128 or above is a crash too.
  - Crashed files run again alone, one process per file (`Runner.single`), at head and at base.
  - A crash still left after that makes the verdict `FAST INCOMPLETE <sha>` (exit 1); the alone step's status is `incomplete`. It is never base-red, whatever base did. A red still takes precedence (`FAST FAIL`).
  - The record gains `crash[]` (id, signature, exit, messages) and `aborts[]` (every abort seen, with its step and signature). The signature is `v8-abort`.
- **(a3) Base compare after the per-file fallback.** `Runner.settle` runs the alone step the same way in both trees: first the batch, then the per-file fallback for every crashed file. Each file's last result at head is compared with its last result at base, so a file that fails alone at both is base-red. A heap-limit abort (`JavaScript heap out of memory` / `Reached heap limit`) gets the signature `v8-heap`. That file runs once more alone with `NODE_OPTIONS=--max-old-space-size=<HEAP_RETRY_MB>`, which is the larger of 8192 and twice this process's limit. No ruling file is read.
- **(a4) Base compare for non-test commands.** Each package typecheck, and each root check run as wired (`npm run check:*` with no gate test), that exits non-zero at head is run at base too.
  - Findings are the distinct normalized output lines: the tree path becomes `<root>` and durations become `<t>`.
  - The same exit and no finding new at head is base-red, and typecheck then continues to the tests. Anything else is red, and its message names the new findings.
- Help (`FAST_USAGE`) and `packages/reviewer/skill/SKILL.md` describe the crash and command behavior. The rule sentence that R-FAST-BEFORE-REVIEW checks is unchanged.

## Files touched by this run (`git diff --name-status 4120d541e..ba5165f5a`, own commit only)

| Status | File |
| --- | --- |
| M | `packages/producer/src/check/fast.ts` |
| M | `packages/producer/src/check/fast.test.ts` |
| M | `packages/producer/src/cli/fast-usage.ts` |
| M | `packages/reviewer/skill/SKILL.md` |
| M (merge resolution) | `packages/producer/src/cli/args.ts` |

These were not edited: versions, changelogs, the release catalog, `retired-leaves.ts`, any allowlist, baseline, gap list or scanner.

`receipts/receipt-cp1fastcheck.md` was committed on the branch by the first run. It is left untouched, so it does not cover a2–a4; this REPORT supersedes it.

The existing named test "fast stops at typecheck and runs no tests" now also expects the one base typecheck run that (a4) requires. It still asserts that no test command runs.

## Commands and exit codes

| Command | Exit | Time |
| --- | --- | --- |
| `npm run build -w @clossys/controller` | 0 | 2 s |
| `npm run build -w @clossys/director` | 0 | 2 s |
| `npm run build -w @clossys/designer` | 0 | 21 s |
| `npm run build -w @clossys/writer` | 0 | 4 s |
| `npm run build -w @clossys/publisher` | 0 | 460 s |
| `npm run build -w @clossys/reviewer` | 0 | 1 s |
| `npm run build -w @clossys/producer` | 0 | 14 s |
| `npm run typecheck -w @clossys/producer` | 0 | 8 s |
| `npm run typecheck -w @clossys/reviewer` | 0 | 1 s |
| `npm test -w @clossys/reviewer` (includes `check:fast-before-review`) | 0 | <1 s |
| `node --test scripts/check-fast-before-review.test.mjs scripts/check-rules.test.mjs` | 0 | 1 s |
| `node scripts/check-rules.mjs` | 1 | 233 s |
| `npx vitest run src/check/fast.test.ts src/cli/cp1-help.test.ts` (packages/producer) | 0 | 30 s |
| `git merge-tree --write-tree claude/r2f-int2 HEAD` | 0 | — |
| `npm run agent:cloud:bootstrap` | 0 | 24 s |
| `npm run agent:cloud:check` | 0 | 1 s |
| `npm run check:safety` (PARTIAL: no denylist) | 0 | 2 s |

`check:rules` exit 1: R-FAST-BEFORE-REVIEW fails its three fixtures as required. The failing set is the same eight rules the first run recorded at its head: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER. Also 2 unmapped `check:studio#designer` checks. They need studio and e2e builds this sandbox lacks, and no touched file is involved. `check:rules` was not run on a base tree.

## Named tests (`fast.test.ts`, 14 of 14 pass)

```
fast fails on a new related red and names the test
fast passes when the only red also fails alone at base
fast stops at typecheck and runs no tests
fast refuses with no base
slow test is listed and files one request with file-requests
fast json record matches the printed verdict
fast runs root node tests for a scripts-only diff
fast fails a non-empty diff that ran nothing
check --help documents --fast, --base, --json and --file-requests
fast is incomplete past its budget and lists the files left unrun
a crash at head and base is FAST INCOMPLETE, not base-red                 (new, a2)
a file failing alone at head and at base is base-red after fallback       (new, a3)
a check that fails identically at base is base-red                        (new, a4; also asserts a finding new at head is FAST FAIL, and a typecheck red at base is base-red)
a heap abort is v8-heap and runs once more alone at a higher heap limit   (new, a3 heap rider)
Tests  14 passed (14)
```

The crash fixtures are real processes. A test file SIGKILLs the vitest process running it, giving exit 137 with no row. The heap fixture prints V8's heap message and kills its own worker unless it runs above the retry heap limit.

## Mutations (on `packages/producer/src/check/fast.ts`; each restored from a saved copy and checked with `cmp`: identical)

| Mutation | Replacement | Named tests failed |
| --- | --- | --- |
| treat a base-red as new | `if (atBaseResult?.status === "fail") baseRed.push(entry);` → `if (false) …` | passes-when-only-red-at-base; base-red after fallback; check fails identically at base (3) |
| skip the alone re-run | `runner.settle("alone", repo, batch, fallback)` → `Promise.resolve(rerun)` | new related red; only red at base; slow test; crash; fallback; heap (6) |
| drop the typecheck stop | `if (typeNew.length) {` → `if (false) {` | fast stops at typecheck (1) |
| treat a crash as base-red (a2) | crash branch pushes to baseRed when base did not pass | a crash at head and base is FAST INCOMPLETE, not base-red (1) |
| skip the base compare after fallback (a3) | base-side `settle(…, fallback.filter(present))` → `settle(…, [])` | crash test; base-red after fallback (2) |
| skip the base run for non-test commands (a4) | typecheck base pool guarded `false &&`; base settle filters out `isCommand` units | fast stops at typecheck; check fails identically at base (2) |

The first try at the (a4) mutation (`if (!base)` → `if (true)` in `compareCommand`) did not type-check. The producer's vitest globalSetup build refused it before any test ran, so it was discarded as no evidence and replaced by the real base-run skip above. That mutant typechecked (`tsc --noEmit` exit 0) before its run. Every other mutant compiled through the same globalSetup build.

## Run time on this unit's own diff

- `node packages/producer/dist/cli/index.js check --fast --base <fold base> --json`
  - The fold base is a local, unpushed commit: `git merge-tree` of int2 25fe2a0e6 and factory0 009240d00, which is the base the packet names.
  - It ran in a temporary detached worktree whose HEAD is this branch's exact tree (`ba5165f5a^{tree}`) on that base.
  - The diff is 18 files.
- Result: exit 0, **wall 220.0 s** (under 5 min), `FAST PASS`.
  - typecheck: 2 packages (producer, reviewer), 8.5 s.
  - related: 41 units, 6 failed, 77.7 s.
  - alone: 15 re-run, 6 base-red, 129.7 s.
  - No crash, no abort, no noise.
- For contrast, `--base origin/claude/r2f-int2` on the real branch diffs 92 files, because FACTORY0's commits are not yet in int2. That run gave `FAST INCOMPLETE ba5165f5a`: exit 1, wall 311.2 s, past the 300 s budget with 50 of 90 units unrun. That is the budget rule working, not a pass.

Related-test lists (own-diff run):
- New red: none.
- Base-red (fail alone at head and alone at base): `packages/producer/src/check/ref-verbatim-default.test.ts`, `packages/producer/src/check/slot-resolve.test.ts`, `packages/producer/src/cli/inline-gates.e2e.test.ts`, `packages/producer/src/pipeline/chain.test.ts`, `packages/producer/src/pipeline/interview.test.ts`, `scripts/accept-unit.test.mjs`.
- Slow (listed, not failing): fast.test.ts 19.2 s, install-next-bind 18.7 s, install-site 14.2 s, check-contamination-classes 13.8 s, pre-push-ratchet 16.7 s (related-run measurements); cp1-help 2.3 s, cp1-u2 2.4 s, ia-regroup 3.2 s, green 3.2 s, wiring 4.8 s, writer-approval 9.2 s, classify-change-tier 3.3 s (alone).

## Out of scope

- The packet's receipt path, `wt` and planner-side lines were skipped per the brief.
- No product-repo migration is needed.
- Not run here: FULL-mode public safety and release qualification (owner-machine work).

DONE: ba5165f5a7cf80df54d9a4b200668bedaed4f2bb
model: claude-opus-5-5
