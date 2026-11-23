# Reflection: factory-agent readiness (Planner, Developer, Reviewer)

Base: `5a2e197ea` on `claude/r2f-int2`. Serving model: `claude-opus-5-5` (session `last_served_model`).
Read-only: no source file changed. Every claim below names a file:line, or a command and what it printed.
"Scratch consumer" means a fresh `git init` folder outside the checkout, driven with the built
`packages/producer/dist/cli/index.js`.

Commands run:

| command | exit |
|---|---|
| `npm ci`, then `npm run build` in advisor controller director designer writer publisher producer | 0 each |
| `node packages/producer/dist/cli/index.js conform --all --json` | 1: 152 cells, 54 red (same set as the 925ae7f census; producer P1 P3 P4) |
| scratch consumer: `clossys receipt --packet units/u1.md` (`npm test`, `clossys check --json`) | 1: `clossys` was rewritten to `node packages/producer/dist/cli/index.js`, which a consumer does not have |
| scratch consumer: `clossys review main feat` | MECHANICAL: FAIL (leak-scan, install, fixture.generator-missing, test.uncovered) |
| scratch consumer: receipt, commit the receipt, `review --packet` | FAIL `receipt.head` |
| copy of the scratch consumer at another path: `review --packet` with the receipt copied over | FAIL `receipt.packet` (absolute path differs) |
| scratch consumer: packet with no `Validation` heading: `receipt`, then `review --packet` | receipt exit 0 with 0 commands; review `receipt pass (0 packet command(s))` |
| scratch consumer: `config --init`, `run loop.fill --init` | stopped: `ia.orphans: publisher/ia.json missing` |
| same, after `ia <agent> --start` x4: `run loop.fill --init`, then `run loop.fill` | init stopped at `publisher.admin-seated`; fill exit 0 "nothing to fill" |

## 1. What exists and works

The factory agents get a lot of machinery that is general underneath, even though every contract
above it is about slots.

- **Loop machine** (`packages/producer/src/loop/runner.ts`, 1820 lines). It runs steps in order with
  code, agent and human deciders (`schemas/loop-version.json` `$defs.loopDecider`). Each step has
  `reads`, `writes`, `checks` and an `onFail` that raises a queue entry and retries; a run has `maxRounds`.
  State is resumable (`clossys/.state/runs/loops/<runId>.json`) and each run writes one ledger entry.
  The agent-step packet already carries the tier and skill, and prints a `then:` resume line
  (`src/loop/cli.ts:218-220`).
- **Write judging for agent steps**. The runner takes a tree snapshot before an agent step and compares
  it after: an unreported or undeclared write stops the run (`runner.ts:684-760`,
  `src/loop/agent-snapshot.ts`). This is the right idea for a Developer receipt, but it covers only `clossys/`.
- **Queue store**. Entry files are created exclusively and changed under a lock with atomic rename
  (`src/queue/entry.ts:1-10`). A routing table (`src/queue/routing.json`) sends work to the decider,
  a handler loop or the owner. `clossys.queue-entry/2` keeps from, assignee, target, an event ledger
  and an owner answer with `--via` and `--quote`.
- **Tier to model**. `clossys/seat-policy.json` is written by `clossys seat --policy --model <tier>=<id>`,
  and submissions are refused when the model or tier is not the seat's (`skill/SKILL.md`,
  "Answer the open decide step").
- **Mechanical review and receipt** (`src/review/*`, `docs/review.md`). The review runs in a temp
  clone of head. It checks forbidden paths, a leak scan using the merge base's script, install, build,
  typecheck, covering tests by import graph, count probes against the base, fixture drift, e2e and
  seeded mutation. It ends with `MECHANICAL: PASS|FAIL <head> <tree>`. `clossys receipt` turns a
  packet's Validation list into commands with recorded exit codes and output-tail hashes, and review
  re-runs them at head. This is the Developer's evidence and the Reviewer's mechanical half, already in code.
- **Review evidence contracts** (`packages/controller/src/review/*`, `ReviewEvidenceBundle` v3,
  `ReviewPolicy`). They are vendor-neutral and exact-head. `packages/inspector/src/review-evidence.ts`
  judges them: the latest decisive review per reviewer, a stale changes-requested never cleared by a
  push, and an empty run is indeterminate (`src/verify.ts:7-16`).
