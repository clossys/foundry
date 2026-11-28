# CP1-TOKENPARITY fix round 1 — REPORT

Unit branch: `claude/r2f-0048-cp1-tokenparity` at `285fa5c9403a3e9f4c3394e37d679ea29be74101` (unchanged; nothing pushed to it).
Base: `67bb25580f7aea06038ac3d8c6c2cb74b5c42977`. `origin/claude/r2f-int2` is now `25fe2a0e6`.

Outcome: the reported failure does not reproduce in this clone, so no code change was made.

## Preflight

| command | exit |
|---|---|
| `git remote get-url origin` (names clossys/foundry) | 0 |
| `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-tokenparity` | 0 |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-tokenparity` ("Everything up-to-date") | 0 |
| `node -v` (v22.23.5), `npm -v` (10.9.9) | 0 |
| `npm ci` (about 20s) | 0 |

## Builds (package-scoped)

The designer vitest globalSetup refuses to start until the test-import closure is built.

- Round 1 in the wrong order: director 0, writer 0, publisher 2, producer 2 (`@clossys/designer/catalog` not built yet), designer 0. Then producer 0, publisher 2 (`@clossys/controller` not built), controller 0, publisher 0.
- Round 2, a clean rebuild in dependency order: controller 0 (3s), director 0 (1s), writer 0 (4s), designer 0 (22s), publisher 0 (479s), producer 0 (15s). After it, `npm run -s check:specimen-evidence` (producer) printed `PASS current: 0 real native compiler certificates` with exit 0. After round 1 the same check exited 1 ("evidence is stale"), so a closure built out of order leaves the specimen evidence inconsistent.

## The target test

`packages/designer/src/library-cli/cli.test.ts :: "supports explicitly empty surface layers/targets and keeps cross-layer errors visible"`

| command (from packages/designer) | result |
|---|---|
| `npx vitest run src/library-cli/cli.test.ts -t "explicitly empty surface"` | exit 0, 1 passed / 11 skipped |
| `npx vitest run src/library-cli/cli.test.ts` (after round 1) | exit 0, 12/12 |
| `npx vitest run src/library-cli/cli.test.ts --reporter=verbose` | exit 0, 12/12; target test 3554ms |
| `npx vitest run src/library-cli/cli.test.ts` (after round 2) | exit 0, 12/12, 44s wall |
| cli.test plus token-parity, check-components and hash-golden tests, verbose, run twice | exit 0 both times, 100/100; target test 3576ms and 3451ms |

The target test takes 3.4–3.6s against `testTimeout: 5_000` (`packages/designer/vitest.config.ts`).

## Bisection attempt by step timing

I timed each CLI call of the test with an untracked copy of its body (it is deleted, never committed):

- HEAD: status 346, check sections 570, check frames 578, emit 760, check sections 582, check frames 562, apply 144 (ms).
- The 7 changed non-test sources written at their base content (frames.app-shell.json, surface-consumption.data.json, declared-fallbacks.ts, AppFrame.tsx, FrameDock.tsx, Toaster.tsx, section-reveal.tsx), run twice: 371–388, 609–646, 617–656, 730–837, 582–660, 562–656, 144–149 (ms). Both runs passed.
- The HEAD content was then restored from `git show HEAD:<path>`, and `git status --short` came back clean.

No change on the branch makes this test slower or changes its result in this environment. Of the files `git diff 67bb25580f...HEAD` touches, none is read on the test's path in a way that changes behaviour. The JSON changes only swap sha256 values, and the composite under test has empty surface fills. The `int2` commits after the base (`0c76e2412`, `25fe2a0e6`) touch only `create.element/exemplars/assets.image.json` under packages/designer.

## Related tests

`npx vitest related --run <the 11 changed designer files>` (from packages/designer) took 628s, with 522 files and 8091 tests: 112 files and 258 tests failed, 7823 passed. Most failures look load-related (render, compiled-css and probe tests under full parallel load in this sandbox). cli.test is not among the failed files. I did not run the base side of this related set, so I give no new-red or base-red split for it. With no code change there is nothing new to attribute.

- New red (fails at HEAD, passes at base): none found. The target test passes at HEAD here.
- Base red: not measured.

## Other validations

| command | exit |
|---|---|
| `npm run typecheck -w @clossys/designer` (19s) | 0 |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 |

## Files touched

None committed. The only working-tree edits were temporary: the timing-probe test file, which was deleted, and the base-content swap, which was restored. Both are listed above.

## Likely cause (hypothesis, unmeasured on the reviewer side)

The reviewer's red may be either of two things:

- A 5s timeout on a slower or loaded host. This test already uses about 70% of its budget at base and at HEAD alike.
- A test-import closure built out of order, which this clone showed leaves the specimen evidence stale.

Neither one is a change on this branch. Raising the timeout would loosen the test, so I did not do it. Next step: run the reviewer's command again after a clean ordered build (controller, director, writer, designer, publisher, producer) and record its failure output, the assertion or timeout and its duration. Without that output there is no code defect to fix.

BLOCKED: the named test passes at HEAD 285fa5c in this cloud clone in every configuration tried: alone, the whole file, with the changed test files, after two build orders and inside the 522-file related run. With the branch's source changes reverted to base content, its step timings are the same. So I found no branch change that breaks it, and committed no code change. The unit branch is left at 285fa5c. Needed: the reviewer's actual failure output (assertion versus timeout, and duration) and its build state.
model: claude-opus-5-5
