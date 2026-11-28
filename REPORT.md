# CP1-PLANNERRUN report

Unit branch `claude/r2f-0048-cp1-plannerrun` at 642d50eb089358b320301b5687b84251e054249b, one commit on base
`claude/r2f-0048-cp1-factory0` @ 009240d0023b3d05b893d9aefe9d4bc66642f059. Receipt: `receipts/CP1-PLANNERRUN.md` (this branch).

## Where the code lives (packet: "a new module only where no engine covers it")
- Verbs: `clossys unit env|tier|run|check` in the producer CLI, `packages/producer/src/cli/unit.ts`, routed from
  `src/pipeline/runner.ts` like `review`/`receipt`. Packet reader and rules: `packages/producer/src/cli/unit-rules.ts`
  (new module beside the verb; no existing producer engine reads Tier/Env — `src/review/receipt.ts` parses only Validation commands).
- Run state and stale flag: `packages/controller/src/loop/units.ts` (new: the launch log on `LoopState.units`),
  `staleness.ts` (`unitRunStatus`, `UNIT_RUN_STALE_AFTER_MS` = 90 min), `types.ts`, `state.ts` (validates `units`),
  `index.ts` exported as `@clossys/controller/loop`.
- `@clossys/producer` now depends on `@clossys/controller` `0.10.0` (already in its install via publisher `^0.10.0`).
  The lock gains exactly that one line; `npm install --package-lock-only` would also re-flag ~27 unrelated `dev`/`libc`
  entries on this npm (10.9.9) with or without the change, so only the producer line was applied (same line npm writes).
- Tier table as data: `packages/planner/skill/SKILL.md`, between `<!-- unit-tiers:start ... -->` / `<!-- unit-tiers:end -->`
  (no D5 needed). Rules R-UNIT-ENV and R-UNIT-TIER, `owner_agent: planner`, listed in the skill's owned-rules block.
- Check: root `check:unit-packets` (in root `check`, after `check:review-doc`) runs `clossys unit check` over
  `packages/planner/test-fixtures/unit-packets/` (4 accepted packets); fixtures `scripts/rules/fixtures/R-UNIT-ENV|R-UNIT-TIER`.
- State default: `<root>/clossys/.state/planner/loop.json`, gitignored (`/clossys/.state/planner/`).

## Assumptions the planner should confirm
- Local launch line is `wt lease <branch> [--base <base>] --profile program-<tier>`; `wt` syntax is not in this repo.
- Cloud command printed is `claude --cloud "$(cat '<prompt file>')"`.
- "Base not on the remote" reads remote-tracking refs as last fetched (no network); a packet with no `Base:` line skips it.
- Failed cloud launches are recorded with `clossys unit run <packet> --mark-failed "<reason>"`.

## Files touched
- .gitignore, package.json, package-lock.json
- packages/controller/package.json, src/loop/{index.ts,units.ts,units.test.ts,staleness.ts,state.ts,types.ts}
- packages/planner/skill/SKILL.md, packages/planner/test-fixtures/unit-packets/{cloud-mid,gate-high,local-fold,low}.md
- packages/producer/package.json, src/cli/{unit.ts,unit-rules.ts,unit.test.ts}, src/pipeline/runner.ts
- scripts/rules/registry.json, scripts/rules/fixtures/R-UNIT-ENV/local-without-need.md, scripts/rules/fixtures/R-UNIT-TIER/below-floor.md