- **Engine record types** (`src/engine/types.ts:80-100`): `Attestation {gate, subject, verdict, by, at, inputs[]}`
  and `Gate {attestedBy: code|agent|owner, required}`. This is exactly the shape a blind review attestation needs.
- **Foundry-only factory scripts, not shipped**: `scripts/accept-unit.mjs` (fails on base, passes on
  head, base measured with the head's check), `scripts/land-stack.mjs` (merge train, review-tier gate,
  `foundry-review-record` PR-comment grammar, `governance/review-tiers.json`), `scripts/classify-change-tier.mjs`.
  `packages/launcher` `launcher-apply-plan verify|body|status` is a full land protocol (task record,
  hashed PR body, branch naming, proposed/applied/diverged), but only for setup change sets.

## 2. Gaps

### P0: blocks a consumer finishing request, plan, implement, check, review

**P0-1. `clossys review` cannot pass on any consumer repo.**
- Evidence: `src/review/review.ts:60` has `const config = options.config ?? FOUNDRY_CONFIG`.
  `src/review/config.ts:66-103` hard-codes `packages/producer/test-fixtures/consumer`, the
  `seed-pinned-world.mjs` generator, `check:safety` and `npm ci`. On the scratch consumer it printed
  `fixture.generator-missing producer-consumer: packages/producer/scripts/seed-pinned-world.mjs is registered but not at the head`,
  `leak-scan ... has no "check:safety" script`, and `install head: npm ci ... exit 1` (no lockfile).
  The result was MECHANICAL: FAIL. The CLI has no `--config` flag (`src/cli/review.ts:14`).
- Why it matters: the Reviewer's mechanical half is the one step that can be zero-token, and today it
  gives a guaranteed FAIL off Foundry.
- Minimum fix: read `clossys/review.json` (the `ReviewConfig` fields as data), defaulting to an empty
  config. Make a missing leak-scan a note when the config sets it to `null`. Move `FOUNDRY_CONFIG`
  into the Foundry checkout's own `clossys/review.json`.
- Size M. Pure code/data.

**P0-2. A receipt cannot travel from the Developer's checkout to the Reviewer's.**
- Evidence: `src/review/receipt.ts:145`. `receipt.packet` is compared by absolute real path, and
  `receipt.head` needs equality with the reviewed head (`:146`). Committing the receipt moves head:
  `FAIL receipt.head ... taken at 45b9a10..., reviewing 0826619...`. Not committing it means a fresh
  clone has none, and a copy at another path gave `FAIL receipt.packet ... taken for <path A>, reviewing <path B>`.
  The receipt also stores the absolute local path (`receipt.json` `packet`), so a committed receipt
  leaks the machine layout.
- Why it matters: a Developer in a worktree and a blind Reviewer in a separate session or clone is
  the whole design. Today the only receipt that passes is one the reviewer took on the same disk, in
  the same folder, uncommitted.
- Minimum fix: store `packet` repo-relative, and record `packetSha256`. Accept a receipt whose `head`
  is the parent of the reviewed head when that commit changes only the receipt folder; or bind the
  receipt to `tree` minus its own folder.
- Size S. Pure code.

**P0-3. No contract names a code unit, and no queue entry can be assigned to a factory agent.**
- Evidence: in `schemas/queue-entry-2.json`, `assignee` is the enum
  `director|designer|writer|publisher|producer|owner`. `target` must match
  `^(director|designer|writer|publisher|producer)/<slot>` and `from` the same.
  `schemas/loop-version.json` `$defs.agentId` has the same five names. Decider `verb` is the enum
  `refine-brief|create-candidates|check|pin|pick|decide`. `src/loop/names.ts:16` closes `LOOP_NAMES`
  to nine slot loops, and `LOOP_SUBJECT` (`:51`) allows only `slot|request|publication|none`.
- Why it matters: a Planner cannot file "implement X in repo Y" as a work item, a loop cannot have a
  unit as its subject, and a Developer or Reviewer cannot be a decider. Every factory step falls
  outside the engine's refusal guarantees.
