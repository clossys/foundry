# Reflect: Writer (packages/writer)

Read-only reflection at `5a2e197ea` (branch `claude/r2f-int2`). Serving model: `claude-opus-5-5`.
Method: built all seven packages, ran `conform --all --json`, ran `npx vitest run` in `packages/writer`,
and walked the Writer loop in a fresh scratch consumer (`git init`, `clossys config --init`,
`clossys ia <agent> --adopt` for director, designer, writer and publisher). Commands and output are quoted
below. The consumer had no Director pins, so the trace stops at the first gate that needs them; anything
past that point is reasoned from code and labelled that way.

## 1. What exists and works

- **IA adopt.** `clossys ia writer --adopt` places 73 slots with contracts: 37 `string`, 22 `passage`,
  2 `copy.headline`, 12 lexicon. It prints `6 L1, 73 slots ... 33 package leaves no publication reaches
  stay in the package`. Trees and freezes are in `src/catalog/ia/{voice,prose,copy}.json` and
  `*.leaf-freeze.json`.
- **Copy-slot derivation.** `src/derive/copy.ts` projects Designer `copy.fields` and Publisher pages
  into `<unit>.copy`, `page.<id>.meta` and `publication.<id>.meta` slots. The fields reach `slot.json`,
  e.g. `frames.site-header.copy`: `skip.label`, `navigation.label`, ...
- **Read-only verbs.**
  - `clossys write --brief` returns `missingInputs` and `obligations` as JSON.
  - `clossys write --check` exits 2 with `director-input-missing` rows when nothing is pinned.
  - `clossys gaps --agent writer` lists 73 `open.writer.candidates` and 73 `open.pin.writer`.
- **The submit guard enforces real things.** It refuses a bad name (R08.1), a missing verdict (P2), a
  missing `reason`/`provenance` (R20.2, `copy.voice-derived`), missing fixture keys (R05.1), and missing
  craft events or a critique (R15.7).
- **Criteria** live in producer `src/constitution/criteria/writer/st-w/copy.ts` and
  `criteria/core/{text,lexicon}.ts`. The writer-slots suite is `src/slot-contracts/checks.ts`,
  reached through producer `check/record-suites.ts:114`.
- **Package data.** 12 lexicon defaults (v1 retired, v2 current) and 32 page/publication meta defaults
  under `defaults/`. 9 standards under `standards/`, 3 recipes, 5 loop candidates under `loops/`.
- **Conform.** Of the writer cells, 23 are green, among them C1–C4, X1–X4, W1, Q1, Q3–Q6 and Q9–Q11.

## 2. Gaps

### P0: blocks a consumer from finishing the flow

**P0-1. Shipped Writer defaults cannot be adopted through the submit verb.**
- Evidence: `clossys next writer/page.home.meta --submit home.meta-v1.json ... --rung adopt` fails with
  `fails schema candidate-strings: / requires slot; / requires locales; / requires source; / has unknown key clossys; / has unknown key content`.
  `formality-v2.json` on `lexicon.formality` fails the same way.
- A seed of `package:home.meta-v1.json` is refused by R03.2 (`names no candidate (<slot>/<candidate>...)`).
- `loop.create`'s code `adopt` step covers only Designer components (`loops/loop.create/create-v1.json`, step `adopt`).
- Why it matters: 44 slots ship a default (12 lexicon, 32 meta), yet each one must be re-authored by a
  model through the full P2 craft. Under the "adopt first" ladder this should be the cheapest path; today
  it is unreachable.
- Minimum fix:
  - Make `adopt` accept a `writer/<slot>/package:<file>` seed and convert the candidate/1 JSON to the
    candidate-strings form deterministically.
  - Or ship the defaults in candidate-strings Markdown and let code `settle adopt` Writer system slots
    (`family.class writer.system`, options 1).
- Size: M. Pure code/data.

**P0-2. The P2 craft path a Writer create must take has no Writer render.**
- Evidence: submit at `--rung create` is refused with
  `R15.7 craft events (none) are not brief, diverge, render, critique...` and
  `no critique record critiques/meta-v1.json`.
- The recipe's render stage (`recipes/create.copy/craft.md` §3) says `clossys render <slot> --draft`, but
  `clossys render writer/page.home.meta --draft hm.md` fails with
  `--draft renders a Designer craft direction; it needs a designer/<slot-id> ref`
  (`producer/src/specimen/render.ts:362`).