## Commands and exit codes
| command | exit | time |
| --- | --- | --- |
| preflight: `git remote get-url origin` (clossys/foundry) | 0 | |
| preflight: `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-factory0` (unit branch new, absent on remote: expected) | 0 | |
| preflight: `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-plannerrun` | 0 | |
| preflight: `node -v` (v22.23.5), `npm -v` (10.9.9), `npm ci` | 0 | 24s |
| `npm run agent:cloud:bootstrap`, `npm run agent:cloud:check` | 0, 0 | |
| `npm run build -w @clossys/controller` / director / designer / writer / publisher / producer | 0 each | 4s/2s/28s/6s/664s/21s |
| `npm run typecheck -w @clossys/planner` | 0 | |
| `npm run typecheck -w @clossys/producer` | 0 | 9s |
| `npm run typecheck -w @clossys/controller` | 0 | |
| `npx vitest run src/cli/unit.test.ts` (producer) | 0 (13/13) | 12s |
| `npx vitest run src/loop` (controller) | 0 (115/115) | 4s |
| `npm run check:unit-packets` | 0 (4 packets, 0 refused) | |
| `clossys unit check scripts/rules/fixtures/R-UNIT-ENV` / `R-UNIT-TIER` | 1 / 1 (refused, rule named) | |
| check-rules subset (shapeFindings, floorFindings, ownerFindings, reachability, fixture relation) | 0 findings | |
| check:workspace-links, lock-workspace-versions, first-wave-sequence, package-skills, loop-matrix, conversation-contract, evals, package-conformance, package-framework, agents-definition, import-purity, capability-maps, package-evidence, installed-positions, readme, changelog-location, conflict-markers | 0 each | |
| `npm run check:orphan-checks` | 1 (base 1: same 8 findings) | 1s |
| `npm run check:gates` | 1 (base 1; head reds 42 ⊂ base reds 55) | 493s |
| `npm run check:safety` (PARTIAL: no denylist in cloud) | 0 | |
| `npm run check:foreign-references` | 2 (base 2, same message) | |
| controller full `npx vitest run` | 1 (4 red, all 4 red on base) | 195s |
| producer `npx vitest run src/cli src/pipeline src/review` | 1 (46 red; base 45) | 331s |
| `npx vitest run src/pipeline/wiring.test.ts` (the one extra red, isolated) | 0 (16/16) | |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 | |
| `git push -u origin claude/r2f-0048-cp1-plannerrun` | 0 | |

## Named tests (packages/producer/src/cli/unit.test.ts, plus controller src/loop/units.test.ts)
- env is cloud for a self-contained foundry packet — pass
- env refuses local with no detected need — pass
- env is local when the write set leaves the repo — pass
- tier refuses a packet below the computed floor — pass
- run cloud dry-run prints a self-sufficient prompt with preflight and no local paths — pass
- run flags a launch with no progress after 90 min as stale — pass (also in controller: "flags a launch with no pushed progress after 90 minutes as stale")

## Mutations (each restored from a copy, `cmp` clean, suite 13/13 after)
| mutation in unit-rules.ts | failing test |
| --- | --- |
| local default (`env: "cloud"` -> `env: "local"` in the no-need return) | env is cloud for a self-contained foundry packet |
| drop tier floor (`indexOf(declared) < indexOf(floor)` -> `< 0`; a first `false &&` form failed the setup build's type-check, so it was replaced) | tier refuses a packet below the computed floor |
| drop the preflight block from cloudPrompt | run cloud dry-run prints a self-sufficient prompt with preflight and no local paths |

## Related tests: new red vs base red
- New red: none. `src/pipeline/wiring.test.ts > status citations > runs the citation check through the pipeline verb` was red once in the
  parallel head run only, and passes 16/16 run alone (load timing).
- Base red (unchanged, sandbox): controller completion-evidence (advisor not built), pack-round-trip x3 and preflight (npm install
  timeouts); producer 45 cli/pipeline tests on the consumer store; 42 check:gates subtests; 8 orphan findings.
- Not verified here: controller's pack round trip with the new `./loop` export (base-red in this sandbox). `import('@clossys/controller/loop')` resolves in the workspace.

## After the fold (planner)
Launch later units with `clossys unit run <packet>`; retire `brief.py --env` and the hand-written cloud prompts with a log line.
Not in scope here: full `check:rules` (every fixture run) and the FULL-mode safety gate (no denylist in cloud).

DONE: 642d50eb089358b320301b5687b84251e054249b
model: claude-opus-5-5
