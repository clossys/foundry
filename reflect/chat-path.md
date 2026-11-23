# Reflect: the owner's chat path in a fresh consumer

Unit: read-only reflection, focus on the cross-cutting chat path (install, Advisor, Director pins,
Designer and Writer pins, Publisher release). Base: `5a2e197ea` (`claude/r2f-int2`). Serving model:
`claude-opus-5-5` (session `last_served_model`). No source file changed.

Method: built the seven packages, packed with `node packages/producer/scripts/pack-five.mjs --out-dir
<tmp>` (summary `complete: true`, Studio built, clean source), then in an empty `mktemp -d` git repo
followed `skill/SKILL.md` of Advisor, then Director, Producer (Interview), Designer, Writer and Publisher
literally, running every verb from the installed tarballs. Where a verb refused, I took the refusal's
own hint before reading code, which is what a low-tier model would do. I recorded every workaround.

## 1. What exists and works

- **Pack and install.** `pack-five.mjs` gives seven tarballs plus `artifacts.json` with hashes.
  `advisor doctor` takes 0.9 s; `advisor install --from <pack>` takes 51 s, checks the SHA-256s and
  writes `clossys/advisor/install.json` (`packages/advisor/src/front-door/install.ts`).
- **Init.** `advisor init` runs `clossys config --init` and then `clossys init`. That places the seven
  skills in `.claude/skills/` and `.agents/skills/` (`packages/producer/src/cli/init-skills.ts`), writes
  `CLAUDE.md` as `@AGENTS.md`, adopts the Director IA and seats the admin publication.
- **Intake.** `advisor intake --answers <file>` wrote 5 verbatim findings with `Informs:` bullets in
  4 s, and is resumable (`packages/advisor/src/front-door/intake.ts`).
- **Interview packets.** `clossys next --owner --agent <id> --json` returns real multiple-choice
  packets with exact argv. The archetype question works end to end: one call to `clossys director check
  archetype default --by owner --via chat --quote …` records it.
- **The pin gate holds.** `clossys pin … --by owner` and `--by owner:queue.pick#1` are both refused.
  Only a `queue.pick` entry raised by `clossys run loop.choose` and answered with `clossys answer` pins
  (`packages/producer/src/records/slot-write.ts:846`).
- **Write discipline.** Craft-stage guards refuse malformed directions with a usable hint (axes shape,
  distinct values). The submit guard refuses a create without a verdict and without a critique.
- **Opt-in site.** `clossys init --starters site` seats `publication.site` and 7 routed pages.
- **Repo-level gates.** `clossys conform --all --json` gives 152 cells, 54 red: the same set as the
  census at 925ae7f.

## 2. Gaps

### P0: blocks a consumer finishing the flow

**P0-1. One Director cell needs about 9 verbs and 3 hand-written JSON files, and the Director skill
names almost none of them.**
- **Evidence.** The skill's loop step 6 (`packages/director/skill/SKILL.md:178`) says to submit
  directly. In the consumer that was refused, step after step:
  1. `next --submit refused: rung create (create) is P2, which needs the slot's latest verdict to be
     create`.
  2. `verdict … is not a verdict (verdict.schema.json): / must match exactly one of oneOf`. The schema
     needs `schema` and `slot`, which no skill shows.
  3. `gap brief:Job is not a taste criterion or requirement` (Job is a `mustContain` key). Only a
     standard requirement id such as `brief.keys` worked.
  4. `R15.7 craft events (none) are not brief, diverge, render, critique`.
  5. `diverge` was refused 3 times: first for axes as an array, then for a hidden recipe axis set
     (`the recipe's axes: selection, cut, evidence`), then for shared values.
  6. `no critique record critiques/need-v1.json`.
- **What works.** The sequence that passes is: `options` → `verdict --record` → `next --stage brief` →
  `diverge --file` → `render` → `critique-packet` → `critique --record` → `submit` → `run loop.choose` →
  `answer` → `run loop.choose --resume`. It appears only in code (`packages/producer/src/check/e2e.ts:547-564`).
  The Director skill mentions the verdict once, in prose (`SKILL.md:84`). The packet's step skill,
  `actions/director.candidates/skill.md`, never mentions the verdict, the stages or the critique.
