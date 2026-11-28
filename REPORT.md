# CP1-UNITNEXT report: clossys unit next

Unit branch: `claude/r2f-0048-cp1-unitnext` at `c2984796a0d6ba3891e9b025397f79b6d9e30df7` (pushed, fast-forward, new branch).
Report branch: `claude/r2f-0048-cp1-unitnext-report` (this file only).

**Result: BLOCKED on objective (h), parity.** Objectives (a) to (g) are implemented, tested, mutation-checked and
pushed. Objective (h) and its named test, "unit next matches unit-state on the recorded cases", are not done: the 3
recorded parity units this packet says the launch prompt attaches did not come with the launch prompt, and the packet
says to read nothing outside the repository. Making up "recorded" cases would claim parity that nothing measured,
so the test does not exist. Details and options are under "Blocked".

## Base

| step | command | exit |
| --- | --- | --- |
| branch | `git checkout -b claude/r2f-0048-cp1-unitnext e8deb2e7391eb29276aaa7500957697f9fc72d3c` | 0 |
| merge 1 | `git merge --no-edit 642d50eb089358b320301b5687b84251e054249b` (plannerrun) | 0, clean |
| merge 2 | `git merge --no-edit ba5165f5a7cf80df54d9a4b200668bedaed4f2bb` (fastcheck) | 1, conflicts in `package.json` and `scripts/rules/registry.json`, resolved, commit `549570663` |
| merge 3 | `git merge --no-edit 009240d0023b3d05b893d9aefe9d4bc66642f059` (factory0) | 0, "Already up to date": fastcheck already contains factory0 (`git merge-base --is-ancestor 009240d0 HEAD` exit 0) |

How the conflicts were resolved: both sides only added. `package.json` keeps both the plannerrun `check:unit-packets`
script and the fastcheck `//check-fast-before-review` and `check:fast-before-review` scripts. `registry.json` keeps both
the R-UNIT-ENV and R-UNIT-TIER entries (plannerrun) and R-FAST-BEFORE-REVIEW (fastcheck), as separate objects. Both
files parse as JSON afterwards. No generated fixture was involved.

`git cat-file -e <sha>^{commit}` exit 0 for all four Base shas after `git fetch origin claude/r2f-int2
claude/r2f-0048-cp1-plannerrun claude/r2f-0048-cp1-fastcheck claude/r2f-0048-cp1-factory0` (exit 0).

## Preflight

| step | exit |
| --- | --- |
| `git remote get-url origin` names clossys/foundry | 0 |
| `git fetch origin claude/r2f-int2` plus the three upstream branches | 0 (the unit branch did not exist on the remote yet) |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-unitnext` | 0 |
| `node -v` v22.23.5, `npm -v` 10.9.9 | 0 |
| `npm ci` (18s) | 0 |
| `npm run agent:cloud:bootstrap` (21s) | 0 |
| `npm run agent:cloud:check` | 0 |

## What was built

- **Controller adapter** `packages/controller/src/loop/unit-next.ts` (pure, no filesystem, git or clock). It uses
  `plan-binding.ts` (`bindPlan` and `decidePlanExecution`: a verdict still holds only when its head and base
  fingerprint match the current ones), `staleness.ts` (`fingerprintInputs`) and the blocker owners in `types.ts`
  (each refusal names the owner its blocker kind rests with). It is exported from `@clossys/controller/loop`.
  - (a) `unitNext(facts, records, checks, wip, step?, expectedHead?)` gives the state (`new`, `exec`, `exec-failed`,
    `<step>-due`, `<step>-failed`, `ready-to-fold`, `folded`) and the one next legal step.
  - (b) Preconditions are checked in code and named when they fail: `installed`, `carry-pending`, `base-not-tip`,
    `head-changed`, `out-of-order`, `folded`, `wip-cap`.
  - (c) The order is exec, then rebase, fast, mech, review, fold. A fast or mech verdict holds only when its base is
    the current tip, and mech holds only from its `clossys.review/1` record, the only record that names its base. So
    mech never counts on a stale base.
  - (d) The WIP cap defaults to `UNIT_WIP_CAP_DEFAULT = 4`. A new unit's exec is refused while the cap's worth of other
    units are past exec and not folded.
  - (e) `supersedeChecks` and `markSuperseded`: queued or running checks at another head are superseded and not
    counted as live.
  - (f) `parseStepVerdict` reads each step's fixed-form verdict line (`DONE:` or `BLOCKED:`, `FAST PASS|FAIL|INCOMPLETE
    <sha>` or the fast-check/1 record, the review/1 record, `REVIEW: PASS|FAIL <sha>`). A record with no such line
    counts as a failed step. `nextVerdictLine` prints the closing `NEXT:` line.
- **Producer verb** `packages/producer/src/cli/unit-next.ts`, dispatched from `unit.ts`:
  `clossys unit next <unit> [--step s] [--head sha] [--dry-run] [--records dir] [--integration ref] [--branch b]
  [--wip-cap n] [--facts facts.json]`. It reads `<records>/<unit>/{exec.md, fast.json|fast.txt, mech.json, review.md,
  checks.json, carry.md}`, `<records>/config.json` (`wipCap`, `integration`), the planner launch log `loop.json`, and
  git (rebase means the tip is in the head, fold means the head is in the tip). Without `--dry-run` it writes the
  superseded marks to `checks.json`. Exit 0 when the step may run, 1 when refused (the rule is named), 2 on a read
  error.
- (g) **Rules and skill**: `packages/planner/skill/SKILL.md` gains "Sequence a unit" and lists R-UNIT-STEP-ORDER and
  R-UNIT-WIP as owned rules. Both are registered in `scripts/rules/registry.json` with `owner_agent: planner`, check
  `.#check:unit-next` (a new root script, also added to the root `check` step list after `check:unit-packets`), and a
  violation fixture each.