- Minimum fix: add a `clossys.unit/1` record (id, goal, files-in-scope globs, Validation commands with
  expected exits, tier, base ref, acceptance check). Add assignees `planner|developer|reviewer`, a
  target form `unit/<id>`, a `LOOP_SUBJECT` `unit`, and decider verbs `plan|implement|review`.
- Size M (schema, enums, names; conform P1 and P3 will then demand queue and ledger leaves for them).
  The field set needs a model or owner decision; the rest is code.

**P0-4. An agent step's writes outside `clossys/` are invisible.**
- Evidence: `src/loop/agent-snapshot.ts:66` has `SNAPSHOT_TREES = ["clossys"]`, so
  `undeclaredWrites` and `judgeSnapshot` never see `src/` and similar folders.
- Why it matters: for a Developer step the code change is the output. As things stand, an
  implement step could rewrite any source file and report `--step-exit 0` with no `--wrote`, and the
  run would accept it.
- Minimum fix: for a unit subject, take the snapshot as `git status --porcelain` plus `git diff`
  hashes over the worktree. Judge the changes against the unit's files-in-scope globs.
- Size S. Pure code.

**P0-5. No verb for queue to plan to admit to brief to launch, or for worktree, fold or land.**
- Evidence: `clossys --help` lists no plan, unit, admit, launch, worktree, fold or land verb, and
  `review`/`receipt` are not listed either (`grep -c "review\|receipt"` on the help printed 0). The
  admission wrapper `wt run` is parsed by `src/review/receipt.ts:50-55`, but no `wt` exists in the
  repository. Fold and land are `scripts/land-stack.mjs` (needs `gh`, Foundry tiers) and hand-made
  "Fold X into ..." commits (`git log`).
- Why it matters: the Planner's whole job is model tokens or Foundry-only scripts today, and nothing
  a consumer installs carries it.
- Minimum fix (S each, about 5 verbs):
  - `clossys unit lint <unit.md>`: the Validation list parses, has at least one command, every span
    is a known executable, and the scope globs match files.
  - `clossys unit admit <id>`: lint passes, the base resolves, and a queue entry assigns the developer.
  - `clossys unit brief <id> --json`: the packet (goal, scope, Validation, tier, model from
    seat-policy, skill file).
  - `clossys unit worktree <id>`: `git worktree add` on branch `unit/<id>` from base.
  - `clossys unit land <id>`: the review verdict and attestation are present at head, then
    `git merge --no-ff` locally. Pushing and opening a PR stay with the host, as Launcher already does.
- Size M in total. Pure code. Launch itself (starting a session) is host-specific: emit the packet, do not spawn.

### P1: wrong or unreliable result

**P1-1. A receipt with zero commands passes, and review accepts it.**
- Evidence: a packet with a `## Checks` heading instead of `## Validation` gave
  `receipt: 0 command(s) ...` and exit 0. Then `review --packet` printed `receipt pass (0 packet command(s), 0 finding(s))`.
  Spans whose first word is not in `EXECUTABLES` (`receipt.ts:17`: `pnpm`, `yarn`, `vitest`, `tsc`,
  `make`, `pytest`) are dropped without a word (`commandOf` returns "not a command", and
  `parsePacket:74` skips it unlisted).
- Why it matters: the Developer's evidence can be empty by accident and still read green. This breaks
  Inspector's own rule that nothing selected is not a pass.
- Minimum fix: 0 commands should be exit 2 / `receipt.empty` FAIL. List every dropped span under
  `skipped` with its reason. Make `EXECUTABLES` come from config.
- Size S. Pure code.

**P1-2. `planner` is already the CLI's default identity, so the real Planner will inherit a polluted history.**
- Evidence: `src/records/slot-write.ts:649,681,704,768,788,824,1279,1442,1517` default `by: "planner"`
  for submit, critique, migrate and options. `AUTHORS = { also: ["owner", "planner"] }` (`:667`).
  `clossys brief --tighten --by planner:<ref>`, `pin ... | planner[:<ref>]` (`:846`), and a pin with
  basis `planner` is shown as `confirm` (`src/server/slot-detail.ts:35`). The e2e submits with
  `--basis planner`.
