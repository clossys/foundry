# CP1-FASTCHECK receipt: `clossys check --fast`

Base: `claude/r2f-0048-cp1-factory0` at `58aceb5f53bb9d84a60368374c1f2b1bc7d1408a`. Branch: `claude/r2f-0048-cp1-fastcheck`.
Measured in a 4-core cloud sandbox (Node 22.23.5). Its public-safety run is PARTIAL (no denylist here), so it is not a clearance.

## Files touched (`git diff --name-status 58aceb5f5..HEAD`, before this receipt)

| Status | File | What |
| --- | --- | --- |
| A | `packages/producer/src/check/fast.ts` | The engine: base resolution, selection, typecheck, related (budget), alone, base tree, verdict, record, format |
| A | `packages/producer/src/check/fast-reporter.mjs` | The vitest reporter: one JSON line per finished test file, so a stopped run keeps its results |
| A | `packages/producer/src/check/fast.test.ts` | The eight named tests, plus a help test and a budget test, on real throwaway git repositories |
| A | `packages/producer/src/cli/fast.ts` | `clossys check --fast` argv, `--file-requests` (through `clossys request --kind report`) |
| A | `packages/producer/src/cli/fast-usage.ts` | The `--fast` help text |
| M | `packages/producer/src/cli/args.ts` | `clossys check --help` (USAGE) includes the `--fast` lines |
| M | `packages/producer/src/pipeline/runner.ts` | `check --fast` goes to its own parser, as `review` and `receipt` do |
| M | `packages/reviewer/skill/SKILL.md` | The rule, the "Before DONE and before review" section, and R-FAST-BEFORE-REVIEW in the owned-rules block |
| M | `packages/reviewer/package.json` | `test` also runs `check:fast-before-review` |
| A | `scripts/check-fast-before-review.mjs` | The rule's check: `missing-rule`, `not-fast-pass`, `wrong-head` |
| A | `scripts/check-fast-before-review.test.mjs` | Its gate test (run by `check:gates`) |
| A | `scripts/rules/fixtures/R-FAST-BEFORE-REVIEW/**` (4 files) | The violation fixtures: a skill without the rule, a FAST FAIL record, a FAST PASS at another head |
| M | `scripts/rules/registry.json` | The R-FAST-BEFORE-REVIEW row, `owner_agent: reviewer`, three fixture runs |
| M | `package.json` | The `check:fast-before-review` script and its `//` note. The shared `check` step list is unchanged |
| A | `receipts/receipt-cp1fastcheck.md` | This receipt |

No version, changelog, release catalog, `retired-leaves.ts`, allowlist, baseline, gap list or scanner was edited.

## Validation

### Typecheck

```
$ npm run typecheck -w @clossys/producer    -> exit 0
$ npm run typecheck -w @clossys/reviewer    -> exit 0
```

