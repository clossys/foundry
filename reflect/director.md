# Reflect: Director (packages/director)

Base: `5a2e197ea` (claude/r2f-int2). Serving model: `claude-opus-5-5`. Read-only; no source changed.

Method: read the skill, every `actions/*/skill.md` and `action.json`, the five loops, both recipes,
the CLI (`src/cli.ts`, `src/cli/*`), checks (`src/checks/*`), catalog data and the tests. Then drove a
fresh consumer: `git init`, the workspace `node_modules` linked in (not a tarball install), `clossys` =
`node packages/producer/dist/cli/index.js`. Every claim below marked "ran" was run there; `<consumer>`
is that scratch repo.

## 1. What exists and works

- Catalog: 55 L3 cells, 9 L1 / 27 L2 / 3 L0 in `src/catalog/ia/strategy.json`; questions and
  must-contain keys in `src/catalog/cells/strategy.json`; archetype cores in
  `src/catalog/archetypes.json` (default 24, product-saas 27, services 27, marketplace 29).
- `clossys ia director --adopt` places all 55 slots with contracts (ran: "9 L1, 55 slots").
- Archetype record: `clossys director check archetype <name> --by owner --via chat --quote ...`
  writes `evidence/director/director-archetype.md`; `status`/`complete` pick it up without
  `--archetype` (ran: MVS 0/24 became 0/27 after recording product-saas). `src/cli/archetype.ts`.
- Deterministic cell checks Q1–Q7 and coherence C1–C3 (`src/checks/quality.ts`, `coherence.ts`),
  completion levels (`src/checks/completion.ts`), brief compile/handoff (`src/cli/brief.ts`),
  judgement recording bound to pinned versions (`src/cli/judge.ts`), grounding and won't-claim scans
  (`src/cli.ts`). Exit codes 0/1/2 are consistent.
- Owner packet for the archetype and per-cell picks: `clossys next --owner --agent director --json`
  emits ready argv (ran).
- An owner pin does work end to end, but only via Producer's loop:
  `clossys loop director/loop.choose` → `clossys run loop.choose --slot director/<id>` → `clossys answer
  queue.pick#<id> <cand>.md --by owner --via chat --quote ...` → `run --resume` (ran: pin.json basis
  `picked`, `decidedBy owner:queue.pick#...`).
- Tests: 39 files, 753 pass, 1 fail (`npx vitest run` in packages/director; see §5).

## 2. Gaps

### P0 — blocks a consumer finishing the flow

**P0-1. The skill's create path cannot submit a cell; the real path is 9 verbs and 4 model-written JSON files, undocumented.**
Evidence (ran, `context.customer.need`): skill Loop step 6 `clossys next director/<id> --submit ...
--rung create` → `refused: rung create ... needs the slot's latest verdict to be create`. After
`clossys verdict` → `refused by the constitution guard: R15.7 craft events (none) are not brief,
diverge, render, critique...`. Success needed: verdict, craft brief, craft diverge, (draft check),
craft render, critique-packet, critique --record, craft refine, craft render, critique --record,
submit. The skill mentions CREATE in one sentence (`skill/SKILL.md:84-87`) with no commands; the
verdict JSON shape is in Producer's `pipeline/schemas/verdict.schema.json` only.
Why: a low-tier model following the skill stops at step 6 on the first cell; 24–29 core cells × ~10
calls is the main token cost of the whole Director.
Fix: one verb `clossys direct draft director/<id> --file <cand.md> --model --tier` that, for a
`createOnly` standard (all four Director standards are, `standards/*/requirements.json`), records the
create verdict, brief, a single-direction diverge/render and submits; keep critique optional for
interview-sourced cells. Size M. Pure code (a policy call by the owner on whether interview cells need
3 directions — see P1-2).

**P0-2. The skill's pin command is refused, and no consumer verb creates the queue entry it cites.**
Evidence (ran): `clossys pin director/context.customer.need need-v1 --by owner --basis picked`
(template `skill/templates/cell.md:44,98`) → `need-v1 is not a candidate file name`;
`clossys pin ... need-v1.md --basis picked --by owner:queue.pick#abc` (skill `SKILL.md:194`) → `names
no queue answer`. `ownerEntry()` is called only from `producer/src/pipeline/owner-wiring.ts:79-81` and
`conform/dogfood.ts:212` (scratch copies). The only working path is `run loop.choose` + `answer`
(§1), which neither the Director skill nor the packet's `--by <queue-answer>` option names.
Fix: skill Loop step 9 and the template must say `clossys run loop.choose --slot director/<id>`, then
`clossys answer <entry> <cand>.md --by owner --via chat --quote "<words>"`, then `--resume`; or make
`clossys answer` open-and-close a queue.pick for a director slot in one call. Size S (text) / M (verb).
Pure code.

