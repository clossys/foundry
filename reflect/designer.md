# Reflection: designer (packages/designer)

Read-only reflection at `5a2e197ea` (branch `claude/r2f-int2`). Serving model: `claude-opus-5-5`
(session `last_served_model`). No source file changed.

Method: read `skill/SKILL.md`, every `actions/*/{action.json,skill.md}`, the 8 recipes, 11 standards,
5 loops, the slot-contract layer files, and the Producer code these call (`cli/design.ts`, `cli/pin.ts`,
`cli/next.ts`, `records/code-adopt.ts`, `records/slot-model/foundry-ia.ts`). Then I traced a fresh consumer
by hand: an empty git repo using the workspace `node_modules`, running `clossys config --init`,
`init --starters site`, `ia designer --adopt`, `run loop.create --slot designer/<slot>`, `pin`,
`design --brief|--check` and the shipped check bins. I also ran
`clossys conform --all --json` and `npm run check:e2e -w @clossys/producer`. `<consumer>` below stands for
that scratch consumer.

## 1. What exists and works

- **Fresh-consumer seating.** `clossys ia designer --adopt` (`producer/src/records/slot-model/foundry-ia.ts`)
  places 156 slots with contracts in about 4 s: 31 themes, 44 assets, 40 components, 30 sections, 11 frames.
- **Zero-token stock adoption.** `clossys settle adopt` (`producer/src/records/code-adopt.ts`) installs a
  shadcn-aria item byte-exact at L1 when the lockfile allows it. `components.card` settled this way.
- **Craft verbs.** `clossys craft|next --stage brief|diverge|render|critique|refine`, `clossys render --draft`,
  `clossys critique-packet` and `clossys recipe check|generate` all exist (`producer/src/cli/args.ts:96-97`).
  The `recipes/stage-check.mjs` checks are mechanical: `node --test recipes/recipes.test.mjs` gives 32 pass.
- **Ref-verbatim and composition gate.** `scripts/check-ref-verbatim.mjs` (2027 lines) implements the hunk
  allow-list and the REF-COMP-* composition rules.
- **Slot contracts.** All 252 leaves have one: `npm run check:slot-contracts` gives coverage 252/252 with 0
  findings. `npm run check:references` matches 551 vendored items across 14 registries.
- **Designer steps in the e2e.** All designer steps of the shipped scenario pass at this head
  (separator adopt, frame and hero craft, then pin). The e2e's first red is
  `build: clossys publisher release site` (publisher `page.no-inline-copy`), which is outside this area.
  The census red at `925ae7f` (`craft.frame.submit`) is fixed.
- **Specimen snapshots.** `clossys specimen snapshot --records clossys --element card --v 1 --width 1280,390`
  rendered both widths with 0 errors.

## 2. Gaps

### P0: blocks a consumer finishing the flow

**P0-1. Every section is structurally blocked: the band and section-header slots are never placed.**
- Evidence:
  - Hero's contract after adopt has `parts: ["sections.band","sections.section-header"]` and limit
    `compose.band`.
  - `ls clossys/agents/designer | grep -c "sections.band\|section-header"` gives 0. Adopt reports
    "56 package leaves no publication reaches stay in the package".
  - `node scripts/check-section-tokens.mjs --root clossys` gives
    `FAIL (1) - shell: sections.band has no pinned item; every section composes it`.
  - `clossys request --list --open | grep -c band` gives 0.
- Root cause: `foundry-ia.ts:179` builds `declaredUses` from `requires` and `allowedComposes|composes`
  only. Contract `parts` and `anatomy` are never read, so the reachability prune drops both shell slots.
- Why it matters: no section can pass the section rules, and nothing files the missing slot.
- Fix: add `contract.parts` (and `anatomy` values) to `declaredUses` in `foundry-ia.ts`, plus one adopt
  test asserting `sections.band` is placed.
- Size S. Pure code.

**P0-2. Code adopt (the zero-token L1 path) always fails on a fresh consumer.**
- Evidence:
  - `run loop.create --slot designer/components.separator` gives `outcome: agent`, "imports cn,
    react-aria-components, which the consumer lockfile does not hold; code never edits the lockfile;
    the agent creates".
  - 69 vendored shadcn-aria files import `cn` (`grep -rl 'from "cn"' references/shadcn-aria`).
  - `components.badge` also needs `class-variance-authority`.
  - `clossys config --init` writes `components.json` but installs nothing. The e2e passes only because
    it installs `cn@0.5.1` and `react-aria-components` itself.
- Why it matters: every stock component falls through to a high-cost agent create. That create then hits
  the same R06.1 lockfile rule.
