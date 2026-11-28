# REPORT: carry CP1-AGENTLIST2 and CP1-AGENTLADDER onto int2 + factory0

Executor: cloud session, working in a fresh clone of clossys/foundry. Builds were package-scoped only (`npm run build -w <pkg>`).
No root build, no publish, no PR, no merge to a shared branch. Every push was a fast-forward.

## Tips

| branch | base | pushed tip |
|---|---|---|
| claude/r2f-0048-cp1-agentlist | c0c32cdecd84ecfd68f30e5f7355688b407074bd | 61efaaed366e1763df3ce37f1e6e61c2a3404b83 |
| claude/r2f-0048-cp1-agentladder | e90c83284af9cb7706680bfae521602cf47ff47f | e5ca41bd79e56dfff4eb6c3c809e19b0dd7f439f |

## Deviation from the brief: the int2 sha

The brief names `claude/r2f-int2 at e8deb2e739`. That object exists in no ref of origin, even after `git fetch --unshallow origin`:
`git rev-parse e8deb2e739` printed "unknown revision", and `git rev-list --all | grep ^e8deb` found nothing.
The remote int2 tip at fetch time was `25fe2a0e6e1207ebd23221f768d1f965e6f6c138` ("Fold CP1-CHECKS 2feb7b9803 into claude/r2f-int2").
I merged that tip. factory0 (`009240d0`) is not in it: `git log int2..factory0` lists 10 commits.
If e8deb2e739 is a later int2 fold that was never pushed, a further merge of it into both branches is still a fast-forward-able carry.

## Step 1: claude/r2f-0048-cp1-agentlist (first-parent commits on c0c32cd)

