# Reflection: Publisher

Scope: `packages/publisher` (layouts, page assembly from frame plus sections, install into a Next app, release
gates, the site/docs/admin publications, its skill and actions) and the Producer code that executes those verbs
(`packages/producer/src/actions/page-option.ts`, `actions/publisher.ts`, `publish/*`, `release/*`,
`cli/init-admin.ts`, `cli/init-starters.ts`, `cli/starter-plan.ts`, `constitution/criteria/publisher/st-p/page.ts`).

Base: `5a2e197ea` (branch `claude/r2f-int2`). Read-only: no source file changed.
Serving model: `claude-opus-5-5` (session `last_served_model`).

Method: read the skill, every action skill and action.json, both recipes and their stage checks, the standards,
defaults, starters and the Producer code paths above; built all packages; ran `conform --all --json`; then ran a fresh
consumer (`clossys config --init`, `clossys init`, `clossys init --starters site`) and drove the documented verbs
against it. Every "ran" below is that consumer, not a fixture.

## 1. What exists and works

- Slot tree as data: three L0 files `packages/publisher/src/catalog/ia/{composition,directory,release}.json`
  with leaf freezes; 22 layouts, 6 chrome, 27 pages, 5 publications, release slots, all with a package default under
  `defaults/<slot>/` (`ls defaults | sed 's/\..*//' | uniq -c`: 6 chrome, 22 layout, 27 page, 5 publication).
- Option checker: `src/check/page-sections-instance.ts` (instance keys, role/kind admission, retired units, no
  words, no styling, page-id links); its tests run it over all 27 starter defaults.
- One page shape adapter: `producer/src/actions/page-option.ts` reads a `clossys.page/1` record as a layout-role option
  so the same checker judges both; `clossys publisher check` runs it over every page candidate (exit 0/1/2).
- Release chain: `clossys publisher release <pub> --build|--manifest|--gates|--ready`
  (`producer/src/cli/release.ts`) is always preceded by `publisher.check` over the pinned pages
  (`actions/publisher.ts:194-212`); 7 record gates in `release/gates.ts:51`; manifest id is the sha of the bytes.
- Install: `publish --install --page`, `--site`, `--next --assembly`, `--next --bind` (`producer/src/publish/`),
  marker-guarded route files, tab expansion from IA groups (`publish/expand-tabs.ts`).
- Admin seat: `clossys init` places 6 admin slots and seeds each with its default translated to `clossys.page/1`
  (`cli/admin-plan.ts:123 adminPageRecord`). Ran: `seeded 6 admin records; pinned 0; 6 wait for upstream pins`.
- Starter seat: `clossys init --starters site` places 7 routed pages + `publication.site` and files 39 slot requests
  to Designer/Writer for the units they cite. Ran: `seated the site publication: 8 Publisher slots placed`.
- Loops: five loop candidates under `loops/`, adopted and pinned by init (`adopted and pinned 10 agent loops`).

## 2. Gaps

### P0: blocks a consumer finishing the flow

**P0-1. Site/docs/app pages have no deterministic first candidate; the package default cannot be submitted.**
Evidence: `init-starters.ts:14` "No candidate and no pin is written". Ran `init --starters site`:
`7 site pages hold no candidate yet (first fill: clossys run loop.create ...)`. The default is a layout-role option
(`defaults/page.home/starter-v1.json` `content.layout/sections[].role/use/copy`), which the candidate schema
refuses: `next --submit ../default-content.json ... --rung adopt` gives
`fails schema candidate-publisher: / matches none of anyOf` (also with `meta.source` added). The adopt rung cannot
name the default either: `R03.2 adopts seed publisher/page.home/package:starter-v1.json, which names no candidate`.
The only translator is admin-only (`admin-plan.ts:123`).
Why: every site page today needs a model to hand-convert a JSON shape. That is pure mechanics, at the most error-prone
step (see section 4), repeated 7 times for site, 4 for docs, 5 for app.
Fix: generalise `adminPageRecord` to every starter page, write it as `<page>-v1.json` at `init --starters` (as admin
does) and pin through the pin gate when upstream pins exist; accept `package:<file>` as an adopt seed.
Size: S-M (the translator exists; move it out of admin-plan and call it from init-starters). Pure code.