- **Why it matters.** A low-tier model cannot discover this order from refusals in reasonable time,
  and the core strategy is 24 cells, so roughly 220 verb calls before Designer can start.
- **Minimum fix.** Code: a `clossys craft <agent>/<slot> --draft <file> --directions <file>` verb that
  records the verdict, the brief, diverge and render, and the critique-packet in order (all of it is
  deterministic except the drafts). The skill then names one verb.
- **Size and decider.** M. Pure code, plus a skill edit.

**P0-2. `next --stage critique` wedges the craft run.**
- **Evidence.** `next … --stage critique` is accepted and logs `craft:critique` with no record. After
  that, `clossys critique --record` is refused with `the next stage is not critique`, and the submit is
  still refused with `no critique record`. The only escape I found was `--stage refine` followed by
  `critique --record`, which burns one of the two refine rounds.
- **Why it matters.** The `next --help` text lists `critique` as a stage, so a model takes it.
- **Minimum fix.** Refuse `--stage critique` on `next` and name `clossys critique --record`, or require
  the record on that stage.
- **Size and decider.** S. Code.

**P0-3. No verb or skill tells the Director how to get the `queue.pick` entry id its pin needs.**
- **Evidence.**
  - `SKILL.md:194` says `--by owner:queue.pick#<entry id>`.
  - The owner round for the cell has `"fill":{"<queue-answer>":"the queue entry holding the owner's
    answer…"}`, but no entry exists at that point.
  - `clossys request` cannot raise a pick.
  - The entry exists only after `clossys run loop.choose --slot director/<id>` raises
    `queue.pick#<run>-<slot>`, and loop.choose appears nowhere in the Director skill.
- **Minimum fix.** Have the owner round's pin option be `clossys run loop.choose --slot … ` (which raises
  and waits), or let `next --owner` raise the entry and put its id in the argv.
- **Size and decider.** S. Code.

**P0-4. The site publication has no release slot, so `loop.release` can never run.**
- **Evidence.**
  - After `clossys init --starters site` ("seated the site publication: 8 Publisher slots placed"),
    `clossys publisher release site` says `publisher/release.site has no readable slot.json: no release
    slot for site`.
  - `clossys run loop.release --publication site` says `stopped: step build failed`, and the ledger
    entry has no reason and raises no `queue.fix`.
  - `clossys publish` says `Publisher has no publication` while `publication.site` exists.
- **Minimum fix.** The starter seats `release.<publication>` too. A failed code step records its stderr
  in the ledger and routes a fix (conform P4 is already red for this).
- **Size and decider.** S. Code and data.

**P0-5. Nothing on the documented path seats the site publication or the Designer and Writer IAs.**
- **Evidence.**
  - Advisor runs plain `clossys init` (`packages/advisor/src/front-door/init.ts:23`). No skill mentions
    `--starters`.
  - After init, `clossys gaps --agent designer` reports `0 (coverage 0 …)`, and the Producer Interview
    rule "stop at 0 gaps" reads that as done. At the same time, `clossys design --brief` exits 2 with
    `clossys/agents/designer/ia.json is missing`.
  - The IA question ("Which designer IA does this workspace start from?") only shows in the Producer
    round, which no front-door step or content skill sends the owner to.
- **Minimum fix.**
  - `advisor init` runs `clossys ia designer --adopt`, `clossys ia writer --adopt` and
    `init --starters <publication>` from an intake answer.
  - `gaps --agent <x>` reports a missing IA as a gap.
- **Size and decider.** S. Code. The choice of publication is an owner multiple-choice question
  (site/docs/app).

### P1: wrong or unreliable result

**P1-1. Every `loop.choose` on a starter Director cell ends red after a successful pin.**
- **Evidence.** The ledger shows step `cascade`, `cli: "clossys check <dependants>"`, `exit: 1`, outcome
  `stopped: step cascade failed`.
