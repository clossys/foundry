# Reflect: producer (engine and `clossys` CLI)

- Base: `5a2e197ea` (branch `claude/r2f-int2`). This is a read-only reflection: no source file changed.
- Serving model: `claude-opus-5-5` (session `last_served_model`).
- Scope: `packages/producer`, which covers init, config, next, answer, run and loops, queue, gaps, conform, check, e2e and the pack scripts.

## How this was measured

- I packed the seven packages in build order and installed the tarballs into an empty git repo (`npm i ./pk/*.tgz`).
- From that repo I drove the documented flow, using only `npx --no-install clossys`.
- I ran `conform --all --json` in the Foundry repo. Its counts match the 925ae7f census: 152 cells, 54 red, of which Producer has P1, P3 and P4.
- "Fresh consumer" below means that install.

Answer in one line: the engine is not yet a sound base for nine agents. The deterministic core is real, but a fresh consumer cannot get past the first owner round, and both the agent set and the loop set are closed by hardcoded code.

## 1. What exists and works

- **Run records and dispatch.** One dispatcher selects a declared step, and each traced step appends a run record holding hashes of what it read and wrote (`src/pipeline/runner.ts:97-138`, `trace.ts`). `clossys run --dry` uses these records to compute stale versus fresh steps (`src/pipeline/chain.ts`).
  - On a fresh consumer `run --dry` takes 0.9 s, uses no model, and stops at the first open decide step with a clear `ask` line.
- **Fresh install.** `config --init` and then `init` on a fresh consumer:
  - places 7 agent skills and the `AGENTS.md` views pointer;
  - seats 6 admin Publisher slots;
  - adopts the Director IA (55 slots);
  - raises 10 Designer `queue.slot` requests;
  - pins 10 loops.

  A second run is a no-op (`src/cli/init.ts:98-131`).
- **Packets.** `next --json` prints a real packet. `skill.file` resolves inside `node_modules` with a sha256, so the packet's skill pointer does work in a consumer.
- **Owner rounds.** `next --owner --agent <id> --json` returns at most 4 questions per round. Each option is runnable argv, with the recommended option first (`src/pipeline/interview.ts`).
  - On a fresh consumer the seat policy, IA adopt, `rule --init` and `owner-decision init` options all ran and recorded.
- **Queue answers.** `answer` closes one queue entry. It refuses with no write when the `--via` or `--quote` rule fails (`src/cli/answer.ts`, `src/queue/answer.ts`).
- **Loop engine.** Code steps run in-process with no model (`src/loop/cli.ts:149-185`). `--resume` binds to the waiting run and step. Six exit checks (`pins.resolve`, `candidates.certified`, `release.ready`, and three more) are computed from files, not taken from `--step-exit` (`src/loop/runner.ts:547-551`).
- **Real e2e.** `check --e2e` does a real `npm pack` of a six-package cohort, installs it into a temp git repo, and drives `e2e/scenario.json` only through the installed bin (`src/check/e2e.ts:1-52`).

## 2. Gaps

### P0: a consumer cannot finish the flow

**P0-1. Owner decisions cite a queue entry that no shipped verb creates.**
- Evidence:
  - In the fresh consumer's first producer round, every seat, pin and not-needed option ends with `--decided-by <queue-answer>` or `--by <queue-answer>` (`src/pipeline/chain.ts:340,345,367,370`). The fill text is "the queue entry holding the owner's answer to this question".
  - No such entry exists. `request --list --open` shows only the 10 `queue.slot` entries.
  - `seat ia ... --decided-by owner` gets: "--decided-by must be owner:queue.<kind>#<id> ... or planner".
  - `pin <slot> <c>` gets "pin refused: --by owner names no queue answer", even though `pin --help` says "--by ... (default owner)".
  - The only writer of such an entry is `ownerEntry` (`src/pipeline/owner-entry.ts`). It is called only by the `owner.wiring` scratch check (`src/pipeline/owner-wiring.ts:77-82`), by conform dogfood (`src/conform/dogfood.ts:174,212`) and by tests.