**P0-2. `publish --install` cannot reach `Findings: 0` without an undocumented module.**
Evidence: `producer/src/publish/install.ts:658` pushes `need-component-selection` whenever `--selection` is
absent; `publisher/src/install/host.ts:27` says "Publisher supplies no default". SKILL step 7 and "Done when"
(`skill/SKILL.md:195,265`) give `publish --install --page <id> [--out <dir>]` with no `--selection` and promise
`Findings: 0`. Nothing in any skill says what the module exports or who writes it (`grep -rl "component-selection"`
over all skills/actions: none; the only writer is a repo test script, `producer/scripts/site-template-install.mjs:28`).
The release recipe `recipes/release/craft.md` step 1 also omits `--selection`, so `--build` has the same NEED.
Why: the last step of the Publisher loop and the release build are unreachable for a low-tier model.
Fix: `clossys init` writes a default `clossys/component-selection.ts` (or the host falls back to the Designer
pinned theme); add `--selection` to SKILL step 7 and the release recipe. Size: S. Pure code; which default is a
Designer decision once.

**P0-3. The shipped Next site template points at things a fresh consumer never has.**
Evidence: `templates/site/package.json:7` hardcodes `--site site ... --selection {{consumer-root}}/clossys/component-selection.ts`;
no verb creates that file (P0-2). Its parity checks run against a fixture consumer with publication `example-site`
and a hand-made selection (`producer/scripts/site-template-install.mjs:25-28`), never a freshly initialised one.
The SKILL never names `publisher-site-instantiate` or `--bind`; it documents only `--next --assembly <module> --live`
(`SKILL.md:237-238`), and an assembly module is something no verb writes either.
Why: "install into a Next app" is the product promise; the documented path needs two hand-written modules.
Fix: SKILL documents `publisher-site-instantiate` then `npm run publish:site` (`--bind`); make the check run on
`init --starters site` output. Size: S (docs) + M (check on a real init). Pure code/docs.

**P0-4. `pick.publisher` pass command runs a script Producer does not ship.**
Evidence: `actions/pick.publisher/action.json:26` runs `node ../producer/scripts/check-slot-options.mjs`;
`packages/producer/package.json` `files` lists only `scripts/check-generated-derived.mjs` and
`scripts/consumer-root.mjs`. In an installed consumer the pass step is `MODULE_NOT_FOUND`, exit 1, which the action
reads as `fail`, not `error`. Same in the Designer, Director and Writer pick actions.
Fix: ship the script (or make `check:slot-options` a `clossys` verb). Size: S. Pure code.

**P0-5. The admin publication, a "fixed Publisher responsibility", stays unpinned in a fresh consumer.**
Evidence: ran `clossys init`: `raised 10 Designer slot requests ... pinned 0; 6 wait for upstream pins`, then
`clossys publish` -> `publish: could not run: Publisher has no publication` (exit 2). Init adopts the Director IA but
not the Designer or Writer IA, so the frames/sections the admin pages compose are never placed, and nothing in the
Publisher skill says what unblocks it.
Fix: init adopts the Designer and Writer IAs for the admin composition (or seeds their defaults the way it seeds
admin pages), and `publish` with no pinned publication exits 1 with the waiting list, not 2. Size: M. Pure code.

### P1: wrong or unreliable result

**P1-1. Three page validators disagree; the same record passes one and fails another.**
- `publisher check` (adapter, `page-option.ts:82`) requires `path === ` slot path, so `/<slug>`; the recipe draft
  check (`recipes/stage-check.mjs:38,96`) only accepts `:param`. Ran on one record with `"path": "/<slug>"`:
  `clossys recipe check ... draft` -> `R15.3 page.assembled: path "/<slug>" is not a route`; `publisher check` -> no
  route finding. The judge (`st-p/page.ts` `ROUTE`) accepts both. Every dynamic page (`/<slug>`, `/docs/<slug>`,
  `/articles/<slug>`, `/app/<collection>`, `/admin/<agent>`) fails the recipe.
