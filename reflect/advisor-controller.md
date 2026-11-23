# Reflection: Advisor (front door) and Controller (rules)

Read-only reflection at `5a2e197ea` (claude/r2f-int2). Written by model `claude-opus-5-5`.
Method: read `packages/advisor` (skill, front-door code, tree, loops, conform.json, tests) and
`packages/controller` (skill, package.json, bins, the modules other packages import), then ran the
front door for real: packed the seven packages with `npm pack --ignore-scripts`, wrote an
`artifacts.json` by hand (pack-five needs a clean checkout and a Studio build), and ran
doctor → install → init → intake → relations → `clossys run loop.fill --init` in a fresh `git init`
repository, plus install into a pnpm-shaped monorepo. Commands and outputs are quoted below.
Not done: the real `pack-five.mjs` (needs a clean, Studio-built checkout); the publisher
`check:client-boundary` build step was stopped after ~10 minutes (tsc had finished).

## 1. What exists and works

- `advisor doctor` (`packages/advisor/src/front-door/doctor.ts`): four read-only probes, picked from
  the tree, with a guard on which probes may run (`guard.ts:doctorProbeIssues`). Took 0.8 s in the fresh repo.
- `advisor install|update --from <pack>` (`install.ts`): checks the manifest, checks each SHA-256
  before npm runs, needs every role exactly once, refuses a dirty or incomplete pack, refuses a second
  install and any downgrade, and keeps old tarballs. Real run: 41 s, exit 0, all 7 packages installed,
  `clossys/advisor/install.json` written. Updating from the same pack printed `already at foundry 5a2e197ea42d; nothing changed`.
- `advisor init` (`init.ts`): hands over to `clossys config --init` and `clossys init`. Real run: 3.8 s,
  wrote the config, components.json, the AGENTS.md views pointer, CLAUDE.md and the 7 skills in both
  `.claude/skills` and `.agents/skills`.
- `advisor intake --answers` (`intake.ts`): checks its plan before running anything (`guard.ts:intakePlanIssues`),
  writes only through `clossys evidence --source user`, can resume, never overwrites, and reports each
  answer as recorded, skipped or failed. Real run: 5 owner-intake findings with `Informs:` bullets, and
  Director's `judge --heard` reads those bullets (`director/src/cli/judge.ts:74`).
- `advisor relations` (`relations.ts`): a strict schema; context only.
- `advisor conform` (`cli.ts` default branch, `tree.ts`): the L0–L3 round reads Producer's real loop
  names, schema and adapter check (`producer.ts`), so Producer drift turns it red. It is red today (see P0-3).
- `real-cli.test.ts`: init and intake run against the built `clossys` binary, not a fake.
- Controller pieces that run in the consumer: `@clossys/controller/policy` (`computeDigest`,
  `verifyBinding`) and a few lifecycle types, imported by Publisher (`publisher/src/record/*`, `pack/*`).
  Everything else in Controller serves the foundry repo itself (gates, release, repository, conventions).

## 2. Gaps

### P0: blocks a consumer finishing the flow

**P0-1. A fresh consumer cannot get a pack, and no consumer-facing document describes the front door.**
- Evidence: `advisor/skill/SKILL.md:11` says "Ask the owner where that pack directory is". A pack
  only comes from `packages/producer/scripts/pack-five.mjs`, which needs a clean foundry checkout and a
  Studio build (`pack-five.mjs` help text), and which "does not ship in this package" (`install.ts:2`).
  `grep -rln "advisor doctor\|advisor install" docs README.md` finds nothing. `advisor/README.md:4` says
  `npm install @clossys/advisor --registry=…`, which the skill forbids ("Never fetch Advisor … from a registry").
  The root README row for advisor describes the retired hub ("sponsor dialogue … hub-placement evidence").
- Why it matters: the first five minutes start with a question the owner cannot answer. There is
  also no front-door skill in the repository until after `advisor init` copies it there (a chicken-and-egg problem).
- Minimum fix: publish packs as release assets with a stable `start` line written into `artifacts.json`
  (or a `README.txt` in the pack) that gives the exact `npm exec … advisor doctor` command. Rewrite the
  advisor README into a 15-line quickstart. Replace the root README row.
- Size: S (docs, plus pack-five writes one field). Pure code and data.

