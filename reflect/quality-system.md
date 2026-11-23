# Reflect: the quality system (conform, checks, e2e gate, suites, fixtures)

Base: `5a2e197ea` on `claude/r2f-int2`. Serving model: `claude-opus-5-5`.
Read-only: no source file changed. Every number below was measured in this session on a cloud container
(`npm ci`, then the seven builds in the order advisor → producer). Some measurements overlapped, so wall times
are upper bounds. No test failure was a timeout.

## 1. What exists and works

- **Conformance matrix.** `clossys conform` (`packages/producer/src/cli/conform.ts`, `src/conform/*`, registry
  `src/conform/assertions.json`) judges 35 standard assertions per content agent, 8 Producer wiring rows and
  20 dogfood rows. "Empty is red" (`src/conform/run.ts:26`) stops a cell with no evidence from passing. The
  expensive probes run real verbs on temporary copies (`dogfood.ts` `probeIaContract`, `probePinGate`,
  `probeEmptyL2`), not mocks.
- **E2E gate.** `clossys check --e2e` (`src/check/e2e.ts`) packs six tarballs, installs them into an empty
  directory, checks that each package is installed once, drives `e2e/scenario.json` through the installed bin
  only, then checks the rendered HTML, a repeat build's digest and portability. Finding causes are typed
  (`E2E_CAUSES`). The pack and install half is sound.
- **Rule meta-check.** `scripts/check-rules.mjs` plus `scripts/rules/registry.json` (29 owner rules): every
  enforcing check has to fail on a minimal violation fixture, with the expected text. A floor
  (`RULE_FLOOR`) stops anyone deleting a rule or fixture quietly. This is the best idea in the area.
- **Aggregators.** The `check` runner (`scripts/run-check-steps.mjs`) keeps going after a red step and
  reports every red step. `check:agents` writes a stable scoreboard (`scripts/check-agents.mjs`).
  `check:orphan-checks` catches a check file that nothing reaches.