- `--rung adapt` is refused with the same P2 verdict rule, so `adapt` gives no way around it either.
- Not traced past `craft brief`: that step refuses while the 18 inputs are unpinned. Whether
  `next --stage render` accepts a hand-made `renders.json` is not proven either way.
- Why it matters: every Writer create (all 73 slots, 3 options for `sections.hero.copy`) depends on a
  render verb that refuses Writer.
- Minimum fix: add a Writer draft render (Markdown → `dl`/card HTML; the standards already declare
  `preview.card.mustContain`), or exempt `writer.system` slots from render+critique.
- Size: M. Pure code.

**P0-3. The skill's record format fails the certifier.**
- Evidence:
  - `skill/SKILL.md:60-66` shows `### Home hero heading` with `"id":"home.hero.heading"` and says only
    `slot`, `locales` and `source` may appear in the frontmatter.
  - `clossys recipe check create.copy draft page.home.meta hm.md` reports
    `copy.entries: en Home title meta id is "title", not the key -- fix: set the meta id to "Home title"`.
    The heading must equal the id.
  - The submit guard requires the frontmatter `reason` (R20.2) and `provenance` (`copy.voice-derived`).
  - The fixture keys are the contract's field keys (`title`, `description`; `header.heading` for hero),
    not `<page>.<section>.<key>`.
- Why it matters: a low-tier model following SKILL.md literally fails 3 to 5 guards on every slot (see §4).
- Minimum fix: rewrite SKILL.md loop steps 3–4 and the example from the guard, and add a
  `clossys recipe check` call before submit.
- Size: S. Data/doc only.

**P0-4. `copy.json` is stale and the package test suite is red, and no gate catches either.**
- Evidence:
  - `node dist/derive/cli.js --check` fails with `writer derive: src/catalog/ia/copy.json is stale`.
    The diff is `components.media-player.copy`, 169 lines.
  - Conform S1 says `package tree has 106 leaves, the placed tree 105`.
  - `npx vitest run` gives 13/97 files and 23 tests failed. The failures include derive, the
    retired-references test (9 live reads of retired ids), `slot-contracts.test.ts` and
    `slot-suite.test.ts` (crashes on `join(undefined)`).
  - `derive --check` and `checkRetiredReferences` are called by no build or CI script.
- Why it matters: consumers adopt a tree that disagrees with the Designer catalog. Every downstream
  count and contract is suspect.
- Minimum fix: regenerate `copy.json`, fix the 9 retired reads, and wire `derive --check` and
  retired-references into `npm run build` or `check:generated-derived`.
- Size: S. Pure code/data.

### P1: wrong or unreliable result

**P1-1. Pinned Voice slots never reach copy checks.**
- Evidence:
  - `lexicon.clean` (`producer/src/constitution/criteria/core/lexicon.ts:13`) reads only `params.avoid`
    plus a hardcoded `FILLER` list.
  - `sections.hero.copy` lists `{check: "lexicon.clean"}` with no params.
  - No criterion reads `writer/lexicon.avoid-terms`, `preferred-terms`, `capitalization` or
    `sentence-length` pins. Grepping producer and writer src finds only `specimen/writer-specimen-kinds.ts:72`.
  - The 12 lexicon slots are inputs on every copy slot (`derive/copy.ts:43`) but are never enforced.
- Why it matters: consistency is the product goal. Voice is decorative today, and the SKILL claim
  "Prose and Copy read style only through the Voice slots" is unenforced.
- Minimum fix: in certify, build `lexicon.clean` / `lexicon.terms` / `copy.sentence-case` params from the
  resolved lexicon pins of the slot's inputs.
- Size: M. Pure code.

**P1-2. The measurable lexicon shape is not what the certifier checks.**
- Evidence:
  - `formality-v2.json` `content` is `{"byLocale":{"en":{"register":"neutral","address":"informal-you","contractions":true}}}`.
  - The standard requires `lexicon.record` with `kinds:["voice-rule"]`
    (`standards/lexicon.voice-rule/requirements.json`). That is a Markdown entry holding a json record of
    `{kind, rule, value, forbidden}` (`src/model/types.ts:22`).
  - No check named `voice.formality` exists. The contract's `"check": "address deterministic; register owner rubric"` is prose.
- Why it matters: the default shape and the consumer shape differ, so adopting a default can never
  certify as-is, and `register` has no rubric anywhere.