- Why it matters: the Interview's core loop (gaps, then rounds, then record through the verbs) cannot record a single seat or owner pin. The owner's chat answer has no path into a record, so 23 seats and every owner pin stay open forever.
- Minimum fix: when a round is asked, `next --owner` (or `answer`) writes the typed `queue.pick` or `queue.approve` entry for each question. The option argv then names that real id instead of the `<queue-answer>` placeholder. The alternative is a `clossys answer --decision <about> <option> --via chat --quote` verb that writes the entry and returns its ref.
- Size: M. Pure code.

**P0-2. `owner.wiring` hides P0-1.** It fabricates the owner entry on its scratch copy before running each option (`owner-wiring.ts:64-82`), so an option that is dead for every real consumer reads as live. This is listed here because it is why P0-1 shipped.
- Minimum fix: run the options exactly as emitted. A `<queue-answer>` fill should be resolved only through the verb that P0-1 adds.
- Size: S. Code.

**P0-3. `init` followed by the recommended IA adopt leaves a tree that `loop.fill --init` refuses.**
- Evidence: on the fresh consumer, `init`, then `ia designer --adopt` and `ia writer --adopt` (option `a` of round `ia:2`), then `clossys run loop.fill --init` exits 1 with:
  > init stopped at ia-sync (exit 1): ia.orphans: designer/sections.candidate-preview no consumedBy path ends at a publication in publisher/ia.json; ... (+8 more)
- The orphans are the admin units that `init`'s own admin seating raised requests for (`src/cli/init-admin.ts`).
- `clossys pipeline check` on the same tree exits 1 with 3 findings:
  - `owner.policy: publisher: pin.publisher:6 ... no reason`;
  - two dead admin pin options, refused by guard R02.2 because the upstream is unpinned.
- Why it matters: the documented first loop goes red on a tree that only verbs have touched.
- Minimum fix: either `init` places admin units with `consumedBy` reaching `publication.admin`, or `ia.orphans` exempts units that have an open `queue.slot` request. Also add the sequence `init` → adopt → `loop.fill --init` to the e2e scenario.
- Size: S–M. Code.

**P0-4. `init` on an empty repo fails without naming the fix.**
- Evidence: `clossys init` in a new repo prints "Root not found: expected clossys/clossys.config.ts in this directory or an ancestor". `init` calls `discoverRoot` (`src/cli/init.ts:83`), and only `config --init` creates the marker (`src/cli/owner.ts:1007-1031`).
- Neither SKILL.md nor the `init` usage says to run `config --init` first.
- Why it matters: the first command a low-tier model tries fails, and the message gives no next step.
- Minimum fix: `init` writes the default config when it is missing (it is `export default {}`), or the error names `clossys config --init`.
- Size: S. Code.

**P0-5. The packed e2e gate is red, and CI never runs it.**
- Evidence: census step `craft.frame.submit` is refused with "recipe create.frame crafts composition candidates; this one's meta.source.kind is derived".
- `check --e2e` is reachable only through root `npm run check`, which no workflow runs. CI runs only the vitest suite, the packed-consumer `--help` launch, and the publish typecheck and test.
- `src/check/e2e.test.ts:132-145` (the part CI does run) stubs the installed bin and writes the HTML it then asserts.
- Minimum fix: fix the scenario fixture's `meta.source.kind`, then add a CI job running `npm run check:e2e -w @clossys/producer`.
- Size: S. Code and data.

### P1: wrong or unreliable result

**P1-1. The agent set is closed by hardcoded code.** A Developer, Planner, Reviewer, Advisor or Controller agent needs edits in more than 25 places. Examples:
- `CONTENT_AGENTS` (`src/records/request.ts:46`), `SEAT_AGENTS` (`records/seat-owner.ts:19`), `TARGET_AGENTS` (`records/candidate.ts:21`);
- `SLOT_AGENTS` (`records/slot-model/types.ts:16`), `CONSUMED_AGENTS` (`slot-model/consumed.ts:30`);
- `INTERVIEW_AGENTS` (`pipeline/chain.ts:176`), `LIVE_AGENTS` and `CHAIN_ORDER` (`src/loop/names.ts:101-106`);
- the `agentId` enum in `schemas/loop-version.json`;
- per-agent branches across `interview.ts:187-844`;
- one copy-pasted step per agent in `loops/loop.scope` and `loops/loop.slot`.