`wt` is not installed in the sandbox, so packages were built package by package with `npm run build -w <pkg>`:
controller, director, designer, writer and publisher (producer's dependencies), then reviewer and producer. All exited 0.
`packages/designer/ui` has no build script, so npm exited 1 there, as it does on any checkout.

### Named tests (`npx vitest run src/check/fast.test.ts --reporter=verbose` in packages/producer)

```
✓ fast fails on a new related red and names the test
✓ fast passes when the only red also fails alone at base
✓ fast stops at typecheck and runs no tests
✓ fast refuses with no base
✓ slow test is listed and files one request with file-requests
✓ fast json record matches the printed verdict
✓ fast runs root node tests for a scripts-only diff
✓ fast fails a non-empty diff that ran nothing
✓ check --help documents --fast, --base, --json and --file-requests
✓ fast is incomplete past its budget and lists the files left unrun
Tests  10 passed (10)
```

These tests use no fakes. Each builds a git repository with a workspace package (a real `typecheck` script, real vitest
test files) and root `scripts/` node tests and checks. It then runs the verb, with real merge-base trees for the base
results.

### Mutations (each on `packages/producer/src/check/fast.ts`, restored from a saved copy and checked with `cmp`)

```
=== mutation: treat a base-red as new
--- replaced: if (there?.status === "fail") baseRed.push(entry);
+++ with:     if (false) baseRed.push(entry);
     × fast passes when the only red also fails alone at base
      Tests  1 failed | 9 skipped (10)
restored: cmp src/check/fast.ts against the saved copy: identical
=== mutation: skip the alone re-run
--- replaced: [alone] = await Promise.all([again.length ? runner.alone("alone", repo, again) : Promise.resolve([]), baseRun()]);
+++ with:     [alone] = await Promise.all([Promise.resolve([...failed, ...again.filter(unit => !failedIds.has(unit.id)).map(unit => related.find(item => item.unit === unit)!)]), baseRun()]);
     × fast fails on a new related red and names the test
     × fast passes when the only red also fails alone at base
      Tests  2 failed | 8 skipped (10)
restored: cmp src/check/fast.ts against the saved copy: identical
=== mutation: drop the typecheck stop
--- replaced:   if (typeRed.length) {
+++ with:       if (false) {
     × fast stops at typecheck and runs no tests
      Tests  1 failed | 9 skipped (10)
restored: cmp src/check/fast.ts against the saved copy: identical
```

### Run time on this unit's own diff

```
$ node packages/producer/dist/cli/index.js check --fast --base origin/claude/r2f-0048-cp1-factory0 --json
exit 0, wall 255 s (load average 1.40 at start)
typecheck=9.4 related=94.8 alone=149.5 | red 0 baseRed 6 noise 0 unrun 0 slow 16 commands 24 changed 17
FAST PASS 686b8daa43462edb8a743749b257d37fe16c5e8c
```

The six base-red files fail alone at head and fail alone at the merge-base, so they are not this unit's reds:
`packages/producer/src/check/ref-verbatim-default.test.ts`, `src/check/slot-resolve.test.ts`,
`src/cli/inline-gates.e2e.test.ts`, `src/pipeline/chain.test.ts`, `src/pipeline/interview.test.ts`, and
`scripts/accept-unit.test.mjs`. In this sandbox the first five fail because of an environment gap; accept-unit fails
its `lsof` case.

Each own-diff run in order, at its head:

| Head | Wall | Verdict | What changed after it |
| --- | --- | --- | --- |
| `2221ba82f` | 310 s | FAST INCOMPLETE (279 of 324 units unrun) | The full transitive tier selected 279 more producer tests, and `check:rules` ran 220 s and was still going: changed to nearest tests only, and root checks run through their gate tests |
| `e53d269bb` | 509 s | FAST PASS | The alone, base and node runs were all serial: base pipelined, node runners beside vitest, sure-slow files not re-run |
| `556b50dec` | 340 s | FAST PASS | Each base batch paid its own vitest start and build: base starts with step 3 |
| `f3304dfa4` | 325 s | FAST PASS | Tier-2 node tests ran one at a time after tier 1: one node pool beside vitest |
| `1b461eaee` | 266 s | FAST PASS | none (wiring change only next) |
| `686b8daa4` | 255 s | FAST PASS | this receipt |

### Merge with the integration branch

```
$ git merge-tree --write-tree origin/claude/r2f-int2 HEAD     (int2 at 67bb25580f7aea06038ac3d8c6c2cb74b5c42977)
8b9bc6ece6a765d531a1a2a60429e965c2707d23
merge-tree exit 0
```

On the first wiring, `check:fast-before-review` was added to the root `check` step list. That conflicted with int2,
which also changes that line (it adds `check:agents-definition`). The step now runs from `@clossys/reviewer`'s `test`.
The orphan-check tracer reaches `.#check:fast-before-review` from root `check`/`test`, and it still does when
`check:rules` fails (`reachable()`: true, true).

### The rule and its check

```
$ node scripts/check-fast-before-review.mjs                 -> check:fast-before-review: 0 finding(s), exit 0
$ node --test scripts/check-fast-before-review.test.mjs     -> # pass 5, # fail 0
$ node scripts/check-rules.mjs                              -> exit 1, 287 s
FAILS AS REQUIRED  R-FAST-BEFORE-REVIEW  .#check:fast-before-review  (exit 1, 0s)   (x3: missing-rule, not-fast-pass, wrong-head)
check:rules: 30 rules, 22 enforced by a check that fails on its fixture; failing: R-DS-ONLY, R-WRITER-COPY,
R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER
$ node packages/reviewer/dist/cli.js   -> "verdict": "satisfied", "The reviewer skill lists exactly the 3 rule(s) the registry gives it."
$ npm test -w @clossys/reviewer        -> 6 vitest tests pass, then check:fast-before-review: 0 finding(s)
```

The eight failing rules were the same set in both full runs, after the first commit and at the final head. They need
studio and e2e builds this sandbox does not have, and none of them involves a file this unit touches. `check:rules` was
not run on a base tree. No `unreachable`, `owner-list` or
`unknown-owner` finding was reported.

### Other checks over the touched files

```
check:no-hidden-fallbacks (packages/producer): 208 findings at head, 208 on a base tree of 58aceb5f5; none in a fast file
check:step-standard: exit 0          check:package-skills: 25 package skill(s) OK
check:conversation-contract: exit 0  check:loop-matrix: exit 0     check:changelog-location: exit 0   check:scope: exit 0
check:orphan-checks: 8 findings, none names a file this unit touches (not run on a base tree)
check:root-entry: red at base already ("Undeclared tracked root entries: receipts")
check:safety (partial, no denylist in the sandbox): PASS (partial)
```

## Decisions to review

1. **Nearest tests, not the full transitive set.** The related step runs, per changed file, the tests that import it
   directly. When no test does, it runs the tests at the first import depth that has one. Then come the tests that name
   a changed data file and the root `check:*` scripts that read a changed root file. The full transitive set (279 more
   producer files for a change to `pipeline/runner.ts`) did not fit the 5 min budget. That set belongs to `clossys
   review`.
2. **Root checks with a gate test run through that test.** A root `check:*` script that reads a changed root file
   runs through its sibling `*.test.mjs` when it has one. Without one, it runs as wired. The whole-repository check
   stays in root `check`. Measurement: `check:rules` took 145 s alone, and over 220 s under the related step's load
   without finishing. Its alone and base re-runs would double that.
3. **Base runs start with step 3.** The merge-base tree runs, alone, exactly the files that failed at head in the
   related step, beside the head alone run. It never runs a whole package. A file that then passes alone at head is
   load noise, and its base result is unused. A file is base-red only when it fails alone at head and alone at base.
4. **Sure-slow files are not re-run alone.** A file over 4x the slow threshold (8 s) in the related run is listed from
   that measurement and marked `in the related run ... (not re-run)` (`measured: "related"`). Borderline files are
   re-run alone, and failing files are always re-run.
5. **`--file-requests` uses the existing report queue.** Each slow test is one `clossys request --kind report --about
   agent/<owner> --what gap`. That queue keeps one open report per about and what, so a second slow test of the same
   agent returns the open report (the record's `requests` line says "already open") instead of a second entry.
6. **A dirty tracked tree is refused (exit 2).** A FAST record names a commit, so a run with uncommitted tracked
   changes would test something other than the sha it records. An empty diff is FAST FAIL: nothing checked is never a
   pass.
7. **Receipt location.** The packet names `proofs/receipt-cp1fastcheck.md`. A new root `proofs/` folder would be a
   second undeclared root entry for `check:root-entry`, and declaring it would grow an allowlist. The receipt sits in
   the existing `receipts/` folder beside the other unit receipts.