- **CI hygiene.** `scripts/classify-change-tier.mjs` fails closed. `scripts/lib/vitest-build-package.mjs`
  fixed the per-file `tsc` race (#1385). `scripts/lib/gate-test-set.mjs` discovers the gate suites from the
  tree instead of keeping a hand-written list.
- **Per-slot preflight.** `clossys check --constitution --slot <agent>/<slot>` and `--changed <ref>`
  (`check:changed`) already exist.

## 2. Gaps, ranked

Summary of what was measured:

| gate | result | wall |
|---|---|---|
| `node packages/producer/dist/cli/index.js conform --all --json` | 172 cells, **56 red, 20 of them vacuous**, exit 1 | 37 s |
| `npm run check:e2e -w @clossys/producer -- --json` | **red** at `build` (75 steps ran) | 2 m 01 s |
| `node scripts/check-agents.mjs` | **9/9 red, 7 with exit 2 "could not run"** | 7 s |
| `npm run check:constitution:strict` | red: 596 enforced findings, no green baseline | 2.4 s |
| `node scripts/check-rules.mjs` | red: **7 of 29 "enforced" rules fail their own fixture** | 5 m 13 s |
| `npx vitest run` in `packages/producer` | **162 failed / 3883 tests, 47 of 1015 files** | 11 m 35 s (23 m user) |
| `npm run build -w packages/publisher` | green | **8 m 27 s** (59 s user) |

### P0: blocks a consumer finishing the flow

**P0-1. No gate that proves the agent team works runs in CI. The local aggregate is red by construction.**
Evidence: in `.github/workflows/*.yml`, each of these is invoked 0 times: `check:agents`,
`check:constitution`, `check:studio` (which holds `check:e2e`), `check:rules`, `check:pipeline`,
`check:step-standard`, `check:single-reader`, `check:engine-side-door`, `check:flat-slots`,
`check:pin-propagation`, `check:every-candidate-previewable`, `check:decisions`, `check:git-cms`,
`check:compile-pure` (counted with `grep -c -- "<script>\b"`). They live only in the root `check` chain
(`package.json:168`), and nothing in CI calls that chain. So `R-E2E-CONSUMER`, `R-CHECKS-WIRED` and the rest
are "enforced" in `registry.json` but block nothing. Integration commits like the "Fold X into int2"
commits land with the producer suite and e2e red.
Why it matters: "works in a freshly installed consumer" has no gate, so a regression reaches the owner first.
Minimum fix: one CI job `agent-team` (needs build) that runs `check:e2e`, `check:agents` (after P0-2),
`check:constitution --enforced` (the baseline mode) and `vitest` for producer and the four agents. Make it
required on `claude/r2f-int*` and main. Size M (workflow plus a baseline seed). Pure code.

**P0-2. `check:agents` cannot find a consumer, so it measures nothing.**
Evidence: `scripts/check-agents.mjs:160` spawns the CLI with `cwd: REPOSITORY` and no `--root`. The
repository root has no `clossys/`. Output: `Root not found: expected clossys/clossys.config.ts in this
directory or an ancestor` for 7 steps (exit 2, "0 finding(s)"), and `no agents/<agent>/ia.json` for the other
2. `CLOSSYS_ROOT` does not help, because the CLI does not read it. `check-agents.test.mjs` pins the step list
but never checks that a step reaches a root.
Why it matters: the one gate meant to say "the Director/Designer/Writer/Publisher contracts hold" has always
been red for a wiring reason, which trains people to ignore it.
Minimum fix: give every step `--root ${CLOSSYS_ROOT:-packages/producer/test-fixtures/consumer}` (as
`check:constitution` does). Treat exit 2 as `could-not-run`, a distinct state from red, and fail the
meta-test when any step reports it. Size S. Pure code.

**P0-3. The scope skills tell agents to run `clossys conform --agent <id>`, which crashes in a consumer.**
Evidence: `packages/designer/actions/designer.scope/skill.md:7` (the director, writer and publisher scope
skills say the same). `conform.ts:24` defaults `repo` to `PRODUCER_ROOT/../..`, which is `node_modules/` in a
consumer. `conform.ts:39` reads `packages/producer/test-fixtures/consumer/clossys`, which is not shipped. Then
`dogfood.ts:305` reads `packages/producer/src/pipeline/runner.ts`, and `model.ts:291` reads
`packages/<agent>`. Reproduced with
`clossys conform --agent designer --repo <dir>/node_modules --consumer <real consumer>`, which gives
`ENOENT ... node_modules/packages/producer/src/pipeline/runner.ts`, exit 2. Even run inside Foundry with no
flags, it judges the synthetic fixture, not the consumer's records. The file header says "Report-only ... no
gate runs it", yet the skills present it as the source of the agent's scope rows.
Why it matters: a low-tier model that follows the SCOPE loop literally hits a crash on its first step.
Minimum fix: split `conform` in two. A consumer mode (`--root` defaults to the cwd's `clossys/`, packages read
from `node_modules/@clossys/<agent>`) runs only the record-level assertions (S*, L*, K*, C*, Q*). Foundry mode
keeps the source probes. Point the scope skills at the consumer mode. Size M. Pure code.

**P0-4. The shipped e2e scenario is stale against the Publisher page standard. The gate stops at the first red.**
Evidence: `check:e2e` gives `e2e.step` at `build`: `publisher.check: 1 page record, 3 findings |
page.no-inline-copy ... page.title: "home.title" is not a Writer ref <writer slot>#<key> | page.record-key
... sections.hero binds no Writer record`. The fixture at fault is `packages/producer/e2e/home.json`. Census
925ae7f failed earlier, at `craft.frame.submit`. Each fold moves the first red one step on and hides
everything after it. There is no mode that lists every red step.
Why it matters: the shipped e2e is the only proof that a fresh consumer releases a page. It has not passed
end to end on this branch.
Minimum fix: rebind `home.json` to Writer refs (`writer/strings.site#…`) and add a `--continue` mode that runs
every remaining step and reports each red one. Size S for the data, S for the mode. Pure data and code.

### P1: wrong or unreliable result

**P1-1. "Enforced" in `scripts/rules/registry.json` means "the check fails on a fixture", not "the tree passes".
Seven rules do not even meet that bar today.**
Evidence: `check:rules` reports `29 rules, 22 enforced by a check that fails on its fixture; failing:
R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION,
R-EVERY-CANDIDATE-PREVIEWABLE`, but every row says `status: "enforced"`. Example:
`node --test packages/producer/scripts/check-pin-propagation.test.mjs` fails on
`publish --install: Publisher has no page slot page.home in ia.json`, a fixture-setup crash, not the drift it
is meant to detect.
Minimum fix: have `check:rules` write `status` itself, as derived evidence (per `docs/LIFECYCLE.md`: state is
derived, never declared), and add a separate "green on main" bit. Size S. Pure code.

**P1-2. Three rule registries with three meanings of "enforced".**
Evidence: `scripts/rules/registry.json` (29 R-* rules, all "enforced"),
`packages/producer/src/constitution/rules.json` (17 rules, 75 checks: 38 enforced, 33 building, 1 warn,
3 pending), and `src/conform/assertions.json` (63 rows, all `status: "building"`). Conform K1 and K3 are
red only because a constitution check is "building" (`assertions.ts:39-45`), so one fact is counted in two
gates.
Minimum fix: one rule table, `{id, owner words, checks, fixture, status derived}`. Conform reads constitution
status instead of restating it, and K1 and K3 become a link, not a cell. Size M. Pure code and data.

**P1-3. A shared, mutable 13 MB fixture couples hundreds of tests. A recut broke about 140 of them.**
Evidence: of the producer suite's 162 failures, 21 need a browser path (`page-lint.test.ts:143`, which
requires `CHROMIUM_PATH`). Most of the rest read `test-fixtures/consumer`, whose Publisher IA is now
`"nodes": []` (`clossys/agents/publisher/ia.json`). Examples: `server/publication.test.ts` 13 failures
(`Missing fixture slot page.home`), `constitution/pin-gate.test.ts` 7, `publish/pinned-publication.test.ts` 4
(ENOENT), `loop/flows.test.ts` 10. 55 producer test files read the fixture and 76 `cpSync` it. Conform reads
the same fixture, so 20 of its 56 red cells are "vacuous": the fixture lacks the data
(Publisher S1 "placed tree 0", Q7 and Q8 for every agent), not the product.
Minimum fix: give each test family a small built-in world (the pattern `conform/__fixtures__/requests-world.ts`
already uses). Freeze `test-fixtures/consumer` behind a `fixture.lock` hash that a test-only verb rewrites, so
a recut has to update its readers in the same commit. Size L, which can be split per directory. Pure code.