- Fix: in the settle record and the queue, print the exact install command (one `queue.clarify` entry
  listing the missing packages at the versions the references pin). Optionally `config --init` installs
  the shadcn-aria base set (`cn`, `react-aria-components`, `class-variance-authority`).
- Size S. Pure code.

**P0-3. Stock `components.button` cannot be adopted before a theme exists, and no default theme ships.**
- Evidence:
  - The settle `why` for `components.button` reads: "generateCompiledCss: 1 token(s) are read with a bare
    var() but have no declared source in styles/tokens.css, styles/theme.css ... --secondary".
  - `grep -c -- "--secondary:" styles/{tokens,theme,theme-keys,compiled}.css` gives 0 in all four.
  - `src/catalog/defaults/` holds 7 entries, all slide-related.
- Why it matters: themes must be fully crafted before stock components, and themes are the most expensive
  step (P1-1).
- Fix: ship `shadcn/neutral` as the package default for every `themes.*` slot, which the skill already
  calls the base. Or declare `--secondary` in `styles/theme.css`.
- Size S/M. Data.

**P0-4. The `pick.designer` pass command points at a file that does not ship.**
- Evidence:
  - `actions/pick.designer/action.json:26` runs `node ../producer/scripts/check-slot-options.mjs`.
  - Producer `files` ships only `scripts/check-generated-derived.mjs` and `scripts/consumer-root.mjs`.
  - Director, Writer and Publisher pick actions have the same line.
- Why it matters: in an installed consumer the agent-seat pick's pass check can only error.
- Fix: use a shipped verb, `clossys options designer/<slot> --check` or a `check:slot-options` step.
- Size S. Pure code.

**P0-5. The skill's literal pin command is refused.**
- Evidence: `clossys pin designer/components.card card-v1 --by "owner:queue.pick#x"` gives
  `card-v1 is not a candidate file name (<name>-v<n>.md|json|svg)`. SKILL.md:134 writes
  `<element>-v<N>` with no extension. Even with `.json`, the owner form needs a real `queue.<kind>#<id>`,
  and no step of the skill says how the owner's answer creates that entry (`clossys answer`).
- Fix: correct the SKILL.md commands to `<element>-v<N>.json`, and name the answer flow
  (`clossys next --owner` → `clossys answer`).
- Size S. Text.

### P1: wrong or unreliable result

**P1-1. Theme tokens are one slot per CSS variable, each a full high-tier craft.**
- Evidence:
  - The consumer holds 31 `themes.*` slots. `themes.background` has `contract.members.names: ["default"]`,
    `emit: --background` and `family.options: 1`.
  - `recipes/create.tokens/craft.md` says "Tier: high": brief, 3–4 directions, render, a critique by a
    fresh critic, and up to 2 refine rounds.
  - Its axes ("where the accent lives: primary only, primary and ring, charts") are palette-level, not
    per-variable.
- Why it matters: about 31 independent palette decisions yield an incoherent palette and are the single
  largest token cost of the area.
- Fix: one palette decision (a `themes.palette` packet: base preset plus brand hue choices, chosen
  multiple-choice by the owner), then `clossys recipe generate create.tokens` fans the values out to the
  31 slots with zero tokens.
- Size L. Model decision once, then code.

**P1-2. Recipes hard-code one tenant's Director values.**
- Evidence:
  - `create.tokens/craft.md:8` reads "identity.visual.style (v9: quiet and exact, stock shadcn with
    restrained colour only) ... (precise, plain-spoken, calm)".
  - The same phrases appear in `create.marketing-section`, `create.glyph` and `create.element`
    (`grep -n "quiet and exact\|plain-spoken\|no stock photos" recipes/*/craft.md`).
- Why it matters: a low-tier model treats these as the brief and bakes Foundry's brand into a consumer's
  site.
- Fix: replace the quoted values with "read the trait text from `clossys craft brief`".
- Size S. Text.

**P1-3. Every Designer slot blanket-reads all 8 Director brief inputs.**
- Evidence:
  - `foundry-ia.ts:180`: `declaredInputs = [...brief, ...]`.
  - In the consumer, the minimum and maximum number of Director inputs is 8 for every layer (a `card`
    reads `focus.segment.core` and `advantage.proposition.promise`).
  - Pinning stock `card-v1.json` is refused with "R02.2 dependency set not pinned upstream ... and 12 more".
- Why it matters:
  - No stock component can be pinned until the whole Director tree is pinned.
  - Any Director repin cascades to all 156 Designer slots (`loop.cascade` re-verdicts each).
- Fix: derive inputs from the standard's `derive.director.traits`. Components get none; themes and assets
  get style and imagery.