- Why it matters: once a Planner agent exists, its records cannot be told apart from anything run
  without `--by`, and its pins inherit a privileged basis it never earned.
- Minimum fix: rename the default actor to `cli` and the basis to `bulk`/`operator`. Reserve
  `planner` for the agent seat. Add a migration for existing records.
- Size M. Code plus a record migration.

**P1-3. The agent-step exit is self-reported, and so is the serving model.**
- Evidence: `--step-exit <0|1|2> --model <serving model>` (`src/loop/cli.ts:69-73`). The runner takes
  `outcome.exit` as given (`runner.ts:707`). For content loops a later code `check` step re-judges.
  An implement step has none.
- Why it matters: a Developer that says 0 is believed.
- Minimum fix: in a unit loop, follow `implement` with a code step that runs `clossys receipt`, and
  let its exit decide. The agent's own exit only says it could not (2).
- Size S. Loop data plus one built-in.

**P1-4. Owner provenance is a string the model types.**
- Evidence: `clossys answer <entry> <answer> --by owner --via chat --quote "<words>"` and
  `request <id> --answer ... --quote` (`skill/SKILL.md`, "Work-entry answers"). Nothing binds the
  quote to a transcript, a host event or a signature.
- Why it matters: admit and land are owner gates. A low-tier model under pressure can write the quote.
- Minimum fix: none in code alone. Name it in the skill as unverifiable and keep land behind the
  host's own merge permission, as Launcher does. A host-signed answer is a later contract.
- Needs a model or owner decision.

**P1-5. The documented T1 init does not complete on a fresh consumer, and the next verb reports green.**
- Evidence: after `config --init`, `run loop.fill --init` stopped with `ia.orphans: publisher/ia.json missing`.
  After four `ia <agent> --start`, it stopped at `publisher.admin-seated check fail`, and
  `run loop.fill` then exited 0 with "nothing to fill". The skill says only "`clossys run loop.fill --init`
  once (T1), then `clossys run loop.fill`".
- Why it matters: it is the same loop machine the factory loops would reuse, and its first-run path
  depends on knowledge outside the skill.
- Minimum fix: `run loop.<x>` should exit 1 while the latest `--init` run of that loop is stopped. The
  init should name the missing prerequisite verb.
- Size S. Pure code.

**P1-6. The review's test step assumes Foundry's test layout.**
- Evidence: `src/review/graph.ts:90-96` treats covering tests as `*.test.*` files reached by static
  import, run with `npx vitest run` or `node --test`. The scratch consumer's `npm test` never ran:
  `tests fail 0/0 file(s) green, 1 changed source(s) uncovered`.
- Minimum fix: a `tests` entry in the consumer review config (argv, plus an optional per-file runner).
- Size S. Pure code/data.

### P2: cost, speed, polish

- **P2-1.** The review always runs install in two trees with a 30-minute per-command timeout
  (`config.ts:102`) and up to 40 mutants. There is no `--steps` subset and no cache keyed by tree sha,
  even though `accept-unit.mjs` already caches builds by tree sha. Size S.
- **P2-2.** `treeSnapshot` hashes every file under `clossys/` on every agent step (`agent-snapshot.ts:78-101`).
  Widened to a code worktree per P0-4 it would hash `node_modules`. Use git's index instead. Size S.
- **P2-3.** The conform matrix has no factory cells, so readiness for Planner, Developer and Reviewer
  cannot go red. Add cells U1-U4 (unit schema placed, unit loop has every exit routed, receipt
  non-empty, review config present) once P0-3 lands. Size S.

## 3. Token waste, and verbs that hide judgement

Steps a model does today that should be a verb:

- **Writing and checking a unit packet's Validation list.** No lint exists, so the Planner relies on
  reading it carefully, and P1-1 means mistakes pass. This should be `unit lint`.
- **Choosing a tier and model per unit.** Seat policy maps tier to model, but nothing records the tier
  chosen for a unit or checks it against the seat. This should be a field in `clossys.unit/1` and a
  check in `unit brief`.
- **Fold and land.** These are hand-made merge commits on an integration branch, plus a
  merge-train script that needs `gh`. This should be `unit land` (local merge, refusal reasons), with
  the push left to the host.