**P0-3. Adopting Director's loops (needed for P0-2 and for conform W2) makes `clossys direct` fail.**
Evidence (ran): after `clossys loop director/loop.choose`, `clossys direct` → `unreadable:
clossys/agents/director/loop.scope/candidates/scope-v1.json: expected frontmatter opening ---` (×5),
exit 1; `clossys direct --check` → `could not run in full`. The loop slots live in the same flat
folder as strategy cells and the `direct` reader treats every folder as a cell.
Fix: the `direct` reader filters to ids in `ia.json`/catalog leaves (as `director check status`
already does — it stays green). Size S. Pure code.

**P0-4. Owner words recorded by the packet's own option cannot be cited by `judge --heard`, so MVS is unreachable by the documented path.**
Evidence (ran): packet option `clossys evidence <id> --source owner ...` wrote `source: owner`;
`clossys director check judge Q3:context.customer.need@1 ... --heard owner-segment-2026-11-23` →
`expected the owner's words (source: user ...)` (`src/cli/judge.ts:73`). `source: owner` is silently
accepted as a *repository path* by `src/format/finding.ts:6-11`. MVS needs a C4 verdict with
`--heard` (`src/checks/completion.ts`, storyline.clean).
Fix: one owner-source token everywhere (`user` or `owner`), reject unknown bare words in
`source()`. Size S. Pure code.

**P0-5. `director check` runs are not traced in a fresh consumer, so a cell judgement has no run to cite.**
Evidence (ran): after several `clossys director check ...` runs, `clossys/.state/runs/` held no
`director.store.jsonl`; `clossys pipeline trace director.store -- ...` → `not recorded: .gitignore
does not ignore /clossys/.state/runs/`. `config --init` does not write that line. Skill
`SKILL.md:303-304` says every run "is already traced".
Fix: `config --init` appends the ignore line (or the tracer stops requiring it). Size S. Pure code.

**P0-6. The recipe render step is refused for Director.**
Evidence (ran): `clossys render context.customer.need --draft need.md` (recipe
`recipes/create.statement/craft.md` §3) → `--draft renders a Designer craft direction; it needs a
designer/<slot-id> ref`. The render stage then accepts any hand-written `renders.json` (see §5).
Fix: drop render for text briefs (the draft *is* the render) or let `render director/<id> --draft`
emit the text specimen. Size S. Pure code.

### P1 — wrong or unreliable result

**P1-1. Recipe critique stage double-records and can wedge a slot.**
`craft.md` §4 runs `clossys critique --record` then `clossys next --stage critique`. Ran: after
`critique --record`, `next --stage critique` → `the next stage is not critique`. Run in the other
order, the stage is recorded with no `critiques/<cand>.json`, submit is refused (`R15.7 no critique
record`) and the only way out is a refine round. Fix: delete the second command from both recipes. S.

**P1-2. Diverge forces three fabricated directions for a cell the owner already answered.**
Ran: three directions sharing `evidence: "owner words"` → `R15.7 directions repeat a value on axis
evidence: cosmetic variants`. With one owner finding, the model must invent distinct "evidence" values
to pass. This contradicts "never record your own opinion ... as a finding" (`SKILL.md:101-102`).
Fix: for the interview path, allow one direction when the source is a single owner finding. S. Needs
an owner decision on the policy.

**P1-3. Recipes say derive from "pinned Director slots and recorded findings only ... never an owner
note"** (`recipes/create.statement/craft.md`, Director derivation) **while the skill makes owner
findings the primary source.** The assembled craft brief had `"inputs": []` for a root cell (ran,
ledger `craft:brief` event): owner findings never reach the brief. Fix: brief assembly includes
findings whose `Informs:` names the slot. S. Pure code.

**P1-4. Pre-submit preflight is always red for a new slot.**
Ran: `clossys check --constitution --slot director/context.customer.need` → `R04 ... no candidate;
no pin.json`, exit 1. The recipe says a failing preflight must be fixed before submit; it cannot be.
Fix: preflight skips R04 for a slot with a pending submit. S.