**P1-4. Deterministic gates decide on heuristics.**
Evidence: S4 is red for writer on `page.not-found.meta and page.app-not-found.meta: same kind and inputs,
similar purpose (0.75)`. That comes from word Jaccard over slot ids above `OVERLAP_MIN = 0.7`
(`assertions.ts:85,187`). Some probes check source text, not behaviour: `requestVerb` is
`/head === "request"/.test(runner.ts)` (`dogfood.ts:309`); fix raisers come from a regex over every source
file (`requests-model.ts:532`); Q handlers pass when the skill has a `## Requests` heading
(`requests-model.ts:623`). Renaming a variable flips these cells.
Minimum fix: make the id-similarity rows a `finding` (they are already shown as "~ report-only"), not
`rows`. Replace the source-regex probes with calls to the registry or dispatcher (for example, does
`dispatch("request")` resolve). Size S. Pure code.

**P1-5. The skills say "`clossys check` must pass" after a single-slot action. A bare `check` judges the whole consumer.**
Evidence: `designer/actions/designer.candidates/skill.md:8` (likewise for director, writer, publisher,
brief, and producer `ia`, `standard`, `workspace.config`). Bare `clossys check` on the fixture exits 1 in 3 s
on rows like `publisher/page.admin-requests: not placed in the Publisher IA; run clossys init`, which no
candidate step can fix. `producer/skill/SKILL.md:106` says "Each step runs only its own check."
Why it matters: a low-tier model either loops on findings it does not own or learns that "must pass" can be
ignored.
Minimum fix: replace every such line with `clossys check --constitution --slot <agent>/<slot>`, which is the
per-slot preflight that already exists. Size S. Pure data.

**P1-6. Silent skips hide coverage.** 15 `skipIf` and 3 `runIf` in test files. Examples:
`producer/src/constitution/rules/r07.test.ts:51` and `r11.test.ts:57` skip when a repository path is missing;
`specimen/render.test.ts:219` and `specimen.test.ts:63` skip without Chrome; `broken-records.test.ts:246`
skips when the user is root. Other browser tests fail hard instead (`page-lint`). So the same missing browser
skips some tests and fails others.
Minimum fix: one `requiresBrowser()` helper that fails on CI (`CI=true`) and skips locally with a printed
reason, and one CI job with Chromium. Size S.

### P2: cost, speed, polish