**P0-2. The hand-over leaves a fill run waiting on something nobody is told to resume, and it points at a skill path that does not exist.**
- Evidence (real run): `npx clossys run loop.fill --init` printed
  `run …-fill-capability-operation-delivery: step create waits for agent:director (create-candidates, mid)`,
  `skill packages/director/actions/director.candidates/skill.md`, `then: clossys run loop.fill --resume --run … --step-exit <0|1|2> --model <model>`.
  The consumer has no `packages/` (`ls packages` → No such file); the real file is
  `node_modules/@clossys/director/actions/director.candidates/skill.md`. `director/skill/SKILL.md` never
  mentions `loop.fill` or `--resume` (grep finds no match). The skill's hand-over is just "Talk to @clossys-director next".
  The first queued slot (`capability.operation.delivery`) is none of the 8 cells the intake informs.
- Why it matters: Director starts its own interview while a Producer run sits half-finished. A
  low-tier model that follows the printed path fails to open the file.
- Minimum fix: either `advisor` stops at `--init` and does not start the first agent step (queue only),
  or the Director skill gains a "resume the open fill run" step. Have Producer print skill paths resolved
  against the consumer's `node_modules`. Order the T1 queue so cells with intake evidence come first.
- Size: M. Ordering the queue is a model/owner decision; the rest is code.

**P0-3. The front-door conform round and its tests are red at HEAD, and nothing gates it.**
- Evidence: `node packages/advisor/dist/front-door/cli.js conform` → `red A.C1 conform.json requires requests`,
  `advisor conform: 9 rows, 1 red`. `npx vitest run src/front-door` → `3 failed | 50 passed`
  (`front-door.test.ts:427,434,522`). Producer's adapter now requires `requests`; `advisor/conform.json` lacks it.
  `producer conform --all` checks only `CONFORM_AGENTS = ["director","designer","writer","publisher"]`
  (`producer/src/conform/model.ts:17`), and the 925ae7f census only builds advisor.
- Why it matters: the drift detector worked, and nobody saw it. The front door is the one agent that
  neither the cross-agent grid nor the census covers.
- Minimum fix: add `"requests": []` (or whatever the adapter expects) to `advisor/conform.json`, add
  advisor to `conform --all` with its own row set, and make the census run `npm test -w @clossys/advisor`.
- Size: S. Pure code and data.

### P1: wrong or unreliable result

**P1-1. "Controller rules" are not where the product goal says they are. Consumer enforcement lives in Producer, and owner rules are never enforced in a consumer.**
- Evidence: Producer has no dependency on `@clossys/controller` (producer `dependencies` list it nowhere).
  Its only Controller code is a generated copy, `producer/src/generated/check-output-envelope.ts`. The
  consumer's rules are `producer/src/constitution/rules.json` (R01–R20), run by `clossys check --constitution`.
  Owner rules go to `scripts/rules/registry.json` in the consumer (`producer/src/cli/rules-file.ts:6`).
  The only thing that runs a row's `checks`/`fixture_runs` is the foundry-only `scripts/check-rules.mjs`;
  in shipped Producer code, only `owner.ts` writes that file and `owner-wiring.ts` uses just its directory.
  Controller has no `conform.json`, no tree and no recipes, so the conform grid never sees it.
- Why it matters: an owner who records "never do X" with `clossys rule` gets a row that nothing in their
  repository ever executes. The rules-as-data story has three registries (foundry `scripts/rules`,
  Producer constitution, Controller `controller-check`), and none of them is the consumer's single source.
- Minimum fix: decide which package owns consumer rules (this needs a model or owner decision). Then ship a `clossys rule --check`
  (or a Controller verb) that runs registry rows in a consumer, and move the file out of the foundry-shaped
  path to `clossys/rules.json`.
- Size: M. Needs a decision first.

**P1-2. The Controller skill shipped into every consumer describes the retired hub, and following it literally fails.**
- Evidence: `controller/skill/SKILL.md:15` "The whole team is composed in the hub. A repo staffed in an approved plan…";
  `:19` "Invoke me with `loop` … sense -> judge -> act -> verify -> learn" (no such loop or verb exists; `foundry-loop-status` renders
  from `clossys/<role>/loop.json` and `clossys/brief.json`, hub records, `controller/src/loop/cli.ts`); `:37` "Ask
  `@clossys-advisor` whether to hire you" (Advisor: "there is no hub, no kit, no role roster", `advisor/skill/SKILL.md:8`).
  `clossys init` copied it to `.claude/skills/clossys-controller/SKILL.md` in the real run.