- **Assembling the Developer brief.** The model gathers goal, scope, skill and commands by reading
  files. This should be `unit brief --json`, the equivalent of `clossys next --json` for slots.
- **Mapping a review FAIL to fix work.** Today findings are read by a model. This should be
  `review --json` piped to `clossys request --kind fix` per finding, as `loop.audit` already does for
  check findings (`runner.ts` `routeFindings`).

Verbs that hide judgement:

- `clossys review`: the exempt-paths list (`forbidden.baseline` matching `*allowlist*`,
  `*exemption*`, `*ceiling*`) is a policy choice presented as mechanics. A consumer cannot see or
  change it.
- `classify-change-tier.mjs` (prose vs full) and `review-tiers.json` are owner policy, encoded only
  for Foundry.
- `clossys settle` (`loops/loop.refine/refine-v1.json` step `triage`) decides that "often no tightening"
  is needed by a fixed trigger table. That is fine, but the rule lives in prose `does` text and in the code.

## 4. Where the skill text and the code disagree

- `skill/SKILL.md` says "The six Producer loops", but `LOOP_NAMES` has nine (`src/loop/names.ts:16`)
  and `loops/` holds nine.
- The skill says decisions land "in five queues", naming pick, approve, clarify, fix and slot. The
  schema kind enum has six (`change` too). `QUEUE_NAMES` has four (`src/queue/entry.ts:17`), and
  `queue.fix` holds both /1 and /2 entries (`entry.ts:41-58`). Conform P1 is red with
  `queue.change is not placed`.
- **The loop packet's skill path is wrong on a consumer.** It prints `skill packages/<agent>/actions/<id>/skill.md`
  (`src/loop/cli.ts:218`). That is the logical id, which `skillFor` resolves to the installed file
  but does not print (`src/loop/slots.ts:165-170`). A literal low-tier model on a consumer opens
  `packages/designer/...` and finds nothing. `clossys next --json` gives `skill.file`; the loop packet does not.
- Every package skill has `disable-model-invocation: true` (for example `packages/producer/skill/SKILL.md:3`).
  The Interview contract every agent "cites" therefore loads only when the owner invokes it. An
  agent reached through a loop packet reads only `actions/*/skill.md`, and none of the 39 action
  skills names `--resume`/`--step-exit` (`grep step-exit packages/*/actions/*/skill.md` finds nothing).
  The printed `then:` line is the only guide.
- The skill says to run every verb as `npx --no-install clossys <verb>`. A packet's Validation span
  `clossys ...` is executed as `node packages/producer/dist/cli/index.js ...` (`receipt.ts:20,59`),
  which exists only in Foundry: on the consumer it exited 1.
- `docs/engine.md` cites "system.md", "flows.md" and "producer.md" sections, and so do 75 source
  files. None of those files exists in the repository (`find` returned only `docs/changelogs/producer.md`).
- The skill carries six `DRAFT` markers on shipped instructions (loop.scope, loop.slot, the queues,
  work-entry answers, `--wrote`). A low-tier model cannot tell whether DRAFT means "do not run".
- `verdict` (`actions/verdict`, `src/cli/verdict.ts`) is a taste verdict on a slot. A Reviewer skill
  that says "record the verdict" would reach for it, and it refuses anything that is not
  `<agent>/<slot>`.

## 5. Missing or vacuous checks and tests

- **0-command receipt to review PASS** (P1-1). There is no test for an empty or misheaded Validation
  section. `src/review/units.test.ts` tests only well-formed packets.
- **`review.test.ts` never runs the default config.** Every call passes `config: CONFIG`
  (`src/review/review.test.ts:76,208,236`), so the shipped `FOUNDRY_CONFIG` path, the only one a
  consumer gets, has no test outside Foundry. A consumer-shaped fixture (no lockfile, no `check:safety`,
  no producer fixture) would have caught P0-1.
- **No test takes a receipt in one checkout and reviews it in another** (P0-2).
- **The e2e drives no loop.** `e2e/scenario.json` steps are `config`, `ia`, `seat`, `craft` and
  submit; none is `run loop.*`. The resumable runner is proven only in-repo, and the e2e is red
  anyway at `craft.frame.submit` (census).
