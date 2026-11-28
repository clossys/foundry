# CP1-LOOP-LEARN report

Unit branch: `claude/r2f-0048-cp1-loop-learn` at `0d05ebb8f6b529a243fcabfd74223f83538aad90` (one commit on
`claude/r2f-int2` at `25fe2a0e6e1207ebd23221f768d1f965e6f6c138`). Cloud session: no denylist, so the safety gate ran
in PARTIAL mode only; this is not a FULL clearance. Nothing was published, no PR, no version/changelog/catalog edit.

## What changed (objective a-f)

- **(a) Signature.** `reportSignature(text)` (exported, `packages/producer/src/records/report-shape.ts`): times/dates,
  paths, shas (7-64 hex with a digit and a letter) and numbers become `<time>`, `<path>`, `<sha>`, `<n>`; whitespace
  collapses, case folds, max 400 chars; undefined when nothing but variable parts remains. Stored as
  `evidence.signature`. Signed from: a `clossys check` evidence's output (automatic), `--signature <failure text>` (new
  CLI flag), and a loop step's failure text (`fileStepReport`). Dedupe key = about + what + signature
  (`sameReportKey`); an unsigned report keeps the about + what key (it only matches other unsigned reports).
- **(b) Repeat.** A new signed report with no open match that matches a closed `fixed` report (latest by closedAt) is
  filed with `repeatOf: { report, guard }` and a Producer `repeat` event; `clossys request --kind report ...` exits 1
  with `REPEAT ...`. `--list --json` adds `repeat: true|false` on every report (repeatOf carries the linked ids).
  An unsigned report is never a repeat (the packet's concern: about + what alone would flag every new bug of a verb).
- **(c) Guard.** A fixed close needs `--guard R-<id>`: a rule in `<root>/scripts/rules/registry.json` with at least
  one `fixture_runs` entry, checked before any check re-run, with or without a recorded check. Refusals name the rule
  (`has no rule R-X`, `rule R-X ... has no fixture_runs entry`, `no scripts/rules/registry.json in this root`, bad id
  shape). The closed report stores `guard`; the closed event detail names it. `--guard` on a non-fixed close is
  refused. Consequence: `--recheck` (loop.audit's reports step) no longer closes passing reports (it could not name a
  guard); it returns `{ passing, open, unchecked, invalid }` and writes nothing. The loop.audit step's `does` text and
  the Producer skill say so.
- **(d) Decline.** `--by producer --outcome declined` is refused unless `--result queue.report#<id>` (a duplicate);
  the owner's declines are unchanged.
- **(e) Bare root.** Filing, listing and closing work in a root holding only `clossys/clossys.config.ts` (and the
  registry for a guarded close); covered by a named test. No code change was needed for it.
- **(f) Rule and skill.** `R-REPORT-GUARD` in `scripts/rules/registry.json`, check `.#check:report-guards`
  (`scripts/check-report-guards.mjs`, files only, wired into root `check` after `check:decisions`), two fixture runs
  on `scripts/rules/fixtures/R-REPORT-GUARD` (findings `unguarded-fixed` and `repeat-open`; the check also has
  `guard-unknown`, `guard-no-fixture`, `repeat-unlinked`, `unreadable`). RULE_FLOOR raised with
  `"R-REPORT-GUARD": { ".#check:report-guards": 2 }`. Producer `skill/SKILL.md` Upstream feedback section states
  "No fixed close without a guard; a repeat after a fixed close fails."

Stored format (D5 check): additive only — optional `evidence.signature`, optional top-level `guard` and `repeatOf`,
event op `repeat` in `queue-entry-2.json` and `RequestOp`. `reportIssues` does not require a guard on old fixed
closes, so every existing record stays valid. Not BLOCKED-D5.

Fixture provenance: the three entries were written by the built `clossys request` CLI in a scratch root (file, close
fixed with guard, file again -> REPEAT; file and close another). One close then had `guard` (and the "; guard ..."
in its closed-event detail) removed, standing for a fixed close from before guards existed: the violation the
current verb can no longer write.

## Files touched

- `package.json` (root: `check:report-guards` script + comment, added to the `check` step list)
- `packages/producer/loops/loop.audit/audit-v1.json` (reports step `does` text)
- `packages/producer/schemas/queue-entry-2.json`
- `packages/producer/skill/SKILL.md`
- `packages/producer/src/cli/request.ts`
- `packages/producer/src/cli/request.test.ts`
- `packages/producer/src/records/report-shape.ts`
- `packages/producer/src/records/report.ts`
- `packages/producer/src/records/types.ts`
- `scripts/check-report-guards.mjs` (new)
- `scripts/check-report-guards.test.mjs` (new)
- `scripts/check-rules.mjs` (RULE_FLOOR entry only)
- `scripts/rules/registry.json` (R-REPORT-GUARD row)
- `scripts/rules/fixtures/R-REPORT-GUARD/` (new: three report entries and the fixture root's own registry)

## Commands and exit codes

Preflight:
- `git remote get-url origin` -> clossys/foundry, 0
- `git fetch origin claude/r2f-int2` 0 (`origin/claude/r2f-int2` = 25fe2a0e6e...); unit branch did not exist yet (fetch of it: "couldn't find remote ref", expected for a new branch)
- `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-loop-learn` 0
- `node -v` v22.23.5, `npm -v` 10.9.9, `npm ci` 0 (18s)

Builds (package-scoped):
- `npm run build -w @clossys/producer` first try 2 (deps not built: missing @clossys/director, @clossys/publisher types)
- `npm run build -w` director 0 (2s), designer 0 (21s), writer 0 (4s), controller 0 (3s), publisher 0 (525s);
  `@clossys/designer-ui` 1 ("Missing script: build"; it has none, not needed)
- `npm run build -w @clossys/producer` 0 (18s), after all source edits; wrote no tracked file

Validation:
- `npm run typecheck -w @clossys/producer` 0 (10s)
- `npx vitest run src/cli/request.test.ts` 0: 15/15 (28s), including the seven named tests:
  "signature strips paths, shas, times and numbers"; "a report matching a fixed-closed report with the same signature
  is REPEAT and exits 1"; "a different signature on the same topic is a new report, not REPEAT"; "fixed close without a
  guard is refused"; "fixed close with an unknown or fixture-less guard is refused"; "producer decline is refused
  unless it names a duplicate"; "reports file, list and close in a root with no content slots"
- `node --test scripts/check-report-guards.test.mjs` 0: 7/7
- `node scripts/check-report-guards.mjs --root scripts/rules/fixtures/R-REPORT-GUARD` 1 (2 findings, as required);
  `node scripts/check-report-guards.mjs` 0 (0 reports)
- `node scripts/check-rules.mjs` 1 (282s). R-REPORT-GUARD: both fixture runs "FAILS AS REQUIRED". The exit 1 is
  base-red: head has 16 findings, base 20 (`node scripts/check-rules.mjs` in a base worktree, 1, 262s); head's
  finding list equals base's minus four R-SHADCN-STOCK lines (base worktree lacked a designer build). Failing rules on
  both: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION,
  R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER; 2 unmapped checks (designer page-dogfood --freshness,
  ref-verbatim/flavor.test.mjs). So the packet's "check-rules exit 0" is not reachable from this base; no new finding.
- `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` 0 (tree 978a888b3ed7...)

Mutations (each applied to `src/records/report.ts`, the named test run with `vitest run src/cli/request.test.ts -t`,
then restored from a copy and checked with `cmp`, all cmp 0):
1. dedupe on open reports only (`fixedMatch(reports.filter(open))`): vitest 1, "... is REPEAT and exits 1" fails.
2. allow a fixed close without a guard (`if (outcome === "fixed" && guard !== undefined)`): vitest 1, "fixed close
   without a guard is refused" fails. (A first attempt, `&& false`, did not compile; replaced, not counted.)
3. flag REPEAT on a different signature (fixedMatch on about + what only): vitest 1, "a different signature on the
   same topic is a new report, not REPEAT" fails.

Related repo gates, head vs base:
- `npm run -s check:package-skills` 0, `check:loop-matrix` 0, `check:conversation-contract` 0, `check:safety` 0
  (PARTIAL: no denylist in cloud)
- `node packages/producer/scripts/check-pipeline.mjs` head 1 / base 1, identical FAIL lines (graph.stale,
  seat.invalid queue.change/queue.slot); `npm run -s check:pipeline` head 1 (592s, node --test part 4 fail)
- `npm run -s check:foreign-references` head 2 / base 2, identical output
- `npm run -s check:contamination` head 1 / base 1, identical output (modulo root path)
- `node scripts/check-orphan-checks.mjs` head 1 / base 1, the same 8 findings, none for the new files

## Related tests: new-red / base-red

Run: `npx vitest run` over 17 files (e2e, cp1-help, init-skills, loop, request, skill-commands, conform, conform
producer, pin-gate, adopt-dependencies, flows, loop-steps, chain, schema, publisher-skill-example, records, agents),
head 1 (91s, 14 failed / 493 passed), base worktree 1 (104s, 14 failed).

- new-red: none (failing test sets identical by name)
- base-red (14): pin-gate.test.ts x7 (CHOOSE gate pin tests and candidates.certified exit); conform.test.ts
  "upstream-pinned on a model read from disk ..."; flows.test.ts x4 (loop.create certify x2, loop.scope x2);
  chain.test.ts "opens the ia step on a fresh workspace ..."; schema.test.ts "clossys.queue-entry/2: the type's keys
  equal the schema's properties" (already red at base: about/what/evidence are schema properties SlotRequest's key
  list lacks; this unit adds guard/repeatOf to the schema the same way and does not fix that pre-existing gap)

## Timings

npm ci 18s; dependency builds ~9.5 min (publisher 525s); producer build 18s; typecheck 10s; request.test.ts 22-28s;
related suite 91s head / 104s base; check:rules 282s head / 262s base; check:pipeline 592s.

## Follow-ups (not done: out of scope)

- The loop.audit reports step still declares `writes: producer/queue.report/entries/`; the recheck now writes nothing.
- The base-red schema key-list gap above, and the base-red check:rules rules, are pre-existing.

DONE: 0d05ebb8f6b529a243fcabfd74223f83538aad90
model: claude-opus-5-5