- Size M. Data and code.

**P1-4. Code adopt writes a Director-realisation claim that no one judged.**
- Evidence: `code-adopt.ts:102`: when nothing is cited and the slot reads `identity.visual.style`, the code
  pushes that trait and writes `Realises director:identity.visual.style: ...`. `design --check`
  (`director-trace-missing`) then accepts it.
- Why it matters: R20 traceability is green by construction for every adopted item.
- Fix: for a stock pick, write `source:stock` with no Director claim, and exempt components from R20.
- Size S. Code.

**P1-5. The adopt path the skill describes for sections and frames does not exist.**
- Evidence:
  - All 10 non-component standards are `createOnly: true, seeds: []`. `component` is `adopt-first` with
    `seeds: []`.
  - Section contracts carry `references` (for example hero cites `tailark-oss/mist-hero-section-1`), but
    code adopt is components-only (loop `adopt` step: "a Designer components slot").
  - `recipes.test.mjs:77` asserts "holds no adopt recipe while every Designer standard has no seeds".
  - Conform K2: "components.button: no package default, no seed, no createOnly reason (+56 more rows)".
- Why it matters: SKILL.md step 4 (pick or adopt a `registry:block`) has no verb, so every section and
  frame is an L4 create.
- Fix: wire contract `references[]` as seeds and extend `settle adopt` to a byte-exact `registry:block`.
- Size M. Code and data.

**P1-6. The repository's own source-ladder gate is red.**
- Evidence: `node scripts/check-source-ladder.mjs` exits 1 with "17 failing rows ... stock-available 7,
  pin-stock-skipped 6, consumer-leaf-freeze 4". `check:gates` (root `package.json:59`) ends with it.
  Its unit test passes 23/23.
- Fix: record the 7 rejections and re-source the 6 fixture pins from `shadcn-aria/*`.
- Size S. Data.

**P1-7. Shipped bins import an undeclared dependency.**
- Evidence: `scripts/check-ref-verbatim.mjs`, `check-provenance.mjs` and `slot-pins.mjs` import
  `@clossys/producer/...`. Designer `dependencies` has no producer, and Producer depends on Designer.
  It works only through hoisting.
- Fix: declare `@clossys/producer` as a peer dependency, or move the bins to Producer.
- Size S. Code.

**P1-8. `config --init` points the consumer's Tailwind CSS at Producer's Studio stylesheet.**
- Evidence: `clossys/components.json` gets `tailwind.css: "../../…/producer/studio/styles/studio.css"`,
  a long relative path into the installed package.
- Fix: write a consumer-owned CSS path, or none.
- Size S. Code.

### P2: cost, speed and polish

**P2-1. Large outputs for a model to read.**
- Evidence:
  - `design --brief --json` is 40 KB. 16.8 KB of it is `leaves` (252 entries, 96 of them not placed in the
    consumer) (`cli/design.ts:71`).
  - `gaps --agent designer --json` is 106 KB with 312 rows.
  - SKILL step 2 says to read `src/catalog/slot-contracts/<layer>.json`, which is 214 KB for sections.
- Fix: drop `leaves` from the brief (or limit it to placed slots), add `gaps --summary`, and point step 2
  at `clossys slot designer/<slot> --json`.
- Size S.

**P2-2. Recipes and packets name repo-relative paths.**
- Evidence: every recipe says `--skill packages/designer/actions/...` and `packages/designer/standards/...`;
  `next --json` prints `skill.path: packages/producer/actions/ia/skill.md`. The CLI happens to resolve
  them, but a model reading a standard by that path in a consumer finds nothing.
- Fix: print installed paths, or a verb (`clossys standard <id> --json`).
- Size S.

**P2-3. Eight near-identical `craft.md` files (143–202 lines each).**
- Evidence: each repeats the same "Stages (slot-constitution 5b)" block of about 100 lines.
- Fix: generate the stages from one template plus `recipe.json` axes.
- Size M.

## 3. Model steps that should be verbs, and verbs that silently need judgement

**Model work that should be a verb (token waste):**
- **Hand-writing a stock pick.** SKILL.md step 5 has the model author `option.json` with `files[].content`
  "every code file in full" and `refVerbatim.files`. `clossys settle adopt` already does this byte-exact
  with zero tokens, and the skill never mentions it (`grep -rn settle skill/` finds nothing).
- **Assembling `brief.json` by hand.** Each recipe's stage 1 has the model list every requirement id and
  each pinned input's sha256, then run `recipe check`. `clossys craft brief` assembles exactly that
  (`cli/craft-brief.ts` `assembleBrief`), and no recipe or skill names `clossys craft`.