**P1-5. `cell <l1> --verb unlock` reports zero cells for 4 of 9 L1s.**
`src/cli/checks.ts:106` filters `cell.id.startsWith(`${id}.`)`, but ids no longer carry their L1
(`targets`, `timeline`, `task-force`, `plan` hold `aspiration.goal.*`, `execution.*`,
`capability.*`). Ran: `cell targets --verb unlock` → `{"unlocked":false,"n":0}`; `cell task-force`
→ `{"unlocked":true,"n":0}`. Fix: take members from `ia.json` nodes. S. Pure code.

**P1-6. An L1 with no core cells reads "unlocked" on an empty strategy.**
Ran on a fresh consumer: `MVS 0/24 · L1 unlocked 1/9 (Task force)`. `every()` over an empty list
(`completion.ts`, `l1` map). The skill tells the model to report unlocked groups. Fix: an L1 with no
selected core members is "n/a", not unlocked. S.

**P1-7. `run loop.choose` reports a failed step with exit 0.**
Ran: `run --resume` → `stopped: step cascade failed`, exit 0; ledger `checks.refs.dangling: "fail"`
right after the first pin of an otherwise empty strategy. A model reading exit codes thinks it passed.
Fix: non-zero exit on a stopped run; diagnose why `refs.dangling` fails on the first pin. S–M.

**P1-8. The Q6 "gives something up" hard check is satisfied by any `over`, `no` or `only`.**
`src/checks/quality.ts:91` with `lexicon.tradeOffMarkers` = over/not/no/only/... matched as words
anywhere: "Job: serve over 40 members" passes. Fix: count markers only at bullet start or in
`X over Y` / `rather than` shape, or require a negative key. S.

**P1-9. Starter templates do not match the core.**
`SKILL.md:31-34` says the 24 starter slots ship a template; `src/catalog/defaults/` holds 24 folders,
but 10 default-core cells have none (need, alternative, vision, long-term, differentiator, pricing,
delivery, north-star, bet...) and 8 non-core cells do (`comm` of `defaults/` vs `archetypes.default`).
The templates are empty key stubs in a second frontmatter format (`clossys:` block) unlike the
candidate format in `skill/templates/cell.md` (`slot:`/`source:`). They are not seeds (all Director
standards `seeds: []`), so the adopt rung can never use them. Fix: drop them or regenerate one per core
cell from the catalog. S. Pure data.

**P1-10. `brief:<key>` gap ids are refused though the error says they are accepted.**
Ran: verdict gap `brief:Job` (a mustContain key) → `not a taste criterion or requirement ... nor
brief:<key> of the slot contract`; only `brief.keys` (a requirement id) passed. Fix in Producer's
verdict guard. S.

**P1-11. pick.director pass command is a monorepo path.**
`actions/pick.director/action.json` `pass.command`: `node ../producer/scripts/check-slot-options.mjs`
— resolves only inside this repo. Fix: a `clossys check --slot-options` verb. S.

### P2 — cost, speed, polish

- **P2-1.** Craft tiers: `brief.statement` `craftTier: high`, others `mid`
  (`standards/*/requirements.json`); `loop.choose` agent pick `tier: mid`. The goal is low tier.
  Director cells are short bullets from owner words; the tier should be low with code checks. Owner
  decision.