**P2-1. The producer suite takes 11.5 minutes, and each package compiles 3–4 times per `check`.**
Evidence: `vitest run` took 11 m 35 s wall, 23 m user, across 1015 files. The top 20 files are 54% of the
summed file time: `cli/init-admin.test.ts` 90 s, `cli/loop.test.ts` 83 s, `pipeline/chain.test.ts` 68 s,
`migrate/slots.test.ts` 62 s. Root `check` runs `build`, then `typecheck` (`tsc --noEmit`), then `test`,
whose `globalSetup` runs `tsc -p` again (`vitest-build-package.mjs:89`). Producer's own `build` also
regenerates derived files and receipts.
Minimum fix: skip the globalSetup `tsc` when `dist/.tsbuildinfo` is newer than `src/` (use `tsc -b`), and drop
the separate root `typecheck` (`build` already typechecks). Move the top 20 files to a `slow` project that
runs only on the per-unit job for the touched package. Size S each.

**P2-2. The Publisher build spends about 8 minutes off-CPU.**
Evidence: `npm run build -w packages/publisher` took real 8 m 27 s but user 0 m 59 s. Most of the wall time
was in `check:client-boundary` (`publisher/package.json:484`), a check that runs inside `build`.
Minimum fix: move it out of `build` into its own `check:` step, cached by input hash in its
`--report` file. Find the cause of the wait (likely git or I/O on a large tree). Size S.

**P2-3. `clossys pipeline check` takes 138 s, because `owner.wiring` runs every owner option (60 options,
122 calls) on a scratch copy.** Cache by hash of the step contracts plus records, or run only the options of
changed steps. Size S.

**P2-4. There is no per-unit gate.** `classify-change-tier` only distinguishes prose from full. A change in
one agent package still runs every package's tests and the 8-shard candidate qualification.
Minimum fix: `npm run gate:unit -- <pkg>...`. It builds the affected set from `build-workspaces.mjs`'s graph
(the package plus its dependents), runs `vitest --changed origin/main` in those packages,
`check:constitution --changed`, `conform --agent <pkg>` (consumer mode), and `check:e2e --from <cached
tarballs>` only when a cohort package changed. Measured parts suggest about 4–6 minutes, against more than
30 minutes for `check`. Size M. Pure code.

**P2-5. E2E verb cost.** 75 steps take 56 s (about 0.75–1.3 s each, mostly CLI startup); pack and install
take about 65 s. Reuse `--from` tarballs keyed by package hash, and offer a `clossys batch <script.json>` that
runs many verbs in one process. Size S each.

## 3. Model steps that should be verbs, and verbs that silently need judgement

Steps a model does today that should be a verb:
- **Placement ledger backfill.** L2 is red for 55 director, 212 designer and 105 writer leaves:
  "placement records no reuse-or-create decision with its overlaps". When an overlap list is empty, the
  decision is mechanically "create". A `clossys ia --record-decisions` verb should write those and leave only
  leaves with overlaps to the model.
- **Gap filing.** Q2: "request.input-unclear ... printed by the interview, no queue entry records it"
  (28 director rows). The interview already computes the gap, so a verb should file the queue entry instead
  of asking the model to file it.
- **Scope rows.** The scope skills ask the model to read `conform` and "report the rest with the exact leaf
  ids". The verb already has the ids; it should print the packet (one choice per suspicious split) for the
  owner.
- **E2E triage.** The census was written by reading the first red step. `check:e2e --continue --json`
  (P0-4) and `check:agents --json` (P0-2) would make that census a verb's output.
- **`K2 no package default, no seed, no createOnly reason`** (57 designer and 60 writer slots). Listing
  candidates for "seed from stock" is deterministic. Only the createOnly reason needs a decision.

Verbs that silently need judgement:
- **S4 similar-purpose** (P1-4): word overlap stands in for meaning. It should be an owner packet, not red.
- **`pin` / `pick` / `verdict` acceptance of uncertified candidates** (probe `pinGate`): when the gate
  accepts, the model's choice decides alone, with no visible "this was judgement" marker.
- **E2E critique**: scores are hard-coded to 4 under `e2e-fixture-critic`. That is correct for a gate, but
  nothing anywhere checks that a real critique pass at low tier yields a usable score distribution.

## 4. Where the skill text and the code disagree

| skill text | code | a literal low-tier model |
|---|---|---|
| `*/actions/*.scope/skill.md:7`: "Read `clossys conform --agent <id>`" | reads Foundry paths; ENOENT in a consumer (P0-3) | crashes on its first step |
| same line: suspicious split "is listed ..., not an error" | `conform` makes S2 and S4 red cells and exits 1 (`run.ts:26`) | treats a report as a blocker |
| `*/actions/*.candidates/skill.md:8`: "`clossys check` must pass" | bare check is whole-consumer and red on unrelated slots (P1-5) | loops or stops |
| `producer/skill/SKILL.md:106`: "Each step runs only its own check" | the action skills name the global check | the two instructions conflict |
| `advisor/skill/SKILL.md:28`: `loop.update` ends with `clossys check`, "whose failure raises queue.fix" | a fresh consumer's bare check fails on admin rows until `clossys init` | the first update files a fix for state the owner never touched |
| e2e passes `--skill packages/designer/actions/designer.candidates/skill.md` | a consumer has `node_modules/@clossys/designer/...`, not `packages/` | copies a path that does not exist |