- A slug-only record is valid to the adapter (`page-option.ts:78-81`) but `page.assembled` requires `path`
  (`st-p/page.ts:26`) and so does the recipe.
- Same section twice: SKILL says allowed (`SKILL.md:81-82,123,130`) and the option checker allows it; `page.assembled`
  and the recipe both refuse `a section is listed twice` (`st-p/page.ts:31`, ran above).
- The adapter keys a second mount's binding by the bare entry (`page-option.ts:106` `key0 = entries[index]`), so the
  SKILL's `bindings["sections.call-to-action#2"]` is never read by the checker, while install reads `#2`
  (`install.ts:458-465`).
Why: a model that satisfies one check is refused by the next; at low tier it loops.
Fix: one shared route regex, one duplicate rule (allow with `#n` instance keys), one slug rule, imported by all three.
Size: S per rule, M total. Needs one owner decision: whether a kind may repeat on a page.

**P1-2. Page links (call-to-action targets) are dropped between default and installed page.**
Evidence: defaults carry `links` (`defaults/page.home/starter-v1.json` `actions.primary: publisher/page.pricing`);
`clossys.page/1` has no `links` field (`page-option.ts:32 PAGE_RECORD_FIELDS`); the admin translator drops them
(`admin-plan.ts:123-141`); no install code reads `.links` (grep over `producer/src` and `publisher/src`: only
validators). Installed buttons cannot point at page ids.
Fix: add `links` to `clossys.page/1`, carry it in the translator, resolve page id -> route at install. Size: M. Code.

**P1-3. Status pages (404, 500) can never be seated.**
Evidence: ran `init --starters site`: `held publisher/page.not-found: a status page (404) has no route, and
page.assembled holds every page record to one` (and `page.error`). The site starter lists both
(`starters/site/publication.json`), and their defaults exist.
Fix: `page.assembled` accepts `status` in place of `path` for a `status` slot; install maps it to `not-found.tsx` /
`error.tsx`. Size: S-M. Code.

**P1-4. `publisher check` passes pages whose units no workspace slot holds.**
Evidence: fresh consumer after `init`: `publisher.check: 5 page records, 0 findings` while init itself raised 10
requests because no workspace slot holds those frames/sections. With a hand-placed translated `page.home` and no
Designer or Writer pin, still 0 findings for it. It reads the Designer *package* catalog (`actions/publisher.ts:122`),
not the consumer's slots or pins. Submit does check pins (`R05.1 frame frames.site-shell is no live pinned Designer slot`),
so the check the skill sends you to first is the weaker one.
Fix: add a held/pinned-unit finding to `checkPublisherPages` (reuse the R05.1 resolver). Size: S. Code.

**P1-5. Release gates prove records, not the shipped site.**
Evidence: `release/gates.ts:51` gates are copy-sample, pins-resolve, constitution-strict, copy-locales,
release-locales, slots-stale, requests-open-fix; nothing opens the built output. `release/build.ts:170-185` builds the
static substrate site, not the consumer's Next app, so a release can pass while `next build` of `apps/site` fails.
Standards are equally thin: `page` has 2 requirements (`page.assembled`, `page.no-inline-copy`), `publication` and
`release` 1 each. No gate checks internal links resolve, each page has a title and description, the 404 exists, or a
basic accessibility scan. (The header comment says "six gates"; the list has seven.)
Fix: a `release.output` gate over the build: every route returns HTML with `<title>`, every internal href is a route,
no `need-*` finding; optionally run the Next build when `apps/site` exists. Size: M. Code.