Advisor and Controller appear in none of these lists. Producer depends on neither package; it vendors a copy of Controller's envelope (`src/generated/check-output-envelope.ts:1-4`).
- Minimum fix: one agent registry, a data file listing id, package, chain order and slot-ness. Every list above derives from it.
- Size: L. Code; the order of the factory agents needs a model or owner decision.

**P1-2. The loop engine accepts only writes under `clossys/` and a closed verb set.** A Developer that writes `src/**` cannot run.
- `SNAPSHOT_TREES = ["clossys"]` (`src/loop/agent-snapshot.ts:66`).
- `agentWriteClass` allows a new candidate, check scratch or a `queue.slot` entry, and nothing else (`src/loop/agent-loops.ts:~147`).
- `--wrote` paths resolve under `clossys/agents/` (`src/loop/runner.ts:265`).
- The verb enum is `refine-brief|create-candidates|check|pin|pick|decide` (`schemas/loop-version.json:208`).
- `LOOP_NAMES` is a closed list of 9 (`src/loop/names.ts:16`), and `TRIGGER_CODE = /^T[1-8]$/` (`names.ts:145`).
- `verifyCheck` is an if-chain on check names (`runner.ts:565-622`).
- Minimum fix:
  - make the write scope a declared field of the loop version (a list of globs);
  - make the subject kind open (slot, request, publication, task);
  - add verbs `write-code` and `review`;
  - register checks as a table, not as if-branches.
- Size: L. Code; the factory loop shape needs a model decision.

**P1-3. Check results in the loop ledger are mostly self-reported.**
- Any check not in `VERIFIED_CHECKS` is recorded as `exit === 0 ? "pass" : "fail"` from the model's `--step-exit` (`runner.ts:553`). That covers `brief.tighten-only`, `answer.quote-required`, `types.compile`, `consumer.e2e` and `refs.dangling`.
- `--model` is copied verbatim into the ledger and never compared with the seat (`runner.ts:~708`).
- Minimum fix: every declared check is computed, or recorded as `unverified`. Also refuse a `--model`/`--tier` that does not match the seat, as `next --submit` already does.
- Size: M. Code.

**P1-4. Two runs can be open on the same slot.**
- `planRun` never consults `waitingRuns` (`runner.ts:250,372-446`), and `uniqueRunId` suffixes `-2`, `-3` (`runner.ts:286`).
- So re-running `clossys run loop.fill` while a run waits opens a second run. A plain `--resume` then fails with "2 runs wait; name one with --run".
- A low-tier model re-runs commands by habit.
- Minimum fix: refuse to open a run on a subject that already has a waiting run, and print that run's id.
- Size: S. Code.

**P1-5. `loop.fill` and `loop.refine` (the primary path) get no write judgement.** The tree snapshot and undeclared-write refusal run only for `isAgentLoop`, and fill and refine are not in `AGENT_LOOPS` (`runner.ts:682,1134`; `agent-loops-ia.ts:16`).
- Minimum fix: snapshot every loop that has an agent step.
- Size: S. Code.

**P1-6. A loop's check means something different from the same CLI verb.**
- Inside a loop, `clossys check --strict` is intercepted and runs `TREE_CHECKS` (`src/loop/cli.ts:164-166`), not `check.ts:143-164`.
- loop.audit declares `constitution.strict`, which the interceptor never runs, so it is always recorded as not run.
- Built-ins are recognised by matching cli text (`runner.ts:797-831,854`).
- Minimum fix: loop steps name a check id, not a CLI string, and both paths call the same function.
- Size: M. Code.

**P1-7. Owner-facing questions are not written for an owner.**
- Fresh-consumer round output includes:
  - `"Which each of 2 items IA does this workspace start from? (designer, writer)"`, a string-replace template (`interview.ts:568`);
  - `"Decide which owner rules are rows in the registry and whether each one gates."`, which is the step skill's first line used as the question.
- The `owner-decision add` option needs `<org>/<repo>#<issue> issuecomment-<id>`, a GitHub ledger a chat-only consumer does not have.
- Minimum fix: give each step an `ownerQuestion` field in its `action.json`, and accept `chat:<date>` as an owner-words ref.
- Size: S–M. Data, plus a model decision on the wording.