- **The source-ladder record.** SKILL.md:62-68 asks for `stars`, `weeklyDownloads` and `licence` of the
  chosen part and up to 2 rejected ones, written into Foundry's own `src/catalog/rules/source-roster.json`
  ("from a consumer repository, request it upstream"). That is web lookup by a model, and a consumer cannot
  complete it. The `--rung`/`--seed` on submit is already the consumer record.
- **31 theme crafts** (P1-1): one decision plus `recipe generate`.
- **Reading component and token guidance.** `components-guide.md` is 1225 lines and in the `uses` of
  `designer.candidates`. The skill tells the model to "Use `COMPONENT_GUIDANCE` ... from
  `@clossys/designer/components`" and `TOKEN_GUIDANCE`, which are JS exports with no CLI to print one
  entry. Needed: `clossys guide component <id>` and `clossys guide token <property>`.
- **Choosing the order of slots.** Nothing tells the model that themes must precede components (P0-3) or
  Director precede everything (P1-3). It learns from refusals.

**Verbs that silently need judgement:**
- `settle adopt` picks "the row naming this slot, then the row named for the fixture file, then the first
  row in manifest order" (`code-adopt.ts:120-125`). Manifest order is not a judgement anyone made.
- `code-adopt.ts:102` writes a Director realisation claim (P1-4).
- `ia designer --adopt` decides which 56 leaves are "unreachable" and prunes them. That pruning is wrong
  for band and section-header (P0-1) and is reported as a count, not a list.
- `foundry-ia.ts:180` declares Director inputs for every slot (P1-3). This is a modelling decision taken
  in code.

## 4. Where the skill text and the code disagree

| Skill text | Code |
|---|---|
| SKILL.md:17 "Four verbs, one action each" | 8 action folders. `designer.cascade`, `designer.scope` and `designer.slot` have a `skill.md` and no `action.json` |
| SKILL.md:25 compile "write generated types and files" | `designer.compile` and `design.ts` "nothing generated or pinned"; it prints the projection only to `--out` |
| `actions/designer.brief/action.json` "Print the Designer derivation brief" (`clossys design --brief`) | Its `skill.md` is the tighten step (`clossys brief --tighten`): two different "briefs" under one id |
| SKILL.md:83 create = "copy the closest trusted reference verbatim ... (`derived`)" | `create.frame` and `create.app-section` have `sources: ["composition"]`; submit refuses `derived` (census message). Frame, section and token standards are `createOnly` with no seed |
| SKILL.md:116 "the gate refuses a code file without [`refVerbatim.files`]" | `check-ref-verbatim.mjs:1705` refuses `refVerbatim` on a composition (REF-ADAPTATION) |
| SKILL.md:79 "Cite a `registry:block` ... for a frame or section" | `standards/frame` "Frames are crafted compositions ... no seed registry" |
| SKILL.md:204 band goes in `registryDependencies` | Composition recipes declare parts in `meta.source.parts[]`. `check-section-tokens.mjs:154` reads only `registryDependencies` |
| SKILL.md:206 "Fill `sections.band` ... first" | Adopt never places it (P0-1) |
| SKILL.md:134 `pin ... <element>-v<N> --by "owner:queue.pick#<id>"` | Needs `<element>-v<N>.json` and an existing queue entry (P0-5) |
| SKILL.md:68 "`npm run check:source-ladder` fails without it" | Repository-only script, not shipped. A consumer cannot run it |
| SKILL.md:263 "`check-section-tokens.mjs` / `check-page-overflow.mjs`" | Shipped as bins `designer-section-check` / `designer-overflow-check` |
| director-brief.md:33 "through the installed Producer API" | It is the CLI `clossys next --submit` |
| director-brief.md:73 "The check includes native value-contract and token-contrast findings" | `design.ts` `checkDesign` has no contrast or value-contract check |
| `pin.ts:109` comment: an agent seat uses `clossys pick`, never `pin --by agent:` | e2e `craft.frame.pin` runs `pin ... --by agent:designer` (exit 0); it is routed to pick |
| SKILL.md "Done when" does not mention themes before components | Button adopt fails without a pinned or default theme (P0-3) |

A low-tier model following SKILL.md literally would hit, in order: an unplaced band (P0-1), hand-written
stock items (section 3), a pin usage refusal (P0-5), and `derived` refused by the frame recipe.

## 5. Missing or vacuous checks and tests

- **`designer-ref-verbatim --pinned` with no pins.** It exits 0 ("ok; 0 pass, 0 baselined, 0 exempt") and
  is the skill's Done-when gate. It should exit 1 or report vacuous when nothing was checked.