## Files touched (`git diff --name-status 549570663 HEAD`)

```
M  package.json
M  packages/controller/src/loop/index.ts
A  packages/controller/src/loop/unit-next.test.ts
A  packages/controller/src/loop/unit-next.ts
M  packages/planner/skill/SKILL.md
A  packages/planner/test-fixtures/unit-records/cp9-ready/{exec.md,fast.json,mech.json,review.md}
A  packages/planner/test-fixtures/unit-records/facts.json
A  packages/producer/src/cli/unit-next.test.ts
A  packages/producer/src/cli/unit-next.ts
M  packages/producer/src/cli/unit.ts
A  scripts/rules/fixtures/R-UNIT-STEP-ORDER/{cp9-stale-base/exec.md,cp9-stale-base/fast.json,facts.json}
A  scripts/rules/fixtures/R-UNIT-WIP/{cp9-new/README.md,cp9-wip-1..4/exec.md,facts.json}
M  scripts/rules/registry.json
```

Plus the merge commit `549570663` (`package.json` and `scripts/rules/registry.json` conflict resolution). Nothing else
was touched: no version, changelog, release catalog or `retired-leaves.ts` edit, no allowlist, baseline, gap list or
scanner change. The fixtures use placeholder shas (`aaaa...`, `cccc...`) and no paths.

## Commands and exit codes

| command | exit | time |
| --- | --- | --- |
| `npm run build -w @clossys/advisor` / `controller` / `director` / `designer` / `writer` / `publisher` / `producer` / `planner` (dependencies of producer, package-scoped) | 0 each | 2s / 3s / 2s / 26s / 5s / 612s / 19s / 1s |
| `npm run typecheck -w @clossys/controller` | 0 | 3s |
| `npm run typecheck -w @clossys/producer` | 0 | 9s |
| `npm run typecheck -w @clossys/planner` | 0 | 1s |
| `npx vitest run src/loop/unit-next.test.ts` (controller) | 0, 9/9 | 3s |
| `npx vitest run src/loop/` (controller, after the clean rebuild) | 0, 124/124 in 12 files | |
| `npx vitest run src/cli/unit-next.test.ts src/cli/unit.test.ts` (producer) | 0, 20/20 | 12s |
| `npm test -w @clossys/planner` | 0, 6/6 | 1s |
| `npm test -w @clossys/controller` | 1: 4 failed, 1749 passed, 7 skipped (all 4 are base-red, below) | 193s |
| `npm run check:unit-next` | 0, ends `NEXT: cp9-ready ready-to-fold fold cccc... fold OK` | <1s |
| `npm run check:rules` | 1 overall; R-UNIT-STEP-ORDER and R-UNIT-WIP report `FAILS AS REQUIRED` (exit 1 on their fixtures); no finding names a planner rule (other findings below) | 294s |
| `node packages/planner/dist/cli.js scripts/rules/registry.json` (planner-check) | 0, "lists exactly the 4 rule(s)" | <1s |
| `npm run check:orphan-checks` | 1, the same 8 orphan findings as at `549570663` (1233 reachable of 1225 there, 1234 of 1226 here: the new test is reachable) | 1s |
| `npm run check:safety` | 0, PARTIAL (no denylist in a cloud session, so this is not a clearance) | 3s |
| `node packages/producer/dist/cli/index.js check --fast --base 549570663 --json` | 0, `FAST PASS c2984796a0d6ba3891e9b025397f79b6d9e30df7` | 47s |
| `git merge-tree --write-tree claude/r2f-int2 HEAD` (local `claude/r2f-int2` = `origin/claude/r2f-int2` = e8deb2e7) | 0, tree `91920d950ec69051556967ab647e6d7ea0c9265a` | |
| `git push -u origin claude/r2f-0048-cp1-unitnext` | 0, new branch | |

### Related tests: new red / base-red

- `check --fast` (diff `549570663...HEAD`): red: none. base-red: `scripts/accept-unit.test.mjs` (it fails alone at
  the base too). Crash, noise, unrun: none. Commands run: three typechecks, the controller `unit-next.test.ts`, the
  producer `unit-next.test.ts` and `unit.test.ts`, `check-fast-before-review.test.mjs`, `check-orphan-checks.test.mjs`,
  `check-rules.test.mjs`, `pre-push-ratchet.test.mjs` (all exit 0), and `accept-unit.test.mjs` (exit 1, base-red).