**P1-8. The seat policy has no low tier.**
- Round option `a` fills only `mid=<model:mid>` and `high=<model:high>`.
- All 18 `"tier"` fields in `loops/*/*.json` are `"mid"`.
- The seat options offer mid or high only (`chain.ts:340-345`).
- This contradicts the goal that everything works at a low model tier, and nothing measures a low-tier run.
- Minimum fix: add low to the policy question, mark the deterministic-heavy steps (impact, pick confirm, evidence) `low`, and add one e2e lane at `--tier low`.
- Size: S. Data, plus a model decision on which steps.

**P1-9. Producer action skills write Foundry paths into consumers.**
- `rule --init` writes `scripts/rules/registry.json` into the consumer's own `scripts/` (`src/cli/rules-file.ts:6`).
- The skills cite checks that do not ship to consumers: `check:pipeline` (evidence, owner.decisions, seats), `check:slot-pins` (pin.*), `check:rules` (rules).
- Seat options pass `--prompt-file packages/producer/actions/ia/skill.md`, a path that exists only in Foundry.
- Minimum fix: put the rules file under `clossys/`, replace `check:*` names with `clossys check|pipeline check` verbs, and resolve the prompt file through `skill.file`.
- Size: S. Code and data.

**P1-10. Ungated default checks pass on a crash.** The record suites turn a thrown error into `status:"error", checked:0` and exit 0 outside strict mode (`src/check/record-suites.ts:201-210`), with no guard for zero records checked.
- Minimum fix: `checked === 0` or `error` fails in every mode.
- Size: S. Code.

### P2: cost, speed, polish

- **P2-1. Gap count.** Gaps go from 147 after `init` to 600 after the two recommended adopts, and `gaps` always exits 0 (`src/cli/gaps.ts:42`). The skill's "stop at 0 gaps" makes the model parse counts.
  - Fix: exit 1 when unheld gaps remain, and add a `--count` output. S, code.
- **P2-2. Two root discoverers with different rules.** `discoverRoot` needs the config file (`src/cli/root.ts:13`). `findWorkspace` accepts a config file or `clossys/agents/` (`src/cli/workspace.ts:6`).
  - Fix: use one function. S, code.
- **P2-3. The dispatch comment is false.** `src/cli/main.ts:66` says "Every command runs through the pipeline runner", yet about 20 verbs return before `dispatch` (`runner.ts:149-190`): run, next, gaps, status, conform, loop, request, answer, feedback, init, brief, preview and others. Writers among them (`answer`, `request`, `feedback`, `init`, `brief`) leave no run record, so chain freshness cannot see their writes.
  - Fix: declare them as steps, or document them as untraced readers and writers. M, code.
- **P2-4. Monolith files.**
  - `src/loop/runner.ts` 1820 lines, `src/records/slot-write.ts` 1600, `src/records/request.ts` 1553, `src/cli/owner.ts` 1495.
  - `owner.ts` holds the config, evidence, seat, rule and owner-decision verbs together.
  - Fix: split by verb. M, code.
- **P2-5. Usage dump on errors.** Every usage error prints the whole multi-screen usage after the message (`runner.ts:192`). For example, a `seat` error printed the publish usage tail. That wastes low-tier context.
  - Fix: print the first line plus `--help`. S.

## 3. Token waste and hidden judgement

Deterministic work a model does today:
- Assembling `--wrote` lists. The runner already diffs before and after snapshots (`runner.ts:682-735`), so `--wrote` only adds a way to fail.
- Assembling the `next --submit` flags (`--model --tier --basis --skill --rung`). The packet's `do:` line prints only `--submit <file>`, though the engine knows every value except the model.
- Naming `--run` when exactly one run waits on the subject.
- Composing the `<queue-answer>` ref (P0-1).
- The loop.cascade `impact` agent step writes `scratch/impact.md`, which nothing reads (`loops/loop.cascade/cascade-v1.json`). It spends tokens for no record.
- Translating "stop at 0 gaps" from text output (P2-1).