- Minimum fix: choose one shape per lexicon slot, and validate `contract.shape` with a registered criterion.
- Size: M. Needs a model/owner decision on the shape, then code.

**P1-3. Two resolvers disagree on which default is the sample.**
- Evidence:
  - `resolveSlot(root,"writer","lexicon.formality")` returns `sample formality-v1.json`.
    `packageDefaults` keeps `version === 1` only (`producer/src/records/resolve.ts:91`), so it picks the
    retired v1 with the prose `rule`.
  - `clossys slot writer/lexicon.formality --json` shows `formality-v2.json` (`read/slot.ts:271`, last default).
  - `narratives.legal-document` resolves to `unresolved: 2 package defaults (privacy-v1.md, terms-v1.md)`.
- Why it matters: Studio shows v2 while anything using `resolveSlot` (publish, cascade) uses the retired v1.
- Minimum fix: skip `status: retired` and take the highest version in one shared function. Alternatively,
  stop shipping the retired v1 files (§6).
- Size: S. Pure code.

**P1-4. The skill's "TODO-OWNER" instruction guarantees a failure.**
- Evidence: `SKILL.md:85,168` say to leave `TODO-OWNER`. `text.no-placeholder` (`criteria/core/text.ts:90`)
  matches `\bTODO\b`, and `TODO-OWNER` matches it.
- Minimum fix: represent a missing fact as a Director slot request (`clossys request --kind slot`) and
  not as text.
- Size: S. Doc plus a guard message.

**P1-5. Checks that pass on nothing** (detail in §5).
- `check --suites` skips unpinned Writer slots (`record-suites.ts:120`) and reports `ran` with `checked: 0`.
- `writer-check slots --strict` on an empty directory exits 0.
- Voice-derivation coverage in `write --check` runs only `if (mapped.length)` (`producer/src/cli/write.ts:141`),
  so a consumer that declares nothing passes.
- Minimum fix: zero evidence is red (the conform cells already use this rule).
- Size: S. Pure code.

**P1-6. Length limits are skipped when `context` does not end in a field key.**
- `slot-contracts/checks.ts:368` (`rowField`) needs `context` to end in a field key, or W-LEN and W-ROOM
  are skipped.
- 39 narrative and lexicon contracts have `limits.fields: {}`.
- W-CLAIM is cleared by `claim: ""` (`checks.ts:252`).
- Minimum fix: key limits off the record id (which the certifier forces to equal the field key), and
  resolve claim refs.
- Size: S. Pure code.

**P1-7. `write --brief` is not the brief the skill describes.**
- SKILL.md step 2 says it prints "brand essence, voice, audience, position, wont-claim with slot ids and versions".
- The output keys are `schemaVersion, agent, directorInputs, leaves, missingInputs, obligations`, and it
  exits 0 with `directorInputs: []`.
- Separately, `clossys brief writer/<slot> --json` is the per-slot brief the recipe actually needs.
- Minimum fix: document `clossys brief writer/<slot>` as the read, and make `write --brief` exit 1 when
  `missingInputs` is non-empty.
- Size: S.

**P1-8. Conform red cells owned by Writer data.**
- S4: `page.not-found.meta` and `page.app-not-found.meta` overlap at 0.75.
- L2: 105 placements record no reuse-or-create.
- L5: the fixed `VOICE_INPUTS`/`DIRECTOR_INPUTS` lists (`derive/copy.ts:43-50`).
- K2: 60 live slots have no default, seed or `createOnly` reason (narratives, most section copy).
- K4: no recipe ships a fixture output.
- Q2: 19 Director `input-unclear` needs are printed but never queued.
- K1/K3 are blocked on producer enforcement; W2 needs `clossys loop writer/loop.*`, which the skill never mentions.
- Minimum fix: one data unit for S4/L2/L5/K2/K4, plus a producer unit for Q2.
- Size: M. Mostly data; the S4 merge-or-keep is an owner decision.

**P1-9. A consumer with a `packages/` directory resolves skill paths locally.**
- `producer/src/package-path.ts:33`: `if (existsSync(join(root, "packages"))) return local;`.
- Every Writer skill path is `packages/writer/actions/...` (`conform.json` `skills`, the loops, the recipes).
- In a consumer monorepo that has `packages/`, the skill hash and packet `file` point at a missing file.
- Inferred from the code; not run in a consumer that has `packages/`.
- Minimum fix: detect the Foundry checkout by its root manifest name, not by the directory.
- Size: S. Pure code (producer).