- **Cause.** `packages/producer/src/loop/runner.ts:809` counts every `consumedBy` ref that `readSubject`
  cannot resolve as missing. Every adopted Director slot carries `{"to":"producer/loop.scope/package:scope-v1.json","rel":"consumedBy"}`,
  which is a package loop ref, not a slot.
- **Why it matters.** The owner sees a failure on each of 24 good pins, and a model may retry or unpin.
- **Minimum fix.** Skip refs whose target is a loop or package ref.
- **Size and decider.** S. Code.

**P1-2. The Producer round asks a non-technical owner things only an engineer can answer.**
- **Evidence.** `next --owner --agent producer` returns 7 questions, including:
  - "Name the model id your account policy maps to each seat tier" (free text);
  - an owner-decision ref `<org>/<repo>#<issue> issuecomment-<id>`;
  - a rule registry `<R-ID>`;
  - three seat questions whose options all need `<queue-answer>` (same problem as P0-3) and pass
    `--prompt-file packages/<agent>/actions/…`, a Foundry-checkout path.
- **Why it matters.** It breaks the multiple-choice-only goal. It is also inconsistent: Director submits
  succeed with any `--model` while the seat policy is `missing`, so the "model or tier not the seat's is
  refused" rule in the Producer skill is unenforced in exactly the fresh-consumer case.
- **Minimum fix.**
  - Advisor init writes the seat policy and seats from the pack's defaults (planner-decided, deterministic).
  - Owner-decision and rule registries start empty by code.
  - The owner sees only "drafts at mid or high tier?" as two options.
- **Size and decider.** M. Code, plus one product decision on default tiers.

**P1-3. `loop.fill --init` starts on the wrong cell and ignores intake and archetype.**
- **Evidence.** The first fill is `director/capability.operation.delivery`, before the archetype is
  recorded and before any intake-informed cell (need, core segment, included, name).
- **Why it matters.** The Director skill's "nearest unlock" scoring (`SKILL.md`, Nearest unlock) and the
  fill order disagree, so the loop and the skill pull in different directions.
- **Minimum fix.** loop.fill orders Director cells by the skill's default path and puts first the cells
  an `owner-intake-*` finding `Informs:`. All of that is data already on disk.
- **Size and decider.** S. Code.

**P1-4. Owner-facing option labels are ids and paths.**
- **Evidence.**
  - The archetype options say "adds focus.lifecycle.retention, capability.sourcing.build, …".
  - The queue.pick option's `summary` is `director/context.customer.need/need-v1.md`.
  - The Director skill says "never ids in your replies", so a literal model either shows ids or
    paraphrases and breaks the `--quote` link.
- **Minimum fix.** Labels from the cells' plain names (`ia.json` labels); the summary from the first
  Direction bullet.
- **Size and decider.** S. Code.

**P1-5. The archetype "recommended" option is always `default`.**
- **Evidence.** It is fixed whatever the intake says ("Hand-thrown ceramic mugs sold online").
- **Why it matters.** The Director skill requires hypothesis-first. Recommending from evidence is a
  model decision, and the packet gives the model no slot for it.
- **Minimum fix.** Keep code-recommended options, but let the Director's draft set `recommended` through
  a declared field (`next --owner --recommend <option>`).
- **Size and decider.** S. Code; the recommendation itself is a model decision.

**P1-6. The packet and the critique packet name Foundry-checkout paths.**
- **Evidence.** In a consumer, the loop packet prints `skill packages/director/actions/director.candidates/skill.md`,
  and `critique-packet` items reference `packages/director/standards/brief.profile/taste.md`. Neither
  path exists there (`ls packages` → no such directory). Only `next --json` gives `skill.file` resolved.
- **Why it matters.** A fresh-context critic told to read the packet's refs cannot open them.
- **Minimum fix.** Print the resolved installed path next to the logical id in every human packet line
  and every packet item.
- **Size and decider.** S. Code.