**P1-6. A repin upstream does not mark the page stale; pin accepts a hand-placed candidate.**
Evidence: conform dogfood rows `DF.publisher.CASCADE RAN-WEAK a repinned section does not mark the page stale`,
`DF.publisher.CHOOSE RAN-WEAK pin accepts a hand-placed candidate with no submit event`.
Fix: cascade walks Designer/Writer -> Publisher page edges (the page's inputs are its units); pin requires a submit
event. Size: M. Code (Producer side, Publisher-visible).

**P1-7. Conform: 16 of 36 Publisher cells red, 7 of them vacuous.**
Evidence (ran `conform --all --json`, same as census `int2-925ae7f.md:60-75`): S1 `package tree has 60 leaves, the
placed tree 0`; S3, L2, L4, L5, C4, Q7, Q8 `vacuous: nothing to judge`; S6/C1/C2 `layout.*: declares no inputs list /
no family / no requirements` (+58 each); K2 `release.*: no package default, no seed, no createOnly reason` while SKILL
says `A release has no default: its manifest is written by code` (`SKILL.md:64`); K3 `publication: no certifier`;
Q6 `requests.issuing to director: no input or uses edge`.
Why: the conform surface cannot tell a working Publisher from an empty one.
Fix: the dogfood consumer places the Publisher tree (clears S1 and the 7 vacuous cells); declare `createOnly` with
the code reason on the release standard (K2); either give layouts/chrome contracts with inputs or exclude
non-candidate kinds from S6/C1/C2; drop the `director` issuing edge or add the input. Size: S each. Mostly data.

### P2: cost, speed, polish

- **P2-1. Publisher build is dominated by the client-boundary check.** Measured: `tsc` finished in under a minute,
  then `check-client-boundary.mjs` ran over 7 minutes wall (35 s CPU) for 35 export subpaths. Every
  package build and CI run pays this. Fix: cache by tree hash (it already computes `binding()`), or
  scope it to the web subpaths. S.
- **P2-2. 60 731 lines of non-test TypeScript, 269 test files.** Most is legacy surface (see section 6). Each subpath
  costs build, boundary scan and pack time.
- **P2-3. Two-format SKILL is 270 lines.** A low-tier model reads two contradictory page shapes before the loop
  (section 4). Halving it is free tokens on every invocation.
- **P2-4. `release.*` K2 and `publisher.brief` drift are noise in every conform and gaps run.**

## 3. Model work that should be a verb; verbs that silently need judgement

Should be verbs (token waste today):
- Translating a package default into `clossys.page/1` (P0-1). It is deterministic: `adminPageRecord` already does
  it. Today the model reads the layout, the default, the role table and the adapter rules and retypes it.
- Listing a page's copy slots and their Writer refs (SKILL steps 2-3). The model reads every Designer candidate's
  `meta.element.reads.copyKeys` and every Writer `### ` record by hand. A `clossys publisher copymap <page>` that prints
  slot -> candidate Writer refs (and the missing ones as ready-to-file requests) removes the step.
- Writing the verdict JSON. The verdict shape lives only in `producer/pipeline/schemas/verdict.schema.json`
  (`{schema, slot, create, reason, gaps:[{id}]}`); my first two attempts were refused (`must match exactly one of
  oneOf`). For an adopt-able slot it should be emitted by `clossys options --verdict`.
- Filing the NEEDs in SKILL steps 1 and 3 ("raise a Designer NEED ... and stop"). `init --starters` already raises
  them; the skill should say "read `clossys request --list --open --agent publisher`", not re-derive.
- The 4-stage craft for a page whose default already fits (brief, diverge, render, critique). Submit at `create`
  refuses without them (`R15.7 craft events (none) are not brief, diverge, render, critique`). Most site pages
  are adopt, not create; P0-1 removes the craft run for them.

Verbs that silently need judgement:
- `pageOptionOf` infers a section's role from its copy key, else "the first free role that admits the section",
  else the section's leaf name (`page-option.ts:114-116`). That is a placement decision made silently; a wrong
  guess surfaces as `role X is not a role of layout Y` with no hint that the record has no role field.
- `pageOptionOf` picks the layout "whose roles admit every section first", else the first one (`page-option.ts:94-98`).
  With two layouts sharing a frame the record's layout is decided by order, not stated.
- `pick.publisher` is `decide:judgment` but its pass check (`slot-options`) only proves the option is listed; nothing
  records which criteria the pick met.

## 4. Where the skill and the code disagree

A low-tier model following `skill/SKILL.md` literally fails at these points (all ran unless marked):

1. **The worked page example fails the checker 7 times.** `SKILL.md:117-134` copied into a candidate:
   `publisher.check: ... 7 findings`: `page.title: "Home" is not a Writer ref`; `sections.hero binds no Writer record
   (bindings.sections.hero.copy)` (x4, the page-wide `copy` map is not used for sections);
   `role call-to-action is not a role of publisher/layout.marketing-home`; `meta: a page option names its Writer meta
   record`. SKILL line 136 also says `title` is a plain string; the code requires `<writer slot>#<key>`.
2. **"Work from candidates; you do not wait for Designer pins"** (`SKILL.md:162-163`) vs submit:
   `R05.1 frame frames.site-shell is no live pinned Designer slot`; recipe: `R07 frame ... is not a pinned Designer
   frame -- fix: ... pin it first`; action inputs read only `designer/*/pin.json` (`publisher.candidates/action.json`).
3. **Submit command** (`SKILL.md:177-179`) is refused on a fresh slot: `rung create ... needs the slot's latest verdict
   to be create; the slot has no verdict`; then `R15.7 craft events (none)`. The loop never says to run the recipe's
   stages before step 4 (only line 155 mentions the recipe in passing). Conform says the same:
   `DF.publisher.CREATE RAN-FAILED the skill omits the craft stages`.
4. **Two page shapes, one example each, the second labelled "today's path"** (`SKILL.md:66-94` vs `115-150`). The
   "target" shape (layout + roles) is not submittable at all (P0-1).
5. **Same section twice** is documented as supported (`SKILL.md:81-82`, example lines 123/130) and refused by the
   judge and recipe (P1-1).
6. **`publish --install --page <id> [--out <dir>]` then `Findings: 0`** (`SKILL.md:195,265`): code emits
   `need-component-selection` without `--selection` (P0-2).
7. **"refine brief: `clossys` slot tighten (no Publisher action folder yet)"** (`SKILL.md:24`): the folder exists
   (`actions/publisher.brief/skill.md`, verb `clossys brief ... --tighten`) but has no `action.json` and is not in
   `actions/ia.json`, so no packet routes to it.
8. **Tab pages** (`SKILL.md:237`) document `--next <app dir> --assembly <assembly module> --live`; the shipped
   template uses `--bind --selection` (`templates/site/package.json:7`); `--bind` forbids `--assembly` and `--live`
   (`producer/src/cli/args.ts:206`).
9. **Status pages** are listed among the 27 pages and five starters; two of them cannot be seated (P1-3).
10. **Recipe fix text points at an invalid form**: draft check fix `bind the title to a Writer key (for example
    studio.page.<id>)` (`stage-check.mjs:102`) proposes a bare key the adapter refuses (`page.title ... is not a Writer
    ref <writer slot>#<key>`); its path fix proposes `/segment/:param`, which the slot path `/<slug>` never equals.
11. **Cascade and Requests sections are marked DRAFT, not approved** (`SKILL.md:214`,
    `publisher.candidates/skill.md` Requests, `publisher.slot/skill.md` Requests, `publisher.cascade/skill.md`) but are
    wired into `conform.json` `skills` and loop candidates as live handlers.

## 5. Missing or vacuous checks and tests

- `recipes/recipes.test.mjs` (the only test that the recipe draft check agrees with the judge) runs under
  `node --test` and is invoked by no npm script and no CI workflow (`grep -n recipes package.json
  .github/workflows/ci.yml`: no match; `packages/publisher/package.json` `test` is `vitest run`, which does not
  collect `.mjs` under `recipes/`). Its fixture consumer is `producer/test-fixtures/consumer`, not an init output.
  The `/<slug>` disagreement in P1-1 is exactly what it would have caught.
- `src/check/page-sections-instance.test.ts:21` "every one of the 27 starter page defaults passes": proves the
  defaults satisfy the option checker, a shape the candidate schema refuses (P0-1). Nothing tests a default after
  translation through `page.assembled` + install.
- `publisher check` 0 findings on an unplaced composition (P1-4): a green check with nothing behind it.
- `publish.page` and `publish.install` actions declare `checks: ["workspace"]` and `pass.command: "clossys publish"`
  (`actions/publish.*/action.json`): the pass is the verb itself, so no independent check confirms what the verb reports.
- Site template parity (`check:route-parity --surface site-template`) runs against a fixture publication
  `example-site` with a hand-made selection module, not `init --starters site` output (P0-3).
- Release gates never read the built HTML (P1-5).
- Conform cells S3, L2, L4, L5, C4, Q7, Q8 are vacuous for Publisher (P1-7).
- `pick.publisher` pass is unrunnable outside the monorepo (P0-4), so every pick test in-repo passes on a path
  consumers never take.
- No test asserts that `links` survive install (P1-2) or that a `#2` binding is honoured by the checker (P1-1).

## 6. Simplifications

- **Delete the layout-role page shape as a candidate format.** Keep it only as package-default source and convert at
  init (P0-1). Then `checkPublisherPages` loses its second branch (`actions/publisher.ts:153-160`), the SKILL loses
  `SKILL.md:66-94`, and one validator family remains.
- **Collapse three page validators into one module** (`st-p/page.ts assembled`, `page-option.ts`,
  `recipes/stage-check.mjs DRAFT_CHECKS`). The recipe check should import the judge's regexes, not copy them; R16.1
  forbids the judge importing the recipe, not the reverse.
- **Subpath exports used by no agent flow.** Non-test importers outside `packages/publisher`, excluding the
  export-readiness script that imports every export: none for `email` (1 199 lines), `print` (940), `image` (1 039),
  `pack` (2 134), `materials` (315), `surfaces` (112), `templates` (277), `assessment`, `archetypes` (843), `content`
  (4 860), `document` (1 342); `record` (2 035) only by one staging script. About 15k lines plus their tests, and 9
  bins listed as "owner decision" in `actions/exceptions.json`. Moving them out (or deprecating) shortens build,
  boundary scan and pack, and the SKILL never mentions them.
- **Publisher ships view components** (`src/web/views`, 114 files: `HeroCompact`, `ContactView`, `AuthView` ...)
  that the Designer re-exports (`designer/src/runtime/frames/site-shell.tsx`,
  `designer/src/importers/publisher-sections.ts`). The role rule is "Publisher never designs"; these belong to Designer,
  and moving them removes a reverse dependency.
- **`publish.page` and `publish.install` are one verb with flags**; the two action folders with a single
  `action.json` each and no skill could be one action with two modes.
- **`publisher.brief/skill.md`** has no action, no IA entry and a SKILL line saying it does not exist: wire it or
  delete it.

## 7. Top 5 recommended units, in order

1. Seed every starter page (not only admin) with its default translated to `clossys.page/1` at `init --starters`,
   accept `package:<file>` as an adopt seed, and delete the layout-role shape from candidates and the SKILL.
2. Make `publish --install`, the release build and the site template work on a fresh init: a default component
   selection module written by `init`, `--selection` in the SKILL and release recipe, and the template parity check run
   on `init --starters site` output.
3. Unify the page rules (route `<param>`, slug, repeated sections with `#n`, status pages, `links`) in one module that
   the judge, the adapter and the recipe draft check all import, and put `recipes.test.mjs` in CI.
4. Rewrite `skill/SKILL.md` around the one shape and the real loop (verdict JSON, craft stages or adopt, pinned
   upstream, `--bind`), with a worked example that `clossys publisher check` passes, and ship `check-slot-options.mjs`
   so `pick.publisher` runs in a consumer.
5. Make the checks prove something: `publisher check` fails unheld/unpinned units, a `release.output` gate reads the
   built HTML (titles, internal links, 404), and the conform dogfood consumer places the Publisher tree.