### P2: cost, speed, polish

**P2-1. Full P2 craft for single-option system slots.**
- 37 `string` slots plus 12 lexicon are `family.options: 1`, `class: writer.system`, yet each needs a
  verdict, brief, diverge (3–4 directions), render, a fresh-critic critique and submit.
- That is about 6 model calls per meta title. The recipe brief alone (`recipes/create.copy/craft.md` §1)
  requires restating every requirement id and input sha, which code already has.
- Fix: a `writer.system` plumb recipe (fill from defaults plus the Director name) with one judge pass.
- Size: M.

**P2-2. Redundant reads in the skill.**
- Loop step 1 has the model read Designer candidates for `reads.copyKeys` and Publisher candidates for
  mounts. The Writer slot's `contract.copy.fields` and `clossys brief writer/<slot>` already list the keys.
- Fix: delete step 1 and point at `clossys brief`.
- Size: S.

**P2-3. Declarations need hand-written Node.**
- Step 6 asks the model to hand-write the `aliases`/`sections` JSON and a `node --input-type=module -e`
  call into `writeWriterDeclarations`.
- Everything in it is derivable from pins: the Publisher page `copy` cells, `slots[].config`, and the
  pinned record ids.
- Fix: `clossys write --declare [--check]`.
- Size: M. Pure code.

**P2-4. Test suite cost.** 32 s for 1656 tests. `recipes/recipes.test.mjs` (25 tests) never runs,
because `vitest.config.ts:17` includes only `src/**`.

**P2-5. Package weight.** `files` ships `src` including `src/catalog/records/pending/`, retired v1
defaults, and a 2263-line `approval-bypass.ts` (§6).

## 3. Model steps that should be verbs, and verbs that silently need judgement

Should be verbs (zero tokens):

- Listing copy keys per page (SKILL step 1). Already `contract.copy.fields`; `clossys brief writer/<slot>`.
- Writing `declarations.json` (step 6). `clossys write --declare` from pins.
- Writing frontmatter `source.ref`, `reason`, `provenance` and the meta comment. All are fixed or derived
  from slot inputs and record keys. A `clossys write --scaffold writer/<slot>` could emit the skeleton
  with ids equal to keys, leaving only the text lines to the model.
- Recipe `brief.json` (`requirements`, `inputs` with sha256, `tasteLog`). `clossys craft brief` already
  "assembles the pinned inputs"; the craft.md still asks the model to write it.
- Adopting package defaults (P0-1), and the `verdict create` for a slot with no candidate. The verdict is
  always `create` with gap `copy.entries`, yet the model must hand-write
  `{"schema":"clossys.verdict/1",...,"gaps":[{"id":...}]}`. My first attempt was refused with
  `must match exactly one of oneOf`.
- `writer.scope`'s "suspicious split" report. Conform S2 already lists them deterministically
  (`copy/frame-copy has one L2`, ...).
- `writer.cascade` impact note (mid tier). Per `loops/loop.cascade/cascade-v1.json`, code accepts a clean
  cascade and a failing reverdict stops before the step, so the model step runs only on an accept-step
  failure, to write one Markdown note. Make it a settle record.

Verbs that silently need judgement:

- `lexicon.*` contracts carry `"check": "address deterministic; register owner rubric"`. No rubric or
  owner step exists, so `register` is unchecked.
- `copy.sentence-case` with no capitalization input decides "sentence case" by heuristic. That is a voice
  decision the consumer's `lexicon.capitalization` should own (P1-1).
- `text.no-placeholder` hardcodes `Acme` and `TODO` (`criteria/core/text.ts:90`). A real brand named Acme
  can never certify, and no override from Director naming exists.
- `similarity.ts` W-ORIG at Jaccard 0.6 over trigrams, with texts under 5 words exempt. This is an
  originality judgement encoded as a threshold, with no owner sign-off.

## 4. Skill text vs code (a low-tier model following the text literally fails)