**P1-7. The blind critic is not blind, and the Director standard is under-specified.**
- **Evidence.**
  - `clossys critique --record` accepted a record I wrote as the maker, with the same model.
  - The e2e critic is `${scenario.model}-critic` (`e2e.ts:562`), a string suffix.
  - `critique-packet` reports `1 exemplar(s)` for `brief.profile`, against R15's 5-12 (conform K1 red).
  - `--stage render` records an event with no artefact.
- **Why it matters.** The quality gate certifies a self-review.
- **Minimum fix.** Refuse a critique whose `--model` equals the maker's model on the run's ledger, and
  require a render artefact hash on `render`.
- **Size and decider.** S. Code; exemplars are M of data.

**P1-8. Writer's bind step cannot run before the pin that comes after it.**
- **Evidence.** In `packages/writer/skill/SKILL.md`, step 6 "Bind it" requires "Every target id must be
  a pinned record" (line 111). Step 8 "Show it … the owner pins" (line 132) comes later, and Done-when
  says `pin.json` is untouched.
- **Minimum fix.** Reorder to show → pin (through loop.choose) → bind, or make bind a code step of
  loop.choose.
- **Size and decider.** S. Skill and code.

**P1-9. Intake's printed "next" skips two front-door steps.**
- **Evidence.** `advisor intake` prints `next: talk to @clossys-director`
  (`packages/advisor/src/front-door/intake.ts:121`). The skill's steps 5 (relations) and 6
  (`clossys run loop.fill --init`) still remain (`packages/advisor/skill/SKILL.md:20`). A model that
  follows verb output skips the fill init.
- **Minimum fix.** Print `next: clossys run loop.fill --init`.
- **Size and decider.** S. Code.

### P2: cost, speed, polish

- **P2-1. Intake is free text, including a question that is a choice.**
  - Evidence: "What limits you most today: money, time or people?" (`front-door/tree.json:97`) is a
    choice asked as free text (`SKILL.md:16`, "one at a time, in plain words").
  - Fix: mark that slot `options:[money,time,people]` and ask it as multiple choice; keep the verbatim
    finding.
  - Size and decider: S, data.
- **P2-2. Packages land as runtime `dependencies`.**
  - Evidence: install writes 754 MB of `node_modules` into the consumer's `dependencies`, and adds no
    `.gitignore` for `node_modules/`. `git status` then shows `node_modules/` untracked, which a
    non-technical owner will commit.
  - Fix: `--save-dev`, and append `node_modules/` to `.gitignore` when it is missing.
  - Size and decider: S, code.
- **P2-3. The owner's stated release target has no matching page.**
  - Evidence: intake said "a home page and a shop page". The site starter has home, about, pricing,
    contact, site-page, terms and privacy.
  - Fix: route intake horizon words to `page.site-page` or a `queue.slot` request. This is a model
    decision with code plumbing.
  - Size: S.
- **P2-4. Stock Designer primitives still need a model.**
  - Evidence: `loop.fill --slot designer/components.button` waits on `agent:designer` (mid). The
    `adopt` settle (`runner.ts`, DET-STEPS) did not fire, because `components.button` has no seed
    (conform K2 red: 57 components).
  - Fix: seed the shadcn primitives as code-adopt items.
  - Size and decider: M, data.
- **P2-5. Hours of the owner's time.**
  - Evidence: before any page there are 108 Director gaps, 312 Designer gaps and 147 Writer gaps
    (`clossys gaps`).
  - Fix: settle-by-code on every slot whose contract has one stock answer, and ask by policy
    (`<id>.policy`) for the rest, as the Producer skill already promises.
  - Size and decider: L, code and data.

## 3. Model steps that should be verbs, and verbs that hide judgement

**Should be verbs (deterministic today, done by the model):**
- **The craft ladder** (P0-1): the verdict file, the stage order, the critique-packet, and the critique
  record skeleton built from the packet manifest. The model only needs to write the draft and the
  scores.
- **Writer declarations.** `packages/writer/skill/SKILL.md` step 6 has the model write an inline
  `node --input-type=module -e` script importing `@clossys/writer/declarations` and
  `@clossys/producer` with an undocumented `rows.json`. All rows derive from pinned page candidates and
  pinned Writer records, so it should be `clossys write --bind`.