## 5. Missing or vacuous checks and tests

- **Vacuous by wiring:** `check:agents` (P0-2) is 9 red steps with 0 findings read. Its own test pins step
  ids, not reachability.
- **Vacuous by fixture:** 20 conform cells are red only because the fixture is empty (L4, L5, Q6–Q8, and
  Publisher S1, S3, L2, C4). They stay red whatever the product does, so a real regression in those
  assertions cannot show.
- **Green but proving less than claimed:** 18 of 20 dogfood rows are green while their labels still say
  `RAN-WEAK`, `CANNOT-RUN` or `RAN-FAILED` (`assertions.json` `dogfood[].result`). The label is history, not
  state. Either derive it or drop it.
- **Wrong target:** source-regex probes (`dogfood.ts:309`, `requests-model.ts:532,623`), and K1 and K3
  restating constitution status (P1-2).
- **"Enforced" yet failing its own fixture:** 7 rules (P1-1). `R-DS-ONLY`'s live check exits 2 on its
  fixture, not 1.
- **Failure classes with no check at all:**
  1. a skill command that does not run in a consumer. Nothing executes the commands written in skills; a
     "skill smoke" running each fenced `clossys …` line in the e2e consumer would have caught P0-3 and the
     `--skill packages/…` path;
  2. the Advisor front door and the owner packet round trip (`next --owner`, then `answer`). They are not in
     `E2E_COHORT` (`e2e.ts:52`) and not in `scenario.json`;
  3. low-tier behaviour. `evals/` scores composition only, and no scenario runs a real model on one decide
     step;
  4. upgrade from the previous published version: e2e installs fresh only;
  5. a "could not run" state distinct from red, in `check:agents` and `check:studio`.
- **Duplicates:** CI runs `check:contrast` in two jobs ( `ci.yml:1346` and `:1373`, both
  `npm run check:contrast`); `check:constitution` exists at root and in producer.

## 6. Simplifications

- Drop the separate root `typecheck` step; `build` typechecks. Drop the globalSetup recompile when `dist` is
  fresh (P2-1).
- Merge the three rule registries into one (P1-2). Conform K1 and K3 then go away.
- Remove the `dogfood[].result` and `finding` labels, or generate them from the probe outcome.
- `test-fixtures/consumer-legacy-tree` (5.8 MB, 19 readers) exists only for migration tests of a format
  already migrated. Keep a 10-slot minimal tree instead.
- `check:studio` (104 sub-checks), the root `check` (about 80 steps) and `check:rules`' reachability graph are
  three manifests of "what runs". Keep one manifest (`id, run, kind, tier: unit|full|live`) and generate the
  other two from it.
- `conform`'s `--all` flag is accepted and ignored (`conform.ts:29`). Remove it or make it meaningful.

## 7. Top 5 recommended units, in order

1. **AGENT-GATE-ROOT:** pass `--root` to every `check:agents` step, add a `could-not-run` state that fails the
   meta-test, and add a CI `agent-team` job (e2e, check:agents, constitution `--enforced`, the five
   packages' vitest) required on int branches (P0-1, P0-2).
2. **E2E-GREEN:** rebind `e2e/home.json` to Writer refs, add `check:e2e --continue`, and keep the shipped
   scenario green end to end before any further fold (P0-4).
3. **CONFORM-CONSUMER:** split `clossys conform` into a consumer mode that reads `clossys/` and
   `node_modules/@clossys/*`, and point the scope skills and `check --slot` lines at verbs that run in a
   consumer (P0-3, P1-5).
4. **FIXTURE-WORLDS:** repair the 140 fixture-coupled producer failures by giving each test family a small
   built-in world, and lock `test-fixtures/consumer` by hash (P1-3).
5. **GATE-UNIT:** add `npm run gate:unit -- <pkg>` (affected-set build, `vitest --changed`,
   `constitution --changed`, consumer-mode conform, cached-tarball e2e) with a target under 6 minutes, and
   derive the rule `status` from `check:rules` evidence (P2-4, P1-1).