- Controller full suite: 4 failures, all base-red. They are `src/release/pack-round-trip.test.ts` (3: real npm
  install from an isolated directory, timing out at 30s or 120s) and `src/release/preflight.test.ts` (1: a 60s
  timeout). The same 4 fail at `549570663` in a detached worktree (`npx vitest run src/release/pack-round-trip.test.ts
  src/release/preflight.test.ts`, exit 1: 4 failed, 33 passed). This matches the sandbox class in AGENTS.md #833.
- `check:rules` findings not caused by this diff: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE,
  R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER, and 2 unmapped `check:studio#`
  checks. None of their checks runs a file this diff touches. They were not re-measured at the base, because that
  needs the full studio and designer build this package-scoped run did not do. Treat them as unmeasured, not as
  proven base-red.

## Mutations (each applied to `packages/controller/src/loop/unit-next.ts`, restored by copy and checked with `cmp`, exit 0)

| mutation | change | named test | result |
| --- | --- | --- | --- |
| drop the base-equals-tip precondition | `if (!facts.tipInHead) {` changed to `if (!facts.tipInHead && facts.unit === "\u0000never") {` | "next refuses mech when the base is not the integration tip" | killed, exit 1 (`expected 'fast' to be 'rebase'`) |
| WIP cap check never fires | `wip.pastExec >= wip.cap` changed to `wip.pastExec >= Infinity` | "next refuses a new unit past the WIP cap until a fold" | killed, exit 1 |
| count superseded checks as live | `if (sameCommit(check.head, head)) live.push(check);` changed to `if (true) live.push(check);` | "a head change marks queued checks superseded" | killed, exit 1 |

A first try at the base-tip mutant (`if (false) {`) did not compile (TS2345 from narrowing). That makes it an invalid
mutant, not a kill, so it was replaced by the variant above. The vitest global setup rebuilds the dist from the
mutated source, so `npm run build -w @clossys/controller` (exit 0) was run again after restoring, and the loop suite
and producer tests were re-run green.

## Named tests

| named test | where | status |
| --- | --- | --- |
| next refuses mech when the base is not the integration tip | controller `unit-next.test.ts`, plus a producer CLI twin | pass |
| next refuses a step on a head changed since the last verdict | controller | pass |
| next orders rebase, fast check, mech, review, fold | controller | pass |
| next refuses a new unit past the WIP cap until a fold | controller | pass |
| a head change marks queued checks superseded | controller, plus a producer twin for the `checks.json` write and `--dry-run` | pass |
| a step with no verdict line counts as failed | controller | pass |
| unit next matches unit-state on the recorded cases | not written | **BLOCKED** (no recorded cases) |

## Out of scope / product-repo migration (described, not done)

- After the fold the planner retires `unit-state.py` and `units.py` and sequences units with `clossys unit next`.
  For that it has to write each unit's records into `clossys/.state/planner/units/<unit>/` with the file names above,
  and set `integration` (and optionally `wipCap`) in that directory's `config.json`.

## Blocked

The parity fixtures for (h) are missing. The packet says "the launch prompt attaches 3 recorded units (review verdict
files, receipts and their state lines)", but this launch prompt attached none, and the packet forbids reading outside
the repository. There is also a D5 aspect: three of the record formats `unit next` reads are not defined anywhere in
this repository, so this unit fixed them. They are the reviewer's verdict file (`REVIEW: PASS|FAIL <sha>` as its last
line), the carry marker (`carry.md` present means a carry is pending), and the check queue (`checks.json`,
`[{id, step, head, status}]`). The recorded `unit-state.py` cases are the only evidence of what the existing formats
look like.

Options:

1. Attach the 3 scrubbed recorded units in a follow-up launch. Then a short unit adds them under
   `packages/planner/test-fixtures/unit-parity/` and writes the parity test. If their verdict, carry or queue formats
   differ from the ones above, it maps them in `parseStepVerdict` and `loadChecks`.
2. Accept the three formats above as the record contract, and change the parity objective to "the planner records its
   next 3 live units with both tools and compares them" after the fold.
3. Drop (h) and retire `unit-state.py` without a parity record. This is not recommended: the lifecycle contract wants
   the measurement.

BLOCKED: objectives (a)-(g) are done and pushed at c2984796a0d6ba3891e9b025397f79b6d9e30df7 on claude/r2f-0048-cp1-unitnext (typechecks exit 0, 6 of 7 named tests pass, all 3 mutations killed, check --fast FAST PASS, merge-tree exit 0). Objective (h), "unit next matches unit-state on the recorded cases", cannot be done: the 3 recorded parity units the packet says the launch prompt attaches were not attached, and the packet forbids reading outside the repository. A D5 aspect goes with it: the reviewer verdict-file line, the carry marker and the check queue have no format in this repository, so this unit fixed them (REVIEW: PASS|FAIL <sha>, carry.md, checks.json). Option 1: attach the scrubbed cases and run a parity follow-up. Option 2: accept those formats and measure parity on live units after the fold. Option 3: drop (h).
model: claude-opus-5-5