- **Copy-key listing.** Writer step 1 and Publisher steps 2-3 have the model read every Designer
  candidate's `meta.element.reads.copyKeys` and map keys by hand. A `clossys publish --map <page>` that
  prints the key-to-record table (and the missing ones as Writer requests) removes that reading.
- **Finding files.** The Director skill has the model hand-write
  `clossys/evidence/director/owner-<topic>-<date>.md` after every answer. `clossys evidence` exists
  (Advisor uses it), but the Director skill never names it.
- **The Designer gate dance.** Designer step 7 is: pin, run `designer-ref-verbatim --pinned`, and on
  failure "restore the previous `pin.json`" by hand (`packages/designer/skill/SKILL.md:131`). The pin
  gate should run ref-verbatim before it writes.
- **Cascade impact on a clean re-verdict.** This is already settled by code (DET-STEPS `impact`). The
  three content skills still describe it as the agent's DRAFT step.

**Verbs that silently need judgement:**
- `clossys verdict --record {create:true, gaps:[…]}`: choosing gap ids is a judgement, but the only
  accepted ids are standard requirement ids, and the skill gives no list.
- `next --stage diverge`: the recipe axes (`selection, cut, evidence`) are a judgement frame that is
  only revealed by refusal.
- `clossys director check archetype`: the `recommended` flag is code-fixed (P1-5).

## 4. Where the skill text and the code disagree

| Skill text | Code | A literal model |
|---|---|---|
| `cell.md:43,87`: pin with `--by owner --basis picked` | `pin refused: --by owner names no queue answer` | fails every pin |
| `director/SKILL.md:178`: `--name <name>`, options `<name>-v1`, `<name>-v2` | `next --help`: "named after the slot leaf (`<leaf>-v<n>`, R08.1)"; usage lists no `--name` | the candidate becomes `need-v1.md`, and parallel "option A/B" names are impossible |
| `cell.md` rule: Because cites `<cell-id>@<N>`; the worked example cites a bare `context.customer.need` | Producer skill Rules: "never a version"; `migrate citations-to-slots` rewrites versions away | three answers to one question |
| `director.candidates/skill.md:14`: adopt "stock shadcn, a trusted free registry item" | a Director brief standard is `createOnly: true` with `seeds: []` | the model looks for shadcn seeds for strategy text |
| `director/SKILL.md` step 6: submit directly | the submit guard needs verdict, stages and critique | refused, see P0-1 |
| `publisher/SKILL.md:71` target page option (`layout`, `role`, `use`) vs `:93` "the loop below … still takes `clossys.page/1`" | two page schemas in one skill | it writes whichever it read first |
| `designer/SKILL.md:68`: `npm run check:source-ladder`; `:263` `check-section-tokens.mjs` | the first is a Foundry repo script, not a consumer script; the shipped bins are `designer-section-check` and `designer-overflow-check` | runs a missing script, or calls the Done-when check by a name that is not a bin |
| `designer/SKILL.md:66`: write a `ladder` on `src/catalog/rules/source-roster.json` "from a consumer repository, request it upstream" | no consumer verb files that request | stops |
| `producer/SKILL.md`: while the seat policy is missing, "its question is asked first" | `next --owner --agent director` returns `policy: "missing"` and 0 questions after the archetype | Director never asks it; the submits pass anyway |
| `advisor/SKILL.md:20` step 6 `loop.fill --init` | `intake` prints `next: talk to @clossys-director` | skips the step (P1-9) |
| `producer/SKILL.md`: "Stop at 0 gaps" | designer gaps are 0 while its IA is missing | declares Designer done (P0-5) |

## 5. Missing or vacuous checks and tests

- **The e2e gate never walks the owner's path.**
  - `packages/producer/e2e/scenario.json:19,27` starts with `ia <agent> --start`, not `--adopt`.
  - Seats are `--decided-by planner`, and every pin is `--by agent:<agent>` (`e2e.ts:564`).
  - It never runs Advisor, `next --owner`, `loop.choose`, `queue.pick` or `answer`, which is exactly
    where P0-3 and P1-1 live.
  - It is also red at the census commit.