| Skill says | Code does | Evidence |
| --- | --- | --- |
| `--name <name>`, options `<name>-v1`, `<name>-v2` (SKILL.md:96-99) | name must be the leaf meta, not a free name | `--name home-meta is not writer/page.home.meta's leaf meta` |
| frontmatter only `slot`, `locales`, `source` (SKILL.md:49) | `reason` (R20.2) and `provenance.voice` (`copy.voice-derived`) required | submit refusal text in P0-3 |
| `### <context>` heading, id `home.hero.heading` | heading must equal id; ids are contract field keys (`header.heading`, `title`) | `meta id is "title", not the key` |
| step 4: submit straight away with `--rung adopt|adapt|create` | adopt/adapt need a slot candidate seed; create and adapt need a recorded verdict and all P2 craft events and a critique | `rung adapt (adapt) is P2, which needs the slot's latest verdict to be create` |
| leave `TODO-OWNER` | `\bTODO\b` is a placeholder failure | `criteria/core/text.ts:90` |
| `write --brief` prints essence/voice/audience/position/wont-claim | prints `leaves`, `missingInputs`, `obligations` | §P1-7 |
| "Prose and Copy read style only through the Voice slots" | no criterion reads Voice pins | §P1-1 |
| Voice values are "measurable shapes (enum, scale...)" | the certifier checks a `voice-rule` json record kind, not the shape | §P1-2 |

Other mismatches between the action files, skills, recipes and code:

- `actions/writer.brief/skill.md` describes the refine-brief tighten step. `actions/writer.brief/action.json`
  is the plumb step `clossys write --brief` ("Print the Writer derivation brief"). One id, two meanings.
  `loop.create` `refine-brief` points at this skill.
- `actions/writer.candidates/skill.md` ladder: "stock shadcn, a trusted free registry item" was copied
  from the Designer. Writer standards declare `seeds: []`.
- `pick.writer/skill.md` says `clossys pick ...`. `loop.choose` step `pick` declares `cli: clossys pin <ref> <candidate> --by agent:<agent>`.
- `recipes/*/craft.md` §3 says `clossys render <slot> --draft`, which refuses Writer (P0-2). It also gives
  `<slot>` without the agent prefix, while the CLI requires `<agent>/<slot>`.
- `recipes/create.copy/craft.md` §1 cites `packages/writer/standards/<standard>/requirements.json`, a
  Foundry-checkout path. A consumer reads it under `node_modules/@clossys/writer/standards/`.
- Package defaults cite `source.ref: ["ia-target/writer.md#2-voice"]` in 44 files. No `ia-target/`
  exists in the repository or the package.
- SKILL.md "Done when" requires `check --suites --strict` to show no `copy-unbound`. That suite is
  vacuous when nothing is pinned (§5), so "done" can be reached with zero copy.
- The `Cascade`, `Requests`, `writer.cascade` and `writer.slot` sections are marked "DRAFT, for owner
  approval (foundry-build-0048 U26/U7)" but are live handlers in `conform.json`.

## 5. Missing or vacuous checks and tests

1. `recipes/recipes.test.mjs` never runs. `vitest.config.ts:17` includes only `src/**/*.test.ts`. It
   passes 25/25 under `node --test`, by hand only.
2. `derive --check`, `checkRetiredReferences` and `auditClaimsRegister` (`voice/checker.ts:279`) have no
   caller outside tests. Two of them are red now.
3. `check --suites` and `writer-check slots --strict` pass with `checked: 0`/`records: 0`
   (`producer/src/check/record-suites.ts:49,120`; `slot-contracts/cli.ts:14` globs only `*.md`).
4. `clossys check --suites` runs `runWriterSlotSuite`, which skips W-REQ (`checks.ts:347`) and resolves refs
   against an empty index (`:387`). `writer-check slots` runs `runWriterSuite`, which does W-REQ. The two
   entry points look the same but enforce different checks.
5. `ia-coverage` computes WR3/4/5/7/8/9 results but only WR10 becomes a finding (`ia-coverage/index.ts:161-169`).
   Exit is `findings.length ? 1 : 0` (`cli.ts:108`), so WR errors never fail it.
6. Malformed ICU counts as 0 chars in WR7 (`length.ts:125`), is skipped in WR9 (`expansion.ts:26`) and gives
   no variants in WR5 (`lint/prose.ts:9`). The producer path never runs WR8, so bad ICU passes every length check.
7. `voice/checker.ts:405,495` pushes `ran` before channel filtering. `checker.ts:283` sets `complete: true`
   even when every entry's own report has `complete: false`.
8. The build runs `scripts/check-record-drift.mjs` without `--check`, so it rewrites the report and cannot
   go stale. It passes no strategy, so claim currency is never exercised.
9. `slot-suite.test.ts:107` returns early (a silent pass) when its fixture is missing. When the fixture is
   present it asserts only zero INPUT findings and `records > 500`, never W-* results.