- **`Attestation` and `Gate` have validators and doc tables** (`src/engine/types.ts:80-113`,
  `docs/engine.md` "Attestation", "Gate") **and no writer, reader or check.** A test of the
  validator proves a shape that nothing uses.
- **Conform cannot measure the factory** (P2-3). Its Q7/Q8 "vacuous: nothing to judge (empty is red)"
  rule is the right pattern; apply it to units.
- **The `mutation` step can never fail** (`docs/review.md`: "Fails when: never"). Its survivors are
  notes, so a test suite that kills nothing still reads MECHANICAL: PASS. For a Reviewer that is a
  missing signal: add a floor in config, such as an uncovered-plus-survived share that fails.

## 6. Simplifications

- **Merge the review notions into one verdict record.** Today there are four, with no shared record:
  `clossys review` (MECHANICAL line), `land-stack.mjs` `foundry-review-record` PR comments,
  Controller `ReviewEvidenceBundle` v3 and Inspector `checkReviewEvidence`. Pick
  `clossys.attestation/1` (it already exists) as the one Reviewer record: gate `review.mechanical` or
  `review.judgement`, subject `unit/<id>@<head>`, inputs as receipt and diff hashes. Retire the
  PR-comment grammar for consumers.
- **Delete or wire `Gate` and `Attestation`.** If they are not wired by the first factory unit,
  delete them with their doc tables.
- **Collapse the two queue entry generations.** `clossys.queue-entry/1` and `/2` share `queue.fix`,
  which needs the filter in `entry.ts:41-58` and `src/queue/legacy-fix.ts` (75 lines). The two
  owner-answer verbs, `clossys answer` and `clossys request <id> --answer`, do the same job. One
  schema and one verb would remove a branch from every queue reader.
- **Remove the `wt run` unwrapping** (`receipt.ts:50-55`, its test and its doc row). It serves a tool
  that is not in the repository.
- **Strip internal unit tags from shipped code.** There are 441 occurrences of `foundry-build-0048`,
  `U7 r5` and `blind2 B1`-style tags in `packages/producer/src`, and the cited spec files are absent.
  The comments explain history to readers who cannot open it. Keep the rule each states, drop the tag.
- **Make the slot-loop enums data.** `LOOP_NAMES`, `LOOP_TRIGGERS`, `LOOP_SUBJECT` and `EXIT_CHECKS`
  (`src/loop/names.ts`) duplicate what each `loops/*/*.json` could declare (`subject`, `exits`).
  Making them data is what lets factory loops ship as package files rather than engine edits.

## 7. Top 5 recommended units, in order

1. **REVIEW-CONFIG**: read `clossys/review.json` (install, tests, typecheck, counts, fixtures,
   leak-scan, executables, clossys bin) with an empty default and move `FOUNDRY_CONFIG` into
   Foundry's own file, so `clossys review` can PASS on a consumer (P0-1, P1-6, P2-1).
2. **RECEIPT-PORTABLE**: store the packet path repo-relative with its sha256, bind the receipt to the
   head's tree minus the receipt folder, refuse 0 commands and list dropped spans, so a Developer's
   committed receipt verifies in a Reviewer's clone (P0-2, P1-1).
3. **UNIT-CONTRACT**: add `clossys.unit/1`, the planner, developer and reviewer assignees and seats,
   the `unit/<id>` target and subject, and the plan, implement and review verbs. Rename the CLI's
   default `planner` actor to `cli` (P0-3, P1-2).
4. **UNIT-VERBS**: `clossys unit lint|admit|brief|worktree|land`. Brief prints the installed skill
   file and the seat-policy model for the unit's tier; land refuses without a review attestation at head (P0-5).
5. **LOOP-UNIT**: ship `loops/loop.unit` (admit, then brief as code; implement as an agent step
   judged by a git-worktree snapshot against scope; receipt as code; review mechanical as code;
   judgement as an agent step writing `clossys.attestation/1` blind to the developer's packet; land
   needing the owner's approve), with conform cells for it (P0-4, P1-3, P2-3).