- **The e2e uses toy contracts.**
  - `producer/e2e/{component,frame,section}.contract.json` each carry `requirements: [{check:"source.ref"}]`
    and no band, `tokens.only` or `compose.layers` (hero has no `registryDependencies`).
  - It seats slots with `ia designer --start` plus custom contracts, never the recommended
    `ia designer --adopt`.
  - It crafts no `themes.*` slot.
  - So none of P0-1, P0-3, P1-1 or P1-3 can show up red.
  - Needed: one scenario on `--adopt` with real package contracts.
- **The adopt e2e passes only on a pre-installed lockfile.** The scenario's own `cn@0.5.1` dependency hides
  P0-2.
- **Recipes ship no fixture output.** Conform K4 is red for all 8 ("recipes/create.app-section: ships no
  fixture output"). The recipe tests check stage files, not a certified candidate.
- **`recipes.test.mjs:77` enshrines a gap.** It asserts no adopt recipe while standards have no seeds.
- **Source-ladder test versus gate.** `check-source-ladder.test.mjs` passes 23/23 (mutation fixtures)
  while the gate itself fails on the tree (P1-6). The test proves the rules, not the data.
- **Counts tests are change detectors.** `src/catalog/counts.test.ts` hand-pins leaf totals with a
  27-line history header. They break on every regroup and prove nothing about behaviour.
- **R05.1 and R15.1–2 look unenforced in conform but are enforced.** Conform K1 and K3 are red ("R05.1 is
  building, not enforced"), yet `constitution/guard.ts:4` refuses on any finding "whatever the check's
  status". The cell measures a label, not behaviour.
- **Conform cells red only because they are empty.** L4, L5, Q7 and Q8 are red with "vacuous: nothing to
  judge (empty is red)". They are correct but crowd out real reds; report them separately.
- **No check that every `parts`/`anatomy` slot is placed** (P0-1).
- **No check that skill commands parse.** Nothing runs each `npx clossys ...` line in SKILL.md, the action
  skills and the recipes against the arg parsers. P0-5 and the `--basis` drift would fail it.
  `skill-companions.test.ts:71` checks only that bin names exist.

## 6. Simplifications

- **The `library-*` companions.** Remove `skill/library-{commands,choose,emit,check,studio}.md` (about
  310 lines) and the `bin:designer-library` exception. They describe a second, older "consumer library"
  model (receipts, `designer-library recommend` "unavailable", `select` "unavailable") beside the slot
  model. Keep `library-needs.md`'s request part only. `src/library-cli` (3.1k lines) can then be audited
  for removal.
- **The manual loop in SKILL.md (steps 1–8).** Replace it with "run `clossys next --json` and follow the
  packet". The `loop.create` and `loop.choose` loops already sequence triage, adopt, create, certify and
  pick. Two procedures for one flow is the source of most of section 4.
- **Three descriptions of one slot.** `src/catalog/slot-contracts/<layer>.json` (purpose, limits,
  references), `src/catalog/slots/<layer>.json` (anatomy, copy fields) and the consumer `slot.json`
  `contract` derived from them. Make the derived `slot.json` the only thing a model reads.
- **Two ways to declare composed parts.** `registryDependencies` (section-tokens) and `meta.source.parts`
  (composition gate): keep `parts`.
- **31 single-variable theme slots** can become one palette slot with a deterministic fan-out (P1-1). This
  removes about 30 slots, ledgers and cascades.
- **The eight `craft.md` files** can be generated from one stage template (P2-3).
- **`design --brief` `leaves` and `componentSourcePreference`** (a constant) can go from the brief payload.

## 7. Top 5 recommended units, in order

1. Place contract `parts`/`anatomy` slots on `ia --adopt` (add them to `declaredUses` in `foundry-ia.ts`)
   and add an `--adopt` e2e scenario on real package contracts that crafts one theme and one section with
   the band.
2. Make code adopt succeed on a fresh consumer. Name and install the stock base packages (`cn`,
   `react-aria-components`, `class-variance-authority`) through one queue entry, and ship `shadcn/neutral`
   as the package default for every `themes.*` slot.
3. Collapse the 31 per-variable theme crafts into one owner palette packet plus
   `clossys recipe generate create.tokens` fan-out, and strip the tenant Director quotes from all recipes.
4. Rewrite SKILL.md and the action skills to the packet flow (`next` → `settle adopt` → `craft` →
   `next --submit` → `answer`/`pin <file>.json`), delete the `library-*` companions, and add a test that
   parses every documented command.
5. Derive Designer slot inputs from each standard's `derive.director` traits instead of all 8 brief inputs,
   and stop `settle adopt` from writing a Director realisation claim.