10. `field-coverage.test.ts:43` is self-declared vacuous. `purity.test.ts:49` asserts only `length > 0`.
11. The producer e2e (`packages/producer/e2e/scenario.json`, steps `ia.strings`/`craft.strings`) places an ad-hoc
    `writer/strings.site` slot with its own contract. It never adopts the Writer package tree, derive output,
    lexicon, meta or declarations. The only end-to-end test of Writer does not test the Writer package.
12. No test submits a package default through `next --submit` (P0-1). No test asserts that `resolveSlot`
    and `read/slot.ts` pick the same sample (P1-3). No test certifies a candidate written exactly as
    SKILL.md's example (P0-3).
13. Conform L4/Q7/Q8 are red as vacuous ("empty is red"): no Writer request has ever been placed or closed.

## 6. Simplifications

- **Delete the 12 retired `defaults/lexicon.*/*-v1.json` files.** They are `status: retired` and only feed
  the wrong sample (P1-3). Rename v2 to v1, or fix the resolver.
- **Retire the parallel "copy registry" model**, if Publisher's remaining `CopyRef` callers can move to
  slot-body:
  - `registry.ts`, `checker.ts`, `scan.ts` (2081 lines), `approval-bypass.ts` (2263), `approval*.ts`,
    `approve-cli.ts`, `addressability.ts`, `copy-gate.ts`, `live-copy-gate.ts`, `fold-wallpaper-gate.ts`,
    `approved-copy-coverage-rate*.ts`, most of `cli.ts` (1705).
  - That is about 11k of the 22k non-test lines. It checks a `CopyRecord` JSON file (`writer-check <record-file>`),
    not `clossys/agents/writer/**`.
  - Producer imports none of it. It only uses `slot-body`, `resolve`, `declarations`, `locale-coverage`,
    `voice/derivation-coverage`, `catalog/ia/target`, `model/director-sources`, `slot-contracts/checks`
    and the fingerprint.
  - `package.json` capabilities still describe `clossys/writer/voice.json` and `copy-registry.json`
    outputs that the slot model never writes.
  - `actions/exceptions.json` already parks both bins as owner decisions.
- **Merge the two slot checkers.** `src/slot-contracts/checks.ts` (`writer-slots` suite) and producer
  `criteria/writer/st-w/copy.ts` (constitution) judge the same pinned candidate. Keep the certifier and
  drop the suite, or the reverse.
- **Drop `src/catalog/slots/*.json` plus `slot-defaults.json` and `retired-slot-defaults.json`**, if
  `catalog/ia/*` and `defaults/` are the source. Three places say what a slot's default is. Verify with
  the loader before deleting.
- **Merge the three recipe `craft.md` files.** They are about 145 lines each and differ in one axis table
  and the render shape. One craft file with a per-standard table would do.
- **Replace the `writer.cascade` and `writer.scope` model steps with code** (§3). Two skills and two mid-tier
  seats go away.
- **Delete `src/catalog/records/pending/sections-upgrade.r1.en.json`.** It ships in the tarball under
  `files: ["src"]` and nothing reads it (grep finds no reader outside tests).

## 7. Top 5 recommended units, in order

1. Make the suite and generated data green and gated: regenerate `copy.json`, fix the 9 retired reads, and
   wire `derive --check`, retired-references and `recipes.test.mjs` into build/CI (P0-4, §5.1–2).
2. Let code adopt Writer package defaults. Accept `writer/<slot>/package:<file>` seeds, or ship the defaults
   as candidate-strings, and add a `writer.system` plumb path that skips render+critique for single-option
   slots (P0-1, P2-1).
3. Rewrite `skill/SKILL.md` loop steps 1–6 from the guards: ids equal field keys, frontmatter
   `reason`/`provenance`, verdict then craft, no `TODO-OWNER`, `clossys brief` instead of reading Designer
   candidates. Add a test that certifies the skill's own example (P0-3, P1-4, §4).
4. Feed the pinned lexicon slots into `lexicon.clean`/`lexicon.terms`/`copy.sentence-case` params at
   certify time, and pick one measurable lexicon shape with a registered criterion (P1-1, P1-2).
5. Add a Writer draft render plus `clossys write --declare`, then extend the producer e2e to adopt the real
   Writer tree (one meta slot, one section copy slot) instead of the ad-hoc `strings.site` (P0-2, P2-3, §5.11).