- **`advisor` real-CLI test.** `packages/advisor/src/front-door/real-cli.test.ts` has 3 tests against
  the built CLI. None installs from a packed `artifacts.json` and then runs `loop.fill --init` against
  the installed Producer.
- **`publisher.check` passes on nothing.** It printed `0 page records, 0 findings` (exit 0) before any
  page existed. An empty set should be vacuous-red, as the conform cells already are.
- **`gaps --agent designer`** returns 0 on a workspace with no Designer IA (P0-5).
- **The craft stages** accept `render` with no artefact and `critique` with no record (P0-2, P1-7).
  The submit guard then catches only the second.
- **`clossys pipeline check` (owner.wiring)** is said to run every option on a scratch copy. Yet the
  seat options carrying `<queue-answer>` and `packages/...` prompt files cannot record anything in a
  consumer, and nothing failed on `next --owner`.
- **`check:step-standard` `skill.ladder`** passes while the Director step skill describes a
  Designer-style shadcn ladder (section 4, row 4): the check confirms the ladder text is present, not
  that it fits the agent.
- **No test pins one Director cell** from an empty consumer through `loop.choose`. One would have
  caught P1-1.

## 6. Simplifications

- **Advisor legacy code.** `packages/advisor/src/` keeps 36 non-test modules outside `front-door/`
  (assessment, engagement brief, kit presets, plan contract, package request, and others) and 6 extra
  bins (`advisor-check`, `advisor-execution-readiness`, …). The skill says "no hub, no kit, no role
  roster and no engagement plan", and `front-door/` imports none of them. Remove them and their bins,
  or move them to a legacy package. The README description ("sponsor assessment … for Foundry
  engagements") goes with them.
- **Degraded hub mode.** The 3-case hub detection in `advisor/SKILL.md` (lines 30-44) is the longest
  section of a 42-line skill. It serves only repositories from the retired hub flow. Make it a
  `doctor` check that refuses with one line, and drop the prose.
- **Two Publisher page formats.** Keep one (`clossys.page/1` is what the verbs take) and delete the
  "target page option" block until the code takes it.
- **Two ways to record a critique.** Drop `--stage critique` from `next`; keep `clossys critique --record`.
- **Duplicate cascade prose.** The DRAFT "Cascade" sections are repeated in three content skills, and
  code already settles the clean case. Replace them with one line pointing to the Producer skill.
- **Generated reference sections.** Designer's two generated sections (component and token selection,
  about 40 lines) tell the model about repository scripts that do not ship. Move them to
  `components-guide.md`, which is already installed.

## 7. Top 5 recommended units, in order

1. **CRAFT-VERB.** Add one `clossys craft <agent>/<slot> --draft <file> --directions <file>` verb that
   records the verdict, the brief, diverge and render, and the critique-packet in order, refuses
   `next --stage critique`, and is the only submit command the Director, Designer and Writer skills
   name (P0-1, P0-2).
2. **OWNER-PIN.** Make each owner pick option run `clossys run loop.choose --slot …` so the `queue.pick`
   entry exists before the yes, and stop the cascade step counting package `consumedBy` refs as missing
   dependants (P0-3, P1-1).
3. **FRONT-DOOR-SEAT.** Have `advisor init` adopt the Designer and Writer IAs, write the default seat
   policy and seats, seat the publication chosen in one intake multiple-choice question together with
   its `release.<publication>` slot, and print `loop.fill --init` as next (P0-4, P0-5, P1-2, P1-9).
4. **CHAT-E2E.** Add an e2e scenario from packed tarballs. It runs Advisor intake, pins one Director
   cell through `next --owner` → `loop.choose` → `answer`, and runs `loop.release` to a refusal that
   names its reason. It fails on any free-text `fill` in an owner option.
5. **SKILL-TRUTH.** Make one pass over the six skills to fix every row of section 4 (pin form, the
   `--name` flag, citation form, the Director ladder, the Writer step order, one Publisher format) and
   name the `clossys evidence` verb for findings.