- Why it matters: it contradicts the Advisor skill in the same folder, so a model can send the owner to a hub that does not exist.
- Minimum fix: rewrite it to 10 lines ("rules are checked by `clossys check --constitution`; record an owner
  rule with `clossys rule`"), or stop placing a Controller skill at all (`disable-model-invocation: true` already hides it).
- Size: S. Pure text.

**P1-3. A freshly onboarded workspace is red under every check, so `loop.update` always files `queue.fix`.**
- Evidence (real run right after onboarding): `npx clossys check` exit 1 (61 `[no-pin]` rows);
  `clossys check --constitution` → `FAIL rows 106 … findings 82`, including `R01.1 designer *: agent has no ia.json`
  and `R01.1 writer *: agent has no ia.json`. `loop.update` ends with `clossys check` → `onFail raise queue.fix`
  (`front-door/loops/loop.update/update-v1.json`).
- Why it matters: "not filled yet" and "broken" look the same. Every update floods the audit loop, and an
  owner sees red before answering anything. Onboarding also leaves Designer and Writer unplaced (the conform W2 rows show the same).
- Minimum fix: `loop.update` should run `clossys check --constitution --enforced` against a green baseline that
  onboarding seeds (`--record-green` after init), not plain `clossys check`. `advisor init` should place every
  installed agent's IA (`clossys ia <agent> --start`).
- Size: S–M. Pure code.

**P1-4. Owner input is free text, not multiple-choice packets, and it duplicates Director's interview.**
- Evidence: `front-door/tree.json` intake slots ask "What limits you most today: money, time or people?" as
  free text. Director's skill interviews "hypothesis-first with two or three options" (`director/skill/SKILL.md:3`).
  Advisor already has unused card machinery (`advisor/src/context-questions.ts` `nextContextQuestion/applyContextChoice`,
  `sponsor-questions.ts`), dead in the front door.
- Why it matters: it goes against the product goal, and the owner may be asked about the business twice.
- Minimum fix: give each intake slot `options` (with a "my own words" choice) and have `advisor intake --questions --json`
  print the packet. Or drop intake entirely and let Director's first packet cover those 5 cells (this needs an owner decision).
- Size: S. Needs a decision.

**P1-5. Install silently mixes package managers and leaves a 665 MB `node_modules` untracked but not ignored.**
- Evidence: in a pnpm-shaped repo (`pnpm-workspace.yaml`, `pnpm-lock.yaml`), install ran
  `npm install --save-exact` (`install.ts:111`) and left both `package-lock.json` and `pnpm-lock.yaml`.
  In the fresh repo, `git status` after init showed `?? node_modules/ ?? vendor/ ?? package-lock.json`, with no `.gitignore` written
  (`du -sh node_modules` → 665M, vendor 16M). `update` never deletes old tarballs, so vendor grows about 16 MB per pack.
- Why it matters: a model told to "commit the setup" commits node_modules. A pnpm or yarn repository ends up with two lockfiles.
- Minimum fix: doctor adds a `machine.repo.manager` probe (refuse when the lockfile is not npm's, or use the
  detected manager). Install appends `node_modules/` to `.gitignore` when it is missing and prints which files to commit.
- Size: S. Pure code.

**P1-6. A hub-era degraded mode exists only as skill prose.**
- Evidence: `advisor/skill/SKILL.md:30-46` tells the model to parse `clossys/.state/workspace.json`, scan sibling
  directories, read a sibling's `inventory.json` and compare git origins. `grep -rn "account-hub" advisor/src`
  finds only legacy modules, and no front-door verb does this.
- Why it matters: a low-tier model scanning sibling folders is slow and unreliable, and it reads outside the repository.
- Minimum fix: a doctor probe `machine.repo.hub` that does the check in code and refuses with the hub's name. Or delete the section if no hub engagements remain (owner decision).
- Size: S.

**P1-7. Intake's "next" line skips the last two front-door steps.**
- Evidence: `intake.ts:121` prints `next: talk to @clossys-director`; the skill's steps 5 (`relations`) and 6
  (`clossys run loop.fill --init`) come after it (`SKILL.md:19-20`). `loop.onboard` has no relations step at all.
- Why it matters: a model that follows the CLI's own `next:` hint never starts Producer.
- Minimum fix: have intake print `next: advisor relations --set <file> (optional), then npx clossys run loop.fill --init`, and add relations to the loop as an optional step.
- Size: S.

**P1-8. The relations note refuses ordinary owner words.**
- Evidence: `relations.ts:33` refuses any word starting with `/`. A real run with note `"serves the signup endpoint at /v1/signup"` →
  `refused: sisters[0].note must not hold a path, URL or command`.
- Why it matters: the model has to reword the owner's words, which is a judgement call nobody sees.
- Minimum fix: refuse only absolute filesystem shapes (`^/`, `~/`, a drive letter) and `://`.
- Size: S.

### P2: cost, speed, polish

- **P2-1. Consumer install weight.** 41 s and 665 MB. Producer's runtime deps include `next`, `react`, `esbuild`,
  `tailwindcss` and `shadcn` (producer `package.json`). Whatever does not need Studio could be an optional peer. Size M. Pure code.
- **P2-2. 70 bins in `node_modules/.bin`**, 22 of them hub-era or foundry-governance (`advisor-check`, `advisor-repository-card`,
  `foundry-onboarding-run`, `repository-package-adoption-check`, …). A model that discovers tools with `ls .bin` is misled. Size S. Pure code.
- **P2-3. Bare `clossys` in the text written for the consumer.** The AGENTS.md pointer written by `clossys init` says "run `clossys views list`",
  but `clossys` is not on PATH (only `npx clossys` works). Size S.
- **P2-4. The install check does not tie role to package name.** An `artifacts.json` entry `{role:"director", name:"@x/y"}` passes `readPack`.
  The `package.json` inside each tarball is never compared to the manifest. Size S.
- **P2-5. `npm install` runs dependency lifecycle scripts** (no `--ignore-scripts`). Fine for a hash-pinned pack, but it is not stated. Size S.

## 3. Model steps that should be verbs, and verbs that need judgement without saying so

Steps the model does today that should be verbs (token waste):
1. Finding the advisor tarball name inside `artifacts.json` to build the `npm exec --package=…` line (skill step 1). The pack should print this line.
2. Reading `node_modules/@clossys/advisor/front-door/tree.json` (about 100 lines of JSON) to find the 5 intake questions. Should be `advisor intake --questions [--json]`.
3. Writing the answers JSON file by hand (schema string, ids). Should be `advisor intake --answer <id>=<words>` (repeatable), or stdin.
4. Running six verbs in order and checking each exit code from prose. The loops are data that nothing runs:
   `npx clossys run loop.onboard` → `loop.onboard is not a loop (loop.fill, …)`. Should be `advisor onboard --from <pack> [--answers <file>]`,
   or Producer accepting `advisor/loop.*`. Then the `onFail: raise queue.clarify` in `onboard-v1.json` would actually run; today it is decoration.
5. The degraded-mode hub check (P1-6).
6. Writing the host-specific hand-over sentence (Claude Code vs Cursor). The last verb should print it.

Verbs that need judgement without saying so:
- `intake`: which owner sentence answers which question id, what counts as "did not answer", and joining a multi-line answer into
  one line of at most 500 characters (`intake.ts:67-70`). All of these change "verbatim" without any record.
- `relations --set`: rewording forced by the path regex (P1-8).
- `install --from`: picking the pack directory (P0-1).
- `conform`: the "report" rows (`A.R3`, `A.W2`) never turn red, so whether to act on them is left to the model.

## 4. Where the skill text and the code disagree

| Skill says | Code does | Literal low-tier result |
|---|---|---|
| `SKILL.md:20` run `clossys run loop.fill --init` | `clossys` is not on PATH; only `npx clossys` | `command not found` |
| `SKILL.md:16` questions are in "this package's `front-door/tree.json`" | no verb lists them; after `npm exec` the package lives in the npx cache | model searches the disk |
| Step order 4 → 5 → 6 | `intake` prints `next: talk to @clossys-director` | Producer never started |
| `SKILL.md:28` "`loop.onboard` … ends with `clossys run loop.fill --init`" | no runner executes advisor loops | model thinks a loop ran |
| Hand-over "Talk to @clossys-director next" | a fill run is waiting on `agent:director` with a resume line Director's skill never mentions | dangling run |
| Advisor README: install from registry | skill: never from a registry | wrong source |
| Controller skill: hub, `loop`, hire through Advisor | no hub, no Controller loop, Advisor does not hire | sends owner nowhere |
| Fill output: `skill packages/director/...` | consumer has `node_modules/@clossys/director/...` | file not found |

## 5. Missing or vacuous checks and tests

- `install` is tested only against `fakeHost` (`front-door.test.ts:112-199`). Nothing runs a real `npm install` of a pack, and nothing
  checks that `readPack` and `pack-five.mjs` agree on `artifacts.json` (no shared fixture; `grep readPack` finds only the advisor test).
- Producer's `consumer.e2e` packs `E2E_COHORT = ["producer","director","designer","writer","publisher","controller"]`
  (`producer/src/check/e2e.ts:52`). That is six packages without Advisor, so the only consumer end-to-end skips the front door.
- No test covers doctor → install → init → intake → fill as one sequence. `real-cli.test.ts` fakes the install record and node_modules.
- `controller-check` (`controller/src/rule-conformance.ts`) computes a "rule conformance rate" from observations the caller supplies.
  It passes whatever it is told, so it proves nothing about the repository.
- `advisor conform` `A.W2` has reported "extends no Producer loop yet" for both loops and stays non-red forever. It is a permanent excuse, not a check.
- Conform `Q6/Q7/Q8/L4/L5 VAC` rows across agents are red only because they are vacuous (`conform --all`): 2–5 per agent. Good that empty counts as red,
  but it hides real red among structural nothing.
- `intake` test "gates on the installed Director, not on install.json" (`front-door.test.ts:345`) runs intake without
  an install record, while `init` refuses without one (`init.ts:13`). The two disagree, and the test locks in the inconsistency.
- Doctor does not check: npm lockfile versus another package manager, a writable workspace, or a `.gitignore` that covers node_modules.

## 6. Simplifications

- **Advisor legacy hub code:** about 4.6k non-test lines in `advisor/src/*.ts` outside `front-door/` (sponsor, kit, engagement brief, plan,
  registry snapshot, package resolution), plus 6 bins and the `pack-capability-catalogue.mjs` build and test step. The front door imports none of it.
  It is kept alive only by `controller/src/onboarding/*` (hub role selection: `ENGAGEMENT_BASELINE_ROLE`, `@clossys/architect`, `@clossys/observer`)
  and Director's generated brief contract. Remove these together. Size L.
- **Controller in the consumer cohort:** consumers use about 330 lines (`policy/*`) of about 26.5k. Move the policy digest to where
  Publisher uses it (or a tiny package) and drop Controller from `PACK_ROLES` and the consumer skill set. Keep it as foundry-repo
  dev tooling. Saves a tarball, 16 bins and a misleading skill. Size M. Needs a decision tied to P1-1.
- **`front-door/intake-feeds.json`** repeats `feeds` from `tree.json`, and A.C1 checks that the two agree. Derive it, or drop the edge file. Size S.
- **Three parallel lists of verbs:** `VERB_FLAGS`, the tree slot `verb`s, and the loop `cli` strings. Conform checks them against each other.
  Generating the usage text and loop `cli` strings from `VERB_FLAGS` would remove one list. Size S.
- **The degraded-mode skill section** (17 lines): delete it if no hub engagement survives, or move it into code (P1-6).

## 7. Top 5 recommended units, in order

1. Make the front door green and gated: add `requests` to `advisor/conform.json`, add advisor to `conform --all` and the census, and add a real-npm end-to-end test (doctor → install → init → intake → fill) built on a pack-five fixture.
2. Ship a usable entry point: pack-five writes the exact `npm exec … advisor doctor` start line into the pack, the advisor README becomes a quickstart, and the root README row and the Controller skill are rewritten for the no-hub world.
3. Add `advisor onboard --from <pack>` with `intake --questions/--answer` as multiple-choice packets, so the whole front door runs as one verb with zero model tokens beyond the owner's choices.
4. Fix the hand-over: fill `--init` queues without starting an agent step (or Director resumes it), skill paths resolve against `node_modules`, and onboarding places every agent's IA and seeds the constitution green baseline that `loop.update` checks against.
5. Decide and implement one consumer rule home: owner rules move to `clossys/rules.json`, a shipped verb runs them, and Controller is either that owner or leaves the consumer pack.