- `f0580c95a` merges origin/claude/r2f-int2 (25fe2a0e6). There were no conflicts.
- `8e2492ead` merges origin/claude/r2f-0048-cp1-factory0 (009240d0). It had two conflicts, resolved by intent:
  - `scripts/check-rules.mjs`:
    - `owner_agent` is now required on every rule (factory0's rule). The registry schema already required it, and all 30 registry rows carry one.
    - `FACTORY_HOMES` is `planner, developer, reviewer, controller`: factory0's three factory homes plus agentlist's Controller.
  - `scripts/check-rules.test.mjs`:
    - Kept factory0's two owner tests and its per-home owned-rules test, including the extra `R-THREE` mutation case.
    - Kept agentlist's "Controller's skill lists exactly the agent-standard rules it owns" test, which still asserts R-AGENTS-DEFINITION is Controller's.
- `61efaaed3` regenerates the agents.json generated copies with their verb, `node scripts/check-agents-definition.mjs --write`. This touched 4 files: advisor/src, controller/src, producer/src and producer/scripts `agent-lists.generated.*`.

### CP1-AGENTLIST2 Validation at 61efaaed3

| command | exit |
|---|---|
| `node scripts/check-agent-lists.mjs` | 1: the script does not exist at this tip. It arrives with agentlist2 (0cdf23cb9), which is stacked in agentladder; see step 2, where it exits 0 |
| `npm run typecheck -w @clossys/controller` | 0 |
| `npm run typecheck -w @clossys/producer` | 0, after the package-scoped builds below. The first attempt exited 2 because sibling dists were missing (TS2307) |
| `node --test scripts/check-agents-definition.test.mjs` | 0 (15 pass) |
| `node --test scripts/check-rules.test.mjs` | 0 (12 pass) |
| `npx vitest run src/positions`, run in packages/controller (the files factory0 touched) | 0 (30 pass) |
| `npm run check:agents-definition` | 1 before regeneration (generated-copy drift), 0 after |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 |

Builds at this tip: writer 0, director 0, designer 0, controller 0, publisher 0.
Writer and publisher were first run out of dependency order and exited 2, then 0 after director and controller were built.

## Step 2: claude/r2f-0048-cp1-agentladder (first-parent commits on e90c832)

- `7a165a3ff` merges claude/r2f-0048-cp1-agentlist (61efaaed3). One conflict, `docs/contracts/agents.json`, resolved by intent:
  - It keeps the factory rows that agentlist carries (developer, planner, reviewer, class `factory`).
  - It drops the declared `"rung": null` field, which the ladder retired: rungs are computed only.
- `21c3b8452` regenerates the agents.json copies with `node scripts/check-agents-definition.mjs --write` (9 files).
- `1ebdd199c` fixes the one thing the merge broke. factory0's `FACTORY_HOMES` was a written-out agent list, which `check:agent-lists` refuses:
  - Finding: `agent-list scripts/check-rules.mjs:109`. It also failed agent-lists tests 1 and 3.
  - `FACTORY_HOMES` now reads a new named list, `rule-homes`, through `scripts/lib/agent-lists.mjs`. Members and order are unchanged: planner, developer, reviewer, controller.
  - The copies were re-rendered by `--write`. No check, allowlist, baseline or scanner was changed.
- `e5ca41bd7` regenerates `docs/contracts/agents.rungs.json` and `packages/producer/src/agent-rungs.generated.ts` with their verb, `node packages/producer/dist/cli/index.js agents check`. The diff only adds the three factory rows, each at rung `conforming` and missing a retained qualification record. Every other agent's rung is byte-identical to base.

### CP1-AGENTLADDER and CP1-AGENTLIST2 Validation at e5ca41bd7

| command | exit |
|---|---|
| `node scripts/check-agent-ladder.mjs` | 0 |
| `npm run check:agent-ladder` | 0 |
| `node scripts/check-agent-lists.mjs` | 0 (4123 source files, 0 findings) |
| `npm run check:agent-lists` | 0 (5 pass) |
| `npm run check:agents-definition` | 0 (15 pass, 0 findings) |
| `npm run check:agent-rung:conforming` | 0 |
| `npm run check:agent-rung:qualified` | 0 |
| `npm run check:agent-rung:packed` | 0 |
| `npm run check:agent-rung:looped` | 0 |
| `npm run typecheck -w @clossys/controller` | 0 |
| `npm run typecheck -w @clossys/producer` | 0 |
| `node packages/producer/dist/cli/index.js agents check` (the verb's real bin) | 1, as Amendment 3 expects; shortfalls below |
| `agents check --file-requests --root <copy of producer test-fixtures/consumer>`, run 1 | 1: "filed 7 request(s): advisor, controller, designer, director, producer, publisher, writer; 0 already open" |
| the same command, run 2 | 1: "filed 0 request(s); 7 already open" |
| `npx vitest run src/cli/agents.test.ts`, run in packages/producer | 0 (4 pass) |
| `npx vitest run src/positions`, run in packages/controller | 0 (30 pass) |
| `node --test` on check-rules, check-agents-definition, agent-ladder and check-agent-lists tests | 0 (38 pass) |
| `node --test packages/<p>/recipes/recipes.test.mjs` for designer, producer and writer | 0 / 0 / 0 |
| `node --test packages/director/recipes/recipes.test.mjs` | 1: the same names fail on base (below) |
| `node --test packages/publisher/recipes/recipes.test.mjs` | 1: the same names fail on base (below) |
| `npm run check:conflict-markers` | 0 |
| `npm run check:safety` | 0, PARTIAL mode: cloud sessions hold no denylist, so this is not a FULL clearance |
| `npm run agent:cloud:bootstrap` then `npm run agent:cloud:check` | 0 / 0 (check exited 1 before bootstrap) |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 |
| root `npm run check` | not attempted: it runs root `build`, which this brief forbids (package-scoped builds only). Every rung check in it was run individually, above |

Builds at this tip:
- director 0, writer 0, controller 0, designer 0, publisher 0, producer 0.
- controller and producer were rebuilt (0 / 0) after 1ebdd199c changed their generated copies.

### agents check shortfalls at HEAD (the same 7 as on base e90c832: `agents check --dry --repo <base>` exits 1 with 7 shortfalls)

| agent (owner) | rung | missing at next rung |
|---|---|---|
| advisor (advisor) | declared | conforming: manifestBlock partial; outputEnvelope, loopSection, layout and capabilityMap absent; required intake/outputs/status/fit/solves/needs/feeds/capabilities absent |
| controller (controller) | declared | conforming: manifestBlock partial; loopSection, layout and capabilityMap absent; required intake/outputs/status/fit/solves/needs/feeds/capabilities absent |
| designer (designer) | declared | conforming: manifestBlock partial; outputEnvelope and loopSection absent; required intake/status absent |
| director (director) | declared | conforming: manifestBlock partial; outputEnvelope and loopSection absent; required intake/status absent; solves-proof-case-missing |
| producer (producer) | conforming | qualified: no retained release-qualification record for @clossys/producer@0.1.0 |
| publisher (publisher) | declared | conforming: manifestBlock partial; outputEnvelope and loopSection absent; required intake/status absent |
| writer (writer) | declared | conforming: manifestBlock partial; outputEnvelope and loopSection absent; required intake/status absent |

- Install list: controller, director, designer, writer, publisher, producer, advisor. Computed at packed or higher: none.
- The merge surfaced no new shortfall. The three new factory agents (developer, planner, reviewer) are not install agents, so they do not fail `agents check`.
- The requests above were filed only into a scratch copy of the consumer fixture, not into any real workspace. Filing them for real is `clossys request` work on an owner machine.

## Related tests: new-red and base-red

- New red (fails at the merged tip but passes on base): **none**.
- Base red, failing identically at e90c832:
  - Base run: a worktree with base producer's `dist/records` built by tsc. The base producer build itself exited 1 at a later designer-dist step.
  - packages/director/recipes/recipes.test.mjs: "passes a brief listing every requirement and pinned input, and three distinct Director-derived directions"; "fails a brief missing a requirement or an input, a stale sha, a path, the wrong recipe (mutation)".
  - packages/publisher/recipes/recipes.test.mjs: "passes a page brief from its pinned frame and sections, and three directions that each name the one frame"; "fails a brief missing the frame, listing an input the slot does not name, a stale sha, the wrong standard (mutation)"; "a publication's directions order the slot's own pinned pages".
- Not compared like for like: `node scripts/check-rules.mjs` exited 1 at the agentlist tip, with fixture-run findings that depend on built dists. My base run of it was taken while dists were still building, so its counts are not comparable. It is not a Validation line of either packet; I record it unattributed.
- packages/controller/src/scaffold.test.ts: listed in the ladder diff, but it does not exist at either tip (the ladder removed it). Not run.

## Files touched by this carry (outside the two merges' own content)

- scripts/check-rules.mjs, scripts/check-rules.test.mjs (conflict resolution, then the named-list read)
- docs/contracts/agents.json (conflict resolution, plus the `rule-homes` list)
- docs/contracts/agents.rungs.json and packages/producer/src/agent-rungs.generated.ts (generated by `agents check`)
- `agent-lists.generated.*`, generated by `check-agents-definition --write`, in:
  - packages/advisor/src, packages/controller/src
  - packages/designer/{recipes,scripts,src}
  - packages/director/{recipes,src/cell-format}
  - packages/producer/{recipes,scripts,src}
  - packages/publisher/{recipes,src}
  - packages/writer/recipes

Out of scope, by this brief: product-repo migrations (none were needed), receipts under proofs/, and real `clossys request` filing.

## Timings (wall clock)

- `npm ci`: 23s.
- Package builds: publisher about 10m50s each time; designer 25-31s; producer about 20s; writer, director and controller under 7s each.
- Producer typecheck: 10s. `check:agent-lists`: 14s. `agents check`: 4s.

DONE: e5ca41bd79e56dfff4eb6c3c809e19b0dd7f439f
model: claude-opus-5-5