Verbs that silently embed judgement:
- `settleBrief` skips brief refinement for every trigger except T3/T5 (`runner.ts:858,898-903`).
- `triggerOf` labels any `loop.fill --from` as T4 (`runner.ts:342`).
- `checkStepExit` turns `clossys check` exit 1 into a pass when the only findings are no-pin or no-candidate on queued leaves (`runner.ts:1771-1784`).
- `settlePick` pins the single top scorecard row without the owner (`runner.ts:906-929`).
- `settleAdopt` hardcodes a Designer/shadcn policy in the engine (`runner.ts:931-967`).

Each of these is a policy that belongs in the loop version's data, where the owner can see it.

## 4. Skill text versus code

A low-tier model following these literally fails or misreads:

| Skill text | Code |
|---|---|
| `skill/SKILL.md:35` "The six Producer loops" | `loops/` holds 9; `LOOP_NAMES` has 9; `init` says "the five loops of every agent"; `init` output pinned 10 loops for 2 agents |
| SKILL.md:64 "five queues ... `queue.slot`"; :44 `queue.change` | `ENTRY_NAME` accepts `pick\|approve\|clarify\|change\|fix`, not `slot` (`names.ts:143`); conform P1/P3 red: `queue.change` is not placed and no loop fills it |
| SKILL.md:76 `clossys answer <entry>` and :163 `clossys request <id> --answer` | Two answer verbs for owner entries, with no rule for which applies |
| SKILL.md:39 "`--init` once, then `clossys run loop.fill`" | `--init` already runs `fillAll` (`loop/cli.ts:262`); on a fresh consumer it fails (P0-3) |
| SKILL.md:56-59 scope: the agents raise, "then `request --scan` files the rest" | In `scope-v1.json` the scan is step 1, before `scope-director` |
| SKILL.md:30 `publisher release` runs the release step "(default `--gates`)" | loop.release runs `--build`, `--manifest` and `--gates` explicitly |
| Interview: "run every argv in the chosen option's `calls`, exactly" | The seat and pin argv contain `<queue-answer>`, which cannot be filled (P0-1) |
| `actions/pin.*/skill.md:7` `clossys pin <agent>/<slot> <candidate-id>` | Refused without `--by owner:queue.<kind>#<id>`; `pin --help` claims `--by` defaults to owner |
| `actions/seats/skill.md:7` "Write a seat candidate `.../candidates/<step>-v<n>.json` and pin it" | SKILL.md:4 forbids hand edits; the record is written by `clossys seat`; leaf naming is `<leaf>-v<n>` (`owner.ts:1170`) |
| `actions/workspace.config/skill.md` "the settings the CLI reads" | `src/config.ts` is empty ("reserved"); the config file is a marker that nothing reads |
| `actions/rules/skill.md` `scripts/rules/registry.json`, `check:rules` | A Foundry path and a Foundry script (P1-9) |
| Six DRAFT markers in SKILL.md (:44,56,61,64,72,162) | A low-tier model cannot tell a DRAFT from a rule; DRAFT text does not belong in a shipped skill |

## 5. Missing or vacuous checks and tests

**CI coverage.**
- Root `npm run check` reaches `check:pipeline`, `check:step-standard`, `check:generated-derived`, `check:e2e`, `check:orphan-checks` and others. No workflow runs it.
- Every `scripts/*.test.mjs` and `studio/checks/*.test.*` is a `node:test` suite outside vitest's `src/**/*.test.ts` include, so none runs in CI.

**Gaps in the fresh-consumer path.**
- No test runs `init` → `next --owner` → option calls → `answer` → `run`.
- `e2e/scenario.json` starts from `config --init` and `ia --start`, and never calls `init` or `answer`.
- Advisor is packed but is not in `E2E_COHORT` (`e2e.ts:52`).

**Vacuous checks.**
- `owner.wiring` fabricates the owner entry (P0-2).
- `e2e.test.ts:132-145` stubs the bin and asserts HTML it wrote itself.