- **P2-2.** Owner packet labels carry raw ids ("product-saas: adds focus.lifecycle.retention,
  capability.sourcing.build, ...") against `SKILL.md:133-134` (no ids), offer four archetype options
  against "two or three", and `--quote` is pre-filled with the option label, so the "verbatim words"
  are machine text. Pick rounds offer one candidate plus "draft another" (ran). S.
- **P2-3.** `director check review` prints JSON without `--json` (ran). S.
- **P2-4.** `clossys director check archetype|judge` are writers under a verb named `check`;
  `director.store` is a `plumb` action that writes evidence. Rename to `clossys direct archetype|judge`.
  S.
- **P2-5.** `director.cascade` impact step is a model writing `scratch/impact.md` that nothing reads
  (`actions/director.cascade/skill.md`); code already has the re-verdicts. Make it a code summary. S.
- **P2-6.** Exemplars: 2 per standard (K1 red, needs 5–12), and they are process guides (SRE SLOs, a
  government playbook), one `proprietary (link only)`; none is a strategy cell. Low value to a critic.
  Data, owner decision.

## 3. Model work that should be a verb; verbs that hide judgement

Should be verbs (deterministic today, done by the model):
- **Nearest unlock scoring** (`SKILL.md:207-241`): seven point rules, a tie-break path, extras
  placement and required links — all computable from the catalog, pins and requests. A model re-derives
  it every turn. Make `clossys director check next` return the top cell and reason. M.
- **Create verdict for createOnly standards**: always `create` with gap `brief.keys`; the model writes
  JSON for it per slot. Code should record it.
- **Craft brief JSON** (`craft.md` §1): `craft brief` without `--file` already assembles it (ran); the
  recipe still tells the model to hand-write `brief.json` with shas.
- **renders.json** (`craft.md` §3): shas of files the CLI could hash itself.
- **critique.json packet block**: the model copies `manifest` and `sha256` from `critique-packet
  --json`; the record verb should bind it.
- **Owner-words finding file**: the skill has the model write frontmatter by hand (`SKILL.md:93-97`);
  `clossys evidence` exists but writes a different `source` (P0-4).
- **`Informs:` routing** from the routing table (`SKILL.md:243-266`) is partly lexical; at least
  validate `Informs:` ids against the catalog in code (today an unknown id is silently accepted).
- **Progress line** (`SKILL.md:311-323`): `status` already prints it; the skill asks the model to
  compose it.
- **Cascade impact note** (P2-5).

Verbs that silently need judgement:
- `director check check` exits 0 with Q2, Q3, Q4, Q6 "judge: not judged" (ran). The skill's step 7
  "fix every finding" treats it as a gate; it never judges whether evidence supports a Because bullet.
- `director check judge C4 --verdict pass` accepts any model's word; `source: user, by: critic` is
  written for a model verdict (`src/cli/judge.ts` `judgeRecord`). Nothing proves a fresh context ran.
- `clossys critique` independence is a different `--model` string (ran with `m` and `m2`).

## 4. Skill text vs code (a literal low-tier model fails)

| Skill / doc says | Code does | Evidence |
|---|---|---|
| submit with `--rung create` after drafting (`SKILL.md:178`) | needs verdict + 5 craft stages | P0-1 |
| `pin director/<id> <name>-v<N> --by owner:queue.pick#<entry id>` (`SKILL.md:194`) | needs `.md` suffix and an entry only `run loop.choose` creates | P0-2 |
| template: `pin ... --by owner --basis picked` (`templates/cell.md:44,98`) | refused; skill test forbids `--basis picked` | P0-2, `src/skill.test.ts:33` |
| owner finding `source: user` (`SKILL.md:94`) | packet writes `source: owner` | P0-4 |
| every `director check` run is traced (`SKILL.md:303`) | not without a `.gitignore` line | P0-5 |
| "Four verbs", refine-brief = `actions/director.store/` (`SKILL.md:20-28`) | `director.store` runs `clossys director check <command>`; refine-brief skill is `actions/director.brief/skill.md` (no action.json); 7 action folders | `actions/director.store/action.json` |
| "Cell ids ... contracts.json names the question and must-contain keys" (`SKILL.md:55-58`) | `contracts.json` slots carry no question/mustContain; those are in `catalog/cells/strategy.json` and copied into `slot.json` | jq of both |
| 24 starter slots ship a template (`SKILL.md:31`) | 10 core cells have none | P1-9 |
| "Pass `--archetype` on status and complete as well" (`SKILL.md:152`) | the record is read automatically; the flag only overrides | ran |
| owner chooses with 2–3 options, no ids (`SKILL.md:116-134`) | archetype packet: 4 options, ids in labels | P2-2 |
| candidates skill ladder: "stock shadcn, a trusted free registry item" (`actions/director.candidates/skill.md`) | Director has no seeds; text copied from Designer | file |
| candidates skill: raise requests to other agents | `conform.json` `requests.issuing: []` refuses every one | conform Q6 vacuous |
| loop.create step `create` = `clossys next <ref> --submit <file>` | refused without verdict + craft | `loops/loop.create/create-v1.json` |
| recipe §4 two critique commands | second always refused | P1-1 |
| recipe §3 `clossys render <slot> --draft` | refused for director | P0-6 |
| template worked example cites `context.customer.need` (no `@N`) while the rule says cite `<cell-id>@<N>` | both resolve, but the doc contradicts itself | `templates/cell.md:30,58` |

## 5. Missing or vacuous checks and tests

- `src/skill.test.ts:31` asserts the skill *contains*
  `npx clossys pin director/<id> <name>-v<N> --by owner:queue.pick#<entry id>` — a command that is
  refused (P0-2). The whole file is regex-on-prose; no test runs a skill command against a consumer.
- `src/format/format.test.ts:59` fails on this head: the template's worked example was reworded
  ("Candidate `studio-segment-core-v2.md` in the ... slot's `candidates/` folder") and the regex no
  longer finds the file name. Red test merged into int2.
- `recipes/recipes.test.mjs` runs against `packages/producer/test-fixtures/consumer` and monorepo
  paths (`ROOT/packages/...`), never an installed package; it did not catch P0-6 or P1-1.
- Conform dogfood rows are green while their labels record failures:
  `DF.director.CREATE "RAN-FAILED critique-packet reads the monorepo standards path"`,
  `DF.director.CHOOSE "RAN-WEAK the skill pin verb is refused; pin accepts a non-qualifying
  candidate"`, `DF.director.CASCADE "RAN-WEAK a bad pin still compiles; dependents are not marked
  stale"` — all `red: false` (`conform --all --json`). Ran confirms the first: critique-packet manifest
  refs `packages/director/standards/brief.profile/taste.md`, absent in a consumer.
- `craft render` accepts a `renders.json` naming any path and sha (ran: a path outside the slot,
  never rendered). `craft critique` stage accepted a stage event with no critique record (ran).
- Q2/Q3/Q4/Q6 judge rules never block, and nothing in completion requires them to be judged:
  `MVS 1/27` counted a cell whose evidence-support was "not judged" (ran).
- C4 judge requires no run citation; a cell judge's `--run` may cite a `director check check` run that
  itself printed "not judged" — provenance proves a command ran, not that a judge read anything.
- Conform director reds (census and ran): L2 (55 rows), K1, K4 (no recipe fixture output), Q2 (28
  printed-only gaps), W2 (loops not held), and vacuous L4, L5, Q6, Q7, Q8 — five of ten reds are
  "nothing to judge".
- No test covers `source()` rejecting bare words (P0-4), the `--verb unlock` membership (P1-5), or an
  empty-L1 unlock (P1-6).

## 6. Simplifications

- `docs/v2/` (SPEC 832 lines, SKILL 470, `catalog/tree.json` 2834, a second `templates/cell.md` kept
  byte-compatible by a test): an unshipped draft parallel to the live skill
  (`actions/exceptions.json`). Delete or fold in; it doubles every wording change.
- `src/format/session.ts` and its export: the skill says "There is no session log"; nothing writes
  one.
- `RETIRED_WRITE_COMMANDS` and the positional `director check <strategy-dir> <scan-dir>` /
  `handoff <path>` legacy forms in `src/cli.ts` and `isReadCommand`: dead 0.6 compatibility.
- Three overlapping cell-data files: `catalog/cells/strategy.json` (question, keys),
  `slot-contracts/contracts.json` (2337 lines, purpose/limits/feeds), `catalog/ia/strategy.json`
  (placement), plus `catalog/ia/tree.ts`, `slot-defaults.json`, `specificity.json`. One catalog file
  per cell would remove the drift in §4 row 7.
- `catalog/defaults/*/template-v1.md` (P1-9): empty stubs in a second candidate format; remove.
- `actions/director.check` and `director.store` both run `clossys direct`-family read checks; one
  action suffices.
- The craft recipe's diverge/render/refine for one-paragraph text briefs (P0-1/P1-2): for Director,
  verdict → draft → certify covers what the checks actually judge.
- `cell <id> --verb create|cohere|unlock|normalize` duplicates `check`, `cohere`, `status`; the verb
  must match the id shape anyway, so the flag carries no information.

## 7. Top 5 recommended units

1. Ship one Director draft verb (`clossys direct draft`) that records the createOnly verdict and the
   single-direction craft events and submits, and rewrite skill Loop steps 6–9 and both recipes to the
   commands that actually run in a fresh consumer (P0-1, P0-6, P1-1, P1-2, P1-4).
2. Make the owner pin one documented path — `run loop.choose` → `answer` → `--resume` (or an
   `answer` that opens and closes the queue.pick) — and fix the template, packet `<queue-answer>` and
   `skill.test.ts` to it (P0-2, P1-7).
3. Unify owner evidence (`source: user` from `clossys evidence`, reject bare-word sources) and have
   `config --init` ignore `clossys/.state/runs/` so `judge --heard/--run` and MVS are reachable
   (P0-4, P0-5).
4. Filter loop slots out of the `direct` reader and take L1/L2 membership from `ia.json` in
   `cell --verb` and the unlock rule (P0-3, P1-5, P1-6).
5. Add one installed-consumer e2e for Director (adopt → archetype → evidence → draft → pin →
   status/complete → brief/handoff) that replaces the regex skill tests and turns the green-but-failing
   dogfood rows red (§5).