**Conform.**
- Conform is report-only, and `conform.test.ts:195` asserts every row stays `building` with an empty `enforcedFor`, so promoting a row breaks the test.
- Several conform assertions set evidence that can never be zero, or read a declaration instead of observing behaviour:
  - evidence floors: X1 constant `1` (`src/conform/assertions.ts:354`), W1 `5 + skills.length` (`:389`), L1 `1 + edges.length` (`:230`), and dogfood's `pass(rows, evidence = 1)` (`dogfood.ts:318`);
  - `ruleRow` reads a registry status string rather than running anything (`assertions.ts:43-46`).

**Loop tests.**
- `src/loop/flows.test.ts` disables the constitution guard (`guard: { rules: [] }`, :125). Its stub returns exit 0 for any verb (:160), and its pick writes the pin directly, bypassing the gate (:139-180).
- The audit test asserts `constitution.strict: "fail"`, which production never records (P1-6).
- Every agent step uses `stub-model`, so the model and tier checks are untested (P1-3).
- Only 2 of about 30 loop cli templates are run against the real CLI (`step-cli-real.test.ts:45-88`).

**Self-confirming checks.**
- `check-compile-pure.mjs:289-297` logs `SKIP` and ends clean when no distinct candidate exists.
- `check-route-parity` and `check-generated-derived` regenerate with the same generator and compare, which proves there were no hand edits, not that the output is correct.
- `check-orphan-checks.mjs` itself reports 8 orphans (`check-ia-source`, `check-slot-defaults`, `check-no-consumer-content`, `recipes.test.mjs` and others), and nothing runs it.

## 6. Simplifications (no behaviour lost)

- **`src/config.ts`** (2 lines, an empty export). Delete it, and either make `clossys.config.ts` a JSON marker or drop it and root on `clossys/` (merge with P2-2).
- **`loop.fill` and `loop.refine`.** Their steps are identical, and together they duplicate create plus choose (`names.ts:9-12` says so). Make them one loop with a trigger field.
- **Two snapshot mechanisms.** `agentsSnapshot` (size:mtime:ino, `loop/cli.ts:112`) and `treeSnapshot` (sha256, `agent-snapshot.ts:78`). Keep the sha one.
- **`--wrote`.** Remove the flag; the snapshot diff is authoritative (section 3).
- **`clossys answer` and `request --answer`.** Fold into one verb.
- **The `wroteFile` absolute-path branch** (`runner.ts:266`) cannot be reached because `SAFE_WROTE` refuses absolute paths.
- **Per-agent copies in `scope-v1.json` and `slot-v1.json`.** Make one step parameterised by agent.
- **Duplicate npm scripts.**
  - `capture:studio` and `check:studio-capture` are the same command.
  - `check:pipeline`, `check:step-standard` and `check:constitution` are defined at both the root and the package level.
- **Orphan npm scripts.** `check:ia-source`, `check:slot-defaults` and `check:no-consumer-content` have no caller. Wire them in or delete them.
- **The four `actions/pin.<agent>/skill.md` files** are byte-identical except for the agent name. Make one templated skill.

## 7. Top 5 recommended units, in order

1. **OWNER-ENTRY:** make `next --owner` (or `answer --decision`) write the typed owner queue entry for each asked question, emit its real id in the option argv, and make `owner.wiring` run options exactly as emitted (P0-1, P0-2).
2. **FRESH-FLOW-E2E:** fix the init admin orphans and the `craft.frame.submit` fixture, have `init` write the config, add the sequence `init` → owner round → `loop.fill --init` → `answer` to `e2e/scenario.json`, and run `check:e2e` in CI (P0-3, P0-4, P0-5).
3. **AGENT-REGISTRY:** replace the 25+ hardcoded agent lists and enums with one data registry that Advisor, Controller and the factory agents can join without engine edits (P1-1).
4. **LOOP-OPEN-SCOPE:** add a declared write scope, an open subject kind and a check table to loop versions, refuse a second waiting run per subject, snapshot every agent loop, and verify model and tier against the seat (P1-2 to P1-6).
5. **SKILL-TRUTH:** rewrite SKILL.md and the action skills against the code (9 loops, one answer verb, no DRAFT, no Foundry paths or `check:*` scripts, pin `--by`), add a low tier to the seat policy, and give each step an owner-facing question (P1-7, P1-8, P1-9, section 4).
