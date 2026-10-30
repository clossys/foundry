# @clossys/strategist v2: the cell model (SPEC draft, 2026-10-29)

Status: design draft written by a planner-side subagent. It builds nothing: no repository was edited and nothing was pushed or posted.

What it upgrades: `@clossys/strategist` 0.6.0 (facts, claims and brand-facts model) in clossys/foundry. The reference ref is `origin/codex/integrate-scroll-preview` @ 003e3590e.

What it upgrades to: the owner's cell model. Strategy lives in one L0–L3 tree. Each L3 cell is one versioned Markdown file of bullets. A loop runs over the tree: set → cascade → measure → review → steer.

Companion files in this folder:
- `catalog/tree.json` holds all 57 cells with names, questions, must-contain keys, functions, feeds, links and core flags. It is generated and validated: 57 cells, 28 L2 nodes, 7 L1 nodes, 24 core cells, 11 links.
- `templates/cell.md` holds the cell template and a worked example.
- `skill/SKILL.md` holds the conversation playbook. It ships in the package and works today, by hand, with no package code.
- `INTERVIEW-KICKOFF.md` holds a paste-ready prompt for the first real interview.

Constraints that bind every unit below:
- No package version bump. The freeze holds; changesets only.
- No landing to main.
- No scanner or allowlist edits.
- Content lives with the consumer and never in foundry.
- Foundry ships machinery only and never names a consumer.

Every choice the owner did not fix is marked **DEFAULT**. None of them blocks.

---

## 1. Architecture

### 1.1 Layers

| Layer | Lives in | Owns |
|---|---|---|
| Catalog | `packages/strategist/src/catalog/` | The 57 cell definitions, the grouping tree, the leaf freeze, archetype core sets, coherence links and contradiction pairs. Package data only, no business content |
| Formats and reader | `packages/strategist/src/format/`, `src/store.ts` | Parsing and serialising cell files, the tree file, session logs, findings and requests. Reading a consumer root into one typed model |
| Read API | `src/api.ts`, `src/brief.ts` | `openStrategy` → `getCell`, `getActive`, `getBrief`, `isStale`. Compiling briefs against contracts owned by the consumer packages |
| Checks | `src/checks/` | Quality (Q1–Q7), coherence (C1–C4), completion levels and MVS |
| Write path | `src/write/` | `propose` (new draft version), `activate` (needs a user confirm ref), requests |
| Citation index | `src/citations/` | The central index of who cites which `{cell, version}`, plus drift |
| Grounding | `src/ground/` | The 0.6 facts gate retargeted at findings, and won't-claim retargeted at Proof `Never-claim:` bullets |
| Loop | `src/loop.ts` | Review: Watch tripwires against findings, due reviews, stale cascades. Produces requests and never activates anything |
| CLI | `src/cli.ts` | `strategist-check` subcommands (§1.11). `strategist-rate-check` is kept unchanged |
| Skill and roles | `skill/SKILL.md`, `skill/roles/*.md` | The conversation playbook and the seven role prompts. Agent-neutral and consumer-neutral |
| Evals | `evals/strategist/` (package-local) | 3 fictional test businesses, 1 adversarial business, a rubric and the run procedure |

Kept from 0.6.0 unchanged:
- `engagement-context.ts`, `brief-contract.ts` and `scripts/pack-brief-contract.mjs` (the packed engagement brief);
- `strategy-traceability-rate.ts` and its bin;
- `validation.ts` and `json-file.ts`.

### 1.2 Package catalog files (DEFAULT layout, following the trio IA pattern)

| File | Content |
|---|---|
| `src/catalog/ia/strategy.json` | Grouping only: `{schemaVersion, nodes:[{id, name, question, children:[{id, name, leaves:[cellId]}]}]}`. Mutable: L1 and L2 can be regrouped |
| `src/catalog/cells/strategy.json` | One contract per cell: `{id, names, question, mustContain:[{key, hint}], functions[], links:[{cites, label}]}` |
| `src/catalog/ia/strategy.leaf-freeze.json` | `{frozenAt, leaves:[57 ids]}`. A leaf id may never be renamed or removed. Adding a leaf needs a new freeze entry |
| `src/catalog/archetypes.json` | `default` (the 24 core cells) plus `product-saas`, `services` and `marketplace` extras |
| `src/catalog/coherence.json` | C1 links, C2 contradiction pairs and the C4 storyline cells |
| `src/catalog/lexicon.json` | The banned generic phrases for Q5, and the trade-off markers for Q6 |

`catalog/tree.json` in this folder is the single-file source those six files are cut from. ST-0 splits it mechanically.

Catalog validator rules (`validateCatalog`), each with its own rule id:
1. Ids match `^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$`.
2. Each leaf is placed exactly once in the grouping, and its l1.l2 prefix equals its parent nodes.
3. No node name contains `&` or the word `or`.
4. Each cell has 2–4 must-contain keys, which are unique within the cell.
5. Every link, contradiction, storyline and archetype id resolves.
6. Every leaf is in the leaf freeze, and every frozen leaf is present.
7. No archetype extra repeats a default core cell.

### 1.3 Consumer root

The centralized layout below supersedes earlier root examples in this draft. Historical before-state paths in the integration inventory remain references to the prior implementation.

The default root is `<repo root>/clossys/agents/strategist/` (A207). CLI defaults find the repository root from nested working directories; outside a repository they use the working directory. Manifest feeds use `clossys/agents/strategist/`. The shared consumer-layout contract is coordinated by its own owner.

A consumer can name another root with `--root <dir>`, or with the `root` option of `openStrategy`. The product interview writes to `<repo root>/clossys/agents/strategist/`. Relative explicit roots resolve from the working directory. There is no legacy fallback or automatic migration.

```
<root>/
  tree.json                    grouping overrides, archetype, core override, active pointers
  cells/<cell-id>/v<N>.md      one file per version; the only documents
  sessions/<YYYY-MM-DD>-<n>.md conversation log, bullets only (U<n>: user, S<n>: strategist)
  findings/<finding-id>.md     researched or observed evidence
  requests/REQ-<NNNN>.json     requests from any agent
  contracts/<contract-id>.json optional consumer-local brief contracts (for contracts outside foundry)
  briefs/index.json            GENERATED: compiled briefs and their fingerprints
  briefs/<contract-id>.json    GENERATED
  citations.json               GENERATED: the central citation index
```

L0, L1 and L2 views are rendered on demand by `status` and the read API. They are never stored.

### 1.4 `tree.json` (consumer)

```json
{
  "schemaVersion": 1,
  "catalog": "@clossys/strategist#strategy-v1",
  "archetype": "default",
  "core": "archetype",
  "tree": [{ "id": "context", "name": "Context", "children": [{ "id": "context.market", "name": "Market", "cells": ["context.market.size", "context.market.trend"] }] }],
  "active": { "context.customer.need": 1, "context.market.size": null }
}
```

- `tree` is optional. When it is absent, the catalog grouping is used. When it is present, it must place every catalog leaf exactly once and may rename or regroup L1 and L2 nodes. It can never rename a leaf.
- `core` is either `"archetype"` or an explicit array of cell ids. **DEFAULT**: an explicit array must still contain every default core cell.
- `active` is the only place the active version is stored. A cell file's own `status` must agree with it; a mismatch is a C3 finding.

### 1.5 Cell file `cells/<id>/v<N>.md`

```markdown
---
id: focus.segment.core
version: 2
status: active
updated: 2026-10-29
cites: [context.customer.need@1, msg:2026-10-29-1#U4, finding:studio-survey-2026]
feeds: [writer.messaging, customer.persona]
functions: [gtm, product]
confirmed: msg:2026-10-29-1#U9
note: Narrowed from v1 after the pricing pushback.
---

## Direction
- Who: ...
- Situation: ...
- Not: ...

## Because
- ... (msg:2026-10-29-1#U4)

## Watch
- If ... then ...
```

Frontmatter. The format is a YAML subset: `key: scalar` and `key: [a, b]` flow lists, one level, no nesting, values unquoted or double-quoted. The package stays dependency-free.
- `id`, `version`, `status` (`draft` | `active` | `retired`), `updated` (ISO date), `cites[]`, `feeds[]` and `functions[]` are the owner's set and are required.
- `confirmed` (**DEFAULT**) is required when `status: active`. It is a `msg:` ref to the user line that confirmed the cell.
- `note` is optional. It records why this version differs from the previous one.
- `links` is an optional flow list of shared cell references: `[<agent>:]<cell-id>@<N>`. Shared link ids have two or three lowercase kebab segments (digits after the first letter are allowed); versions are positive safe integers without leading zeroes. For example, `designer:frames.app-shell@1` and `writer:admin.writer@3`. These links are parsed as references, with cross-agent resolution left to the consuming agent. A missing field stays absent when serialised; an explicit `links: []` stays present. Strategist cell ids retain their frozen three-segment grammar.

Shared-contract alignment currently accepts an optional empty `retired: []` on the consumer tree. Nonempty retired-id lists are refused because permanent catalog-id retirement is not implemented by the Strategist write path. Migration confirmation parsing and the CELL-0 parser import remain pending; Strategist still requires the existing `msg:` confirmation and user playback checks for activation.

Body. Exactly three sections, in this order: `## Direction`, `## Because`, `## Watch`. Every line is a `- ` bullet; there is no prose.
- **Direction.** Between 2 and 6 bullets. Each must-contain key appears as a leading `Key:` label on one bullet. Extra bullets may be unlabelled.
- **Because.** Every bullet ends with one or more refs in parentheses. The frontmatter `cites` must equal the union of Because refs (**DEFAULT**).
- **Watch.** Every bullet follows this grammar:
  `If <signal> <comparator> <threshold> (by <date> | each <period> | in any <period>), then <action>.`
  - Comparators: `>`, `<`, `>=`, `<=`, `=`, `rises above`, `falls below`, `reaches`, `stays below`, `stays above`, `is still`, `appears`.
  - The threshold has a digit or a quoted value.

Ref grammar (`parseRef` and `formatRef`):
- `<cell-id>@<N>` is a cell version.
- `msg:<session-id>#U<n>` or `msg:<session-id>#S<n>` is a session line.
- `finding:<finding-id>` is a finding.

A surface marker is `strategy:<cell-id>@<N>`. It goes in a comment, a copy record field or a JSON string. In JSON, `{ "cell": "<id>", "version": N }` is the structured form.

Lifecycle rules:
- Only the strategist role writes drafts. A draft may be edited in place.
- Active and retired files are immutable. A change is always a new `v<N+1>.md` draft.
- Activating `vN` sets `active[id] = N`. It retires the previously active version, and any sibling option drafts of the same cell, by rewriting only their `status` line (**DEFAULT**: the one allowed edit to a non-draft file).
- Options (§skill "Options before choices") are parallel drafts `vN`, `vN+1` and so on of one cell, each with `note: option A|B|C`. Activation picks one, and the others retire.

### 1.6 Session log, findings, requests

**Session log** `sessions/<YYYY-MM-DD>-<n>.md`. Bullets only.
- `- U<n>: <user words, verbatim or trimmed with [...]>`
- `- S<n>: <strategist line>`

A playback line that asks for confirmation lists the exact refs, for example `S12: Playback for confirm: focus.segment.core@2, advantage.proposition.promise@1`. The user's next U line is the confirm ref. One yes confirms the listed batch, and nothing outside the listing.

**Finding** `findings/<id>.md`.
- Frontmatter: `id`, `source` (a URL, a repo-relative path or `user`), `observed` (date), `by` (role), and optionally `value`, `unit` and `aliases[]`.
- Body: bullets only.
- Findings replace 0.6 `facts.json`, and `ground` reads them.

**Request** `requests/REQ-<NNNN>.json`.

```json
{ "id": "REQ-0007", "raisedBy": "@clossys/writer", "kind": "missing", "cells": ["identity.verbal.voice"],
  "detail": "writer.messaging brief requested; voice has no active version", "status": "open",
  "opened": "2026-10-29", "resolvedBy": null }
```

- `kind` is one of `missing`, `contradiction`, `tripwire`, `drift`, `reading` or `change`.
- `status` is one of `open`, `drafted`, `resolved` or `declined`.
- `resolvedBy` is a cell ref or `msg:` ref.

Write rights:
- Any agent may write a request.
- Only the strategist moves a request to `drafted`, by writing a draft cell.
- Only the user's confirm moves it to `resolved`, through activation.

### 1.7 Quality checks (L3)

`checkCell(cell, ctx)` returns findings, each with a rule id and a severity. **Hard** findings block activation. **Judge** findings are passed to the mid checker, whose `fail` verdict blocks activation as well.

| Id | Check | Hard (script) | Judge (mid checker) |
|---|---|---|---|
| Q1 size | Direction holds 2–6 bullets | count | none |
| Q2 must-contain | Every catalog key appears as a `Key:` label | label match | Is the labelled bullet a real answer, not filler? |
| Q3 grounded | Because has 1 or more bullets, each with 1 or more refs. Every ref resolves: the msg line exists, the finding file exists, and a cited cell version exists | resolution | Does the cited message actually support the bullet? |
| Q4 testable | Watch has 1 or more bullets, all matching the grammar | grammar | Is the threshold meaningful for this Direction? |
| Q5 specific | No banned generic lexicon (`lexicon.json`: "best-in-class", "world-class", "seamless", "cutting-edge", "innovative", "solutions", "customer-centric", "high quality", "everyone", "all businesses", "etc."). No hex colour in `identity.visual.*` | lexicon, hex | Flagged when a bullet has no number, no proper noun and fewer than 5 words |
| Q6 real choice | At least one Direction bullet carries a trade-off marker (`over`, `not`, `instead of`, `rather than`, `never`, `only`, `no`), or the cell has a negative key (`Not`, `Never`, `Avoid`, `Refuse`, `Not-yet`, `Kill`) | flag only when absent | Is there a real alternative that was given up? |
| Q7 confirmed | `status: active` has a `confirmed` ref. That ref resolves to a U line, and the S line before it lists this `id@version` | resolution and listing | none (authenticity is trust-based: risk R7) |

### 1.8 Coherence checks (L2 and L0)

- **C1 required links.** Defined in `coherence.json`, with 11 directed links. The downstream cell's active version must cite the upstream cell's active version.
  - The links are: need → promise, promise → differentiator, differentiator → pricing, core → channel, channel → acquisition, acquisition → release, essence → voice, voice → style, essence → style, long-term → north star, and bet → allocation.
  - A link applies only when both cells are in the current scope (core scope or full).
  - A citation of a version that is no longer active is a **stale** finding, not a missing one.
- **C2 contradictions.** There are 7 pairs (X1–X7 in tree.json).
  - Script pairs X1, X2, X4, X5 and X6 compare labelled bullets and quoted phrases.
  - Judge pairs X3 and X7 go to the high critic.
  - A confirmed contradiction always produces a request of kind `contradiction` and a proposed version of one side. It never edits an active cell and never activates.
- **C3 resolvable and current.** Every cite and every `active` pointer resolves. Status agrees with `tree.json` (§1.4). There is at most one active version per cell. No `feeds` entry names an unknown installed contract (a warning only).
- **C4 storyline.** The L0 view is one headline per storyline cell (need, mission, core, promise, essence, delivery, bet), taken from the first Direction bullet of each active version.
  - It is clean when every storyline cell is active and fresh, and the high critic's pass returns no gap.
  - In script-only runs, C4 checks presence and freshness, and the critic verdict is reported as `not judged`.

### 1.9 Completion levels (exact)

A cell is **fresh** when it is active and none of its cell cites is stale.

| Level | Definition |
|---|---|
| L3 active | `status: active` in the file and in `tree.json`, Q1–Q7 pass with no hard finding and no judge fail, and the cell is user-confirmed |
| L2 coherent | Every cell under the L2 is L3-active and fresh, and every C1 link and C2 pair touching those cells passes |
| L1 unlocked | Every in-scope core cell under the L1 is L3-active and fresh, and the C1 and C2 checks among core cells touching that L1 pass. Consequence: every brief whose required cells sit only under unlocked L1s can flow |
| L0 clean | All 7 L1 are unlocked, C4 is clean, C3 passes, there are no open `contradiction` requests and there are no stale active cells |
| MVS | L0 clean computed over the core scope only: every core cell for the archetype is active and fresh, core-scope C1/C2/C3 pass, C4 is clean and there is no open contradiction among core cells. MVS unlocks the first output, which is the first brief compile |
| Complete | All 57 cells are L3-active and fresh, all 28 L2 are coherent and L0 is clean |

There is no `n/a` status. "Not now" is itself a choice: a Direction bullet such as `Not-yet: …` together with a Watch that says when to look again.

Archetype core sets (in `archetypes.json`):
- `default` is the 24 core cells.
- `product-saas` adds `focus.lifecycle.retention`, `capability.operation.technology` and `execution.measure.driver`.
- `services` adds `capability.team.role`, `capability.competency.critical` and `advantage.model.margin`.
- `marketplace` adds `focus.segment.next` (the other side of the market), `focus.lifecycle.retention`, `advantage.defensibility.moat`, `execution.measure.driver` and `context.customer.buying`.

### 1.10 Read API and briefs

```ts
export type CellId = string;                       // l1.l2.l3
export interface CellRef { cell: CellId; version: number }
export type Ref = { kind: "cell"; ref: CellRef } | { kind: "msg"; session: string; line: string } | { kind: "finding"; id: string };
export interface Cell { id: CellId; version: number; status: "draft" | "active" | "retired"; updated: string;
  cites: Ref[]; feeds: string[]; functions: string[]; confirmed?: Ref; note?: string;
  direction: Bullet[]; because: Bullet[]; watch: Bullet[]; path: string }
export interface Bullet { key?: string; text: string; refs: Ref[]; line: number }
export interface BriefContract { id: string; schemaVersion: 1; owner: string; requires: CellId[]; optional: CellId[];
  keys?: Record<CellId, string[]> }   // which labelled bullets to carry; default: all Direction + Watch
export interface Brief { contract: string; state: "ready" | "missing" | "stale"; cells: BriefCell[];
  missing: CellId[]; stale: CellRef[]; fingerprint: string; compiledAt: string }
export interface Strategy {
  getCell(id: CellId, version?: number): Cell | undefined;   // latest version when omitted
  getActive(id: CellId): Cell | undefined;
  getBrief(contractId: string): Brief;                         // never throws on missing cells
  isStale(ref: CellRef): boolean;                              // ref.version !== active version
  status(options?: { scope?: "core" | "full" }): StatusReport;
}
export function openStrategy(root: string, options?: { contracts?: BriefContract[]; archetype?: string }): Strategy;
export function parseRef(text: string): Ref | undefined;
export function formatRef(ref: Ref): string;
export function checkCell(cell: Cell, ctx: CheckContext): CellFinding[];
export function checkCoherence(model: StrategyModel, scope: Scope): CoherenceFinding[];
export function completion(model: StrategyModel): CompletionReport;
export function buildCitationIndex(model: StrategyModel, scan: ScanInput): CitationIndex;
export function validateBriefContract(value: unknown): ValidationResult<BriefContract>;
```

Brief states:
- `ready`: every required cell is active and fresh.
- `missing`: a required cell has no active version. The consumer must refuse to proceed and raise a `missing` request. The CLI `brief --request` writes it.
- `stale`: every required cell is active, but a cell it depends on through C1 is stale, or the consumer's last compiled fingerprint differs. The consumer may proceed only with a visible stale flag.

The fingerprint is sha256 over the sorted `cell@version` list plus each cited file's bytes.

Brief contracts are owned by the consuming packages. Each ships `strategy-brief.json` at its package root and lists it in `files`. Discovery has two sources:
- the CLI and `openStrategy({contracts})` scan `node_modules/@clossys/*/strategy-brief.json`;
- they also scan `<root>/contracts/*.json`.

**DEFAULT**: discovery is by file convention, so no new `foundry` manifest key is needed.

| Contract | Owner | Requires | Optional |
|---|---|---|---|
| `designer.identity` | @clossys/designer | essence, personality, style | imagery |
| `writer.messaging` | @clossys/writer | narrative, voice, promise, proof, segment.core, need | none |
| `publisher.launch` | @clossys/publisher | channel, included | release |
| `customer.persona` | @clossys/customer | segment.core, need | buying, alternative |
| `planner.priorities` | outside foundry (workspace toolkit, consumer-local `contracts/`) | bet, north-star | parked, driver |

The strategist package never imports a consumer package. The dependency direction is consumers → strategist.

### 1.11 CLI `strategist-check` (exit 0 clean or ready, 1 findings or not ready, 2 could not run; `--json` everywhere; `--root` defaults to `<repo root>/clossys/agents/strategist`)

| Subcommand | Does | Writes |
|---|---|---|
| `status [--scope core\|full]` | Progress line, levels, next unlock (§skill Progress) | nothing |
| `cell <id> --verb create\|cohere\|unlock\|normalize` | Trio verb shape. An L3 id runs `create` = Q1–Q7. An L2 id runs `cohere`. An L1 id runs `unlock`. `strategy` runs `normalize` = L0 | nothing |
| `check [<id>[@N]…]` | Q1–Q7 | nothing |
| `cohere [<l2-id>…]` | C1–C3 | nothing |
| `complete [--level mvs\|l0\|full]` | The completion report | nothing |
| `brief <contract> [--write] [--request]` | Compile one brief | `briefs/`, optionally `requests/` |
| `handoff <contract>` | Brief readiness: exit 0 ready, 1 missing or stale (listed), 2 unreadable. The name is kept from 0.6 so consumer skills keep one verb | nothing |
| `propose <id> [--from N] [--option A]` | Copy the template, or vN, to a new draft vN+1 | `cells/` |
| `activate <id>@<N>[,…] --confirm msg:<s>#U<n>` | Runs Q1–Q7 and checks the confirm listing (Q7). Moves the pointer, retires siblings and resolves the linked requests | `cells/` status lines, `tree.json`, `requests/` |
| `request new\|list\|resolve` | Requests | `requests/` |
| `index [--check] [--scan <dir>…]` | Build or check `citations.json` | `citations.json` (without `--check`) |
| `review [--today <date>]` | Loop runner: Watch tripwires against findings, due reviews, stale cascades | `requests/` |
| `ground [<root>] <scan-dir> [scan opts]` | The 0.6 facts gate over findings. The bare positional form `strategist-check <root> <scan-dir>` is this mode | nothing |
| `wont-claim [<root>] <scan-dir>` | Quoted `Never-claim:` phrases from the active Proof, plus quoted `Never:` phrases from the active Voice, scanned on surfaces | nothing |

The scan options `--extensions`, `--skip-dirs` and `--exclude` keep their 0.6 meaning.

### 1.12 Citation index and drift

`citations.json` holds `{schemaVersion, generatedAt, fingerprint, entries:[{ref, by:{kind, path, line?, id?}}], stale:[…], dangling:[…]}`.

Its sources:
1. `briefs/*.json`;
2. `strategy:<id>@<N>` markers in the scan dirs;
3. a generic JSON walk for `{cell, version}` objects, which covers Writer records and Publisher output manifests without importing them.

`index --check` exits 1 in any of these cases:
- a citation is stale (it names a non-active version);
- a citation is dangling (the cell or version is unknown);
- a written brief's fingerprint differs from a fresh compile.

Stale is computed only against `active` pointers. A new draft makes nothing stale; only activation does, as the owner rule requires.

### 1.13 Loop: set → cascade → measure → review → steer

| Step | Who | What |
|---|---|---|
| set | strategist (high) + synthesizer (high) + user | Interview turns become cell drafts. The user confirms and the cells activate |
| cascade | cascade compiler (mid) | `brief --write` for every installed contract, then `index`. Consumers read briefs and get ready, missing or stale |
| measure | researcher (mid), consumers | New findings (observed values with dates) and new requests (`reading`, `drift`) |
| review | loop runner (mid) + critic (high) | `review` evaluates every active Watch against findings and dates, then opens `tripwire` requests. The critic runs pushback and a pre-mortem on what was raised |
| steer | strategist + user | Each request becomes a proposed version and goes to playback; the user confirms in a batch. Cascade again |

The package installs no schedule. The loop runs when a session runs it, or when the operator's own tick calls `review`.

### 1.14 Agent roles (prompts in `skill/roles/`, tier = capability, never a model name)

| Role | Tier | Job | May write |
|---|---|---|---|
| strategist | high | Runs the conversation, picks the next question, plays back, asks for the confirm | sessions, drafts, requests |
| researcher | mid | Gathers findings with sources, never opinions | findings |
| synthesizer | high | Turns chat into draft cells and 2–3 options | drafts |
| checker | script + mid | Runs Q/C scripts, then judges the flagged heuristics | nothing (it reports) |
| critic | high, fresh context | Pushback, contradictions (X3, X7), pre-mortem at MVS, storyline gaps | requests |
| cascade compiler | mid | Briefs and citation index | `briefs/`, `citations.json` |
| loop runner | mid | `review`, opening requests | requests |

In hand mode (today, with no package code), one session plays strategist, synthesizer and checker. It spawns the critic as a fresh subagent when the runtime allows one; otherwise it labels its own critique "self-critique".

### 1.15 Eval harness (`evals/strategist/`)

Businesses (all fictional; none names a consumer):

| Business | Archetype | Built to test |
|---|---|---|
| Larkspur Ledger | services: bookkeeping for independent vet clinics | margin and team cells, pricing pushback |
| Kilnpad | product-saas: studio software for ceramics studios | retention, driver, the Voice → Style chain |
| Tidepool Crew | marketplace: boat owners matched with deckhands and marine techs | two-sided segments, moat, buying |
| Vague Co | adversarial: generic answers, contradictions, "all of the above" | pushback, Q5/Q6, contradiction handling, completion honesty |

Each business has three files:
- `persona.md`: the simulated user's facts and temperament;
- `expected.json`: cells that must reach active, plus the forbidden activations;
- `traps.json`: planted contradictions and vague answers, each with the turn it is planted.

`rubric.json` scores each of 12 criteria from 0 to 2:
- hypothesis-first, options before choices, pushback, pre-mortem, routing;
- quality pass rate, coherence, confirm discipline (no activation without a listed yes);
- contradiction handling (it proposes, never auto-activates), completion honesty (no overclaimed level);
- turn efficiency (core cells per user turn), file conventions.

Running:
- The simulated user is a mid-tier subagent and the judge is a high-tier fresh context.
- Runs use the operator's subscription session. Paid APIs are not allowed.
- `strategist-check` scores file conventions, quality and completion objectively; the judge scores the conversational criteria.
- Pass bar: every business at or above 18/24, with zero on neither confirm discipline nor contradiction handling.

---

## 2. Migration map

### 2.1 Every 0.6.0 export

Dispositions:
- **keep**: unchanged.
- **retarget**: same idea, new input.
- **map**: replaced by a cell or API.
- **move**: ownership moves to another package.
- **delete**: removed with no replacement.

| 0.6.0 export (module) | Disposition | v2 replacement |
|---|---|---|
| `validateAudience(s)`, type `Audience` (schema) | map | `context.customer.need`, `context.customer.buying`, `focus.segment.core`, `focus.segment.next` cells; `checkCell` |
| `validateMarket(s)`, `Market` | map | `context.market.size`, `context.market.trend`, `focus.reach.geography` |
| `validatePositioning`, `Positioning` | map | `focus.category.definition`, `focus.category.stance`, `advantage.proposition.promise`, `advantage.defensibility.differentiator`, `context.competition.alternative` |
| `validateMission`, `Mission`, `OperatingValue` | map | `aspiration.purpose.mission`, `aspiration.purpose.vision`, `aspiration.culture.belief`, `aspiration.culture.behavior` |
| `validateRoadmapItem(s)`, `RoadmapItem`, `RoadmapStatus`, `ROADMAP_STATUSES` | map | `execution.roadmap.milestone`, `execution.roadmap.release`, `execution.priority.parked` |
| `validateStrategistClaim(s)`, `StrategistClaim`, `StrategistClaimStatus` | map | `advantage.proposition.promise` and `advantage.proposition.proof`. Activation is the approval; there is no separate claim status |
| `validateStrategyConstraint(s)`, `StrategyConstraint`, `StrategyConstraintTarget` | map | Labelled Direction bullets in `identity.verbal.voice` (Never), `identity.visual.style` (Avoid) and `advantage.proposition.proof` (Never-claim) |
| `validateBrand`, `validateBrandEssence`, `validateBrandAttribute(s)`, `BrandDocument`, `BrandEssence`, `BrandAttribute` | map | `identity.brand.essence`, `identity.brand.personality`, `identity.visual.style` |
| `validateDirectionEntity(ies)`, `DirectionEntity`, `DirectionSubject`, `DirectionSubjectFile`, `DIRECTION_SUBJECT_FILES` | map | Cell versions plus the `active` pointer; `isStale` |
| `validateFact(s)`, `Fact` | retarget | `findings/<id>.md`; `parseFinding` |
| `validateMoney`, `Money` | map | `advantage.model.pricing` bullets (a Price bullet with currency) |
| `BRAND_CSS_SEGMENTS`, `extractBrandCssSlots` (brand-css) | delete | Token coverage belongs to Designer selection refs (TI-D) |
| `checkBrandCoverage`, `validateBrandDerivation(s)`, `BrandDerivation`, `BrandCoverage*` | delete | `designer.identity` brief plus Designer selection `strategy` refs (TI-D) |
| `checkDirectionCoverage`, `checkDirectionCurrency`, `DirectionCoverage*`, `DirectionCurrency*` | map | `buildCitationIndex` plus `index --check` |
| `BRAND_FACTS_FILE`, `readBrandFacts`, `validateBrandFacts`, `copyEntriesFromRegistry`, `resolveBrandTaglines`, `BrandFacts*`, `BrandIdentity`, `BrandLegalEntity`, `BrandTagline`, `CopyEntryLike`, `ResolvedTagline` | move | @clossys/publisher site identity record (`clossys/publisher/site-identity.json`), seeded from `identity.naming.name` (TI-P) |
| `checkBrandFactsDrift`, `BrandFactsDrift*` | move | publisher `checkSiteIdentityDrift` (TI-P) |
| `readStrategyBrief`, `STRATEGY_BRIEF_FILE`, `validateStrategyBrief`, `StrategyBrief*`, `WontClaim` | map | The `Never-claim:` bullets of the active `advantage.proposition.proof` |
| `checkWontClaimDrift`, `WontClaim*` | retarget | `wont-claim` over Proof and Voice quoted phrases (ST-7) |
| `readStrategy`, `brandDerivationsFromBundle`, `StrategyBundle`, `StrategyReadIssue*` | map | `openStrategy`, `readStrategyRoot` |
| `checkStrategyHandoff`, `currentDirectionId`, `strategyDirectoryUnreadable`, `Handoff*` | map | `getBrief(contract).state`, `handoff <contract>`, `completion` |
| `projectStrategyContract`, `projectAndValidateStrategyContract` | map | `getBrief` / `brief --write` |
| `checkClaimMarkers`, `checkConstraintMarkers`, `checkStrategyApply`, `MarkersGate*` | map | `strategy:<id>@<N>` markers plus `index --check` |
| `readStrategyDirectory`, `FactsDirectory*` (facts-dir) | retarget | `readFindings` |
| `buildFactIndex`, `isTracedSurfaceForm`, `FactIndex` | retarget | Same names, fed from findings (`value`, `unit`, `aliases`) |
| `checkFactsTraceability`, `FactsGate*`, `ScannedFile` | retarget | `checkGrounding` (alias `checkFactsTraceability` kept through ST-12, then removed) |
| `scanStrategyDirectory`, `ScanOptions` | keep | Unchanged scan options |
| `assessStrategyTraceabilityRate`, `StrategyTraceabilityRate*` | keep | Unchanged, with the same bin |
| `CURRENT_STRATEGY_DIR_SEGMENTS`, `LEGACY_STRATEGY_DIR_SEGMENTS`, `resolveDefaultStrategyDirectory`, `StrategyDirectoryDefault` | delete | A fixed default root plus `--root`. The legacy `strategy/` fallback ends |
| `ENGAGEMENT_CONTEXT_FIELD_IDS`, `audienceContextValue`, `engagementContextFieldById`, `readEngagementContext`, `readEngagementContextFromBriefData`, `EngagementContext*` | keep | Unchanged. The packed engagement brief stays |
| `pendingAudienceIntakeQuestions`, `seedAudienceFromContext`, `AudienceIntake*`, `AudienceSeedResult`, `AudienceContextPointer` | delete | The skill's opening seeds hypotheses from the engagement context |
| `STRATEGY_RECORD_KINDS`, `validateStrategyContract`, `serializeStrategyContract`, `getApprovedClaims`, `createStrategyProvenance`, and every contract record type (`StrategyContract`, `StrategyRecord*`, `ClaimRecord`, `ApprovedClaim*`, `HypothesisClaimRecord`, `AudienceRecord`, `BrandRecord`, `ConstraintRecord`, `ConstraintKind`, `ConstraintTarget`, `EvidenceRecord`, `EvidenceKind`, `PositioningRecord`, `ProductRecord`, `RecordProvenance`, `StrategyProvenance`) | map | `Brief`, `validateBriefContract`, `CellRef`. `StrategyProvenance` becomes `{contract, refs: CellRef[], fingerprint}` |
| `ValidationIssue`, `ValidationResult`, `Validator` | keep | Unchanged |

CLI 0.6 modes:
- the default facts mode → `ground` (the bare positional form is kept);
- `brand-coverage` → deleted;
- `direction` → `index --check`;
- `handoff` → `handoff <contract>`;
- `apply` → `index --check`;
- `brand-facts` → moved to publisher;
- `wont-claim` → retargeted.

### 2.2 Every consumer coupling

| Where (integration ref) | Today | v2 change | Unit |
|---|---|---|---|
| `packages/publisher/templates/site/app/pack-review.ts`:44 | imports `ENGAGEMENT_CONTEXT_FIELD_IDS`, `readEngagementContextFromBriefData`, `validateStrategyContract` | The first two are kept. `validateStrategyContract` becomes `openStrategy(root,{contracts}).getBrief("publisher.launch")` plus `validateBriefContract` | TI-P |
| `…/templates/site/app/pack-review-copy.ts`:24 | type `EngagementContextFieldId` | unchanged | none |
| `…/templates/site/app/site-records.ts` | reads `clossys/strategist/brand-facts.json` and `contract.json` | reads `clossys/publisher/site-identity.json` and `clossys/strategist/briefs/publisher.launch.json` | TI-P |
| `…/templates/site/package.json` | `"@clossys/strategist": "^0.6.0"` | unchanged (freeze: the in-tree version is still 0.6.0; risk R9) | none |
| `packages/publisher/src/core/types.ts`:440, `output-manifest.ts` | `StrategyProvenance {strategyId, revision, records[], fingerprint}` | `{contract, refs: {cell, version}[], fingerprint}`; the output-manifest validator follows | TI-P |
| `packages/publisher/src/site-template-guards.test.ts`:135–250 | requires the `@clossys/strategist` sibling dep | unchanged | none |
| `packages/publisher/README.md`:4143–4424 | documents `readStrategy`, `factRefs` | Rewrite those paragraphs to `openStrategy`/`getBrief` and findings | TI-P |
| `packages/writer/src/model/types.ts`:22 | `{kind:"claim"; strategistClaimKey; phrasings; requiresCitation: true}` | `{kind:"claim"; strategy: CellRef; phrasings; requiresCitation: true}` | TI-W |
| `packages/writer/src/model/types.ts`:71, `validate.ts`:74/116, `record-drift.ts`:40 | manifest `strategist: { path }` | `strategy: { root, contract: "writer.messaging" }`. Record drift uses `isStale` | TI-W |
| Writer, Designer, Customer `skill/SKILL.md` | cite `claim:`/`constraint:` markers and `strategist-check handoff` | `strategy:<id>@<N>` markers and `strategist-check handoff <contract>` | TI-W, TI-D, TI-X |
| `packages/designer/package.json` needs plus 3 capability inputs | `brand-derivation` | `strategy-brief` | ST-11 |
| `packages/writer/package.json` needs plus 3 capability inputs | `brand-derivation`, `claims`, `positioning` | `strategy-brief` | ST-11 |
| `packages/customer/package.json` needs plus 1 capability input | `audience-understanding` | `strategy-brief` | ST-11 |
| `packages/publisher/package.json` needs plus 1 capability input | `strategy-brief` | unchanged id; the path becomes `clossys/agents/strategist/briefs/index.json` | ST-11 |
| `packages/strategist/package.json` `foundry.feeds` (7) / `outputs` (11) / `capabilities` (14) | the 0.6 files | feeds: `strategy-map` → `clossys/agents/strategist/tree.json` and `strategy-brief` → `clossys/agents/strategist/briefs/index.json`. outputs: tree.json, cells/, sessions/, findings/, requests/, briefs/, citations.json. Capabilities: `strategy-map`, `strategy-brief`, `cell-quality`, `coherence`, `completion`, `citation-index`, `grounding`, `wont-claim`, `strategy-loop` (each with `proofCase: null` while `maturity` is below qualified) | ST-11 |
| Designer library `selection.json` `strategy`/`direction` fields | null in consumers | `strategy` = the `designer.identity` brief fingerprint plus refs; `direction` is removed | TI-D |
| `packages/controller/contracts/role-loop-archetypes.json`:278 | strategist jobQuestion; metric "strategy traceability rate" | unchanged (the metric and bin are kept) | none |
| `packages/controller/src/onboarding/selection.ts`:15 `DIRECTION_ROLE` | role name only | unchanged | none |
| controller tests (`loop/artifacts.test.ts`, `staleness.test.ts`, `heartbeat/fs.test.ts`, `onboarding/discovery.test.ts`) | synthetic fixture paths such as `clossys/strategist/direction.json` | unchanged (synthetic, no import) | none |
| `packages/starter/src/core.test.ts` | package name only | unchanged | none |
| `packages/builder/README.md`:838, `builder/src/deployment/branch-binding.ts`:19 | comments cite `BrandDerivation` as precedent | Comment-only rewording to cite `validateBriefContract` | TI-X |
| bouncer, butler, giver, keeper `src/validation.ts` header comments | cite strategist `validation.ts` | unchanged (kept) | none |
| `evals/scenarios/single-role-strategist-only.json`, `single-role-designer-pulls-strategist.json` | resolve via the feeds above | expectations re-pointed to `strategy-brief` in the same commit as the rename | ST-11 |
| `clossys/strategist/facts.json` (foundry's own subject, one fact) | facts mode | `clossys/agents/strategist/findings/publishable-package-count.md`. A207 mechanically retargets the subject wrapper root and fixture path; the engine, scan extensions, exclusions and finding bytes stay unchanged | ST-7 |
| `scripts/check-package-skills.mjs` strategist rules | regexes on the skill text | **No edit.** The v2 skill satisfies every existing rule truthfully: pre-auth bar, `prove 3 only`, `never treat gate-green as keep`, `stops at 3 is a defect`, `necessary, not sufficient`, `do-not language`, `not keep`, the 0.6 file names in its migration section, `strategist-check handoff` and `clossys-customer`. `name: clossys-strategist` and `disable-model-invocation: true` are kept | ST-8 |
| `docs/contracts/consumer-layout.json` | `clossys/strategist` owned by strategist | unchanged | none |

---

## 3. Unit cut

### 3.1 Common to every unit

- **Base.** An integration branch **DEFAULT** `<agent>/strategist-v2-int`, cut by the first executor from `origin/codex/integrate-scroll-preview` @ 003e3590e.
  - Each unit uses its own agent-provenance branch and opens one draft PR into the integration branch.
  - Nothing lands on main.
- **Forbidden in every unit:**
  - any `version` field;
  - `scripts/check-*.mjs`;
  - neutrality and foreign-reference allowlists;
  - `.changeset/config.json`;
  - lockfile churn beyond the workspace;
  - any business content or consumer name in foundry;
  - `main`.
- **Every package-changing unit adds a changeset.** Strategist uses `minor`, with a "Breaking (0.x)" note listing every removed export.
- **Done-when always includes** the unit's own package tests, `npm run check:changesets`, `npm run check:neutrality` and `npm run check:foreign-references`.
- **Tiers follow risk:**
  - gates, the activation path, cross-package contracts and the skill copy are `high`;
  - fully specified mechanics with named tests are `mid`.

### 3.2 Units

| Id | Title | Tier | Depends on | Size |
|---|---|---|---|---|
| ST-0 | Catalog data and validator | mid | none | M (~450) |
| ST-1 | Cell, tree, ref, session, finding and request formats plus the root reader | high | ST-0 | L (~900) |
| ST-2 | Read API and brief compiler | high | ST-1 | M (~650) |
| ST-3 | Quality, coherence and completion checks | high | ST-1 | L (~950) |
| ST-4 | Read-only CLI (status, cell, check, cohere, complete, brief, handoff) | mid | ST-2, ST-3 | M (~550) |
| ST-5 | Write path: propose, activate, requests | high | ST-4 | M (~600) |
| ST-6 | Citation index and drift | high | ST-2 | M (~600) |
| ST-7 | Ground and won't-claim retarget, plus foundry's own subject migration | high | ST-1 | M (~500) |
| ST-8 | Skill v2, role prompts, README section | high | ST-0 | M (~700) |
| ST-9 | Loop runner (`review`) | mid | ST-5, ST-6 | M (~450) |
| ST-10 | Eval harness, rubric and four businesses | mid | ST-3, ST-8 | M (~600) |
| ST-11 | Manifest feeds, needs and capabilities rename across packages, plus evals | high | ST-2 | M (~350) |
| TI-D | Designer integration: `designer.identity` contract, selection refs, skill | high | ST-2, ST-6, ST-11 | M (~400) |
| TI-W | Writer integration: CellRef claims, manifest root, record drift, skill | high | ST-2, ST-6, ST-11 | M (~550) |
| TI-P | Publisher integration: provenance, pack-review, site identity move, README | high | ST-2, ST-6, ST-7, ST-11 | L (~800) |
| TI-X | Customer, builder comment and starter integration: `customer.persona` contract, skill | high | ST-2, ST-11 | S (~180) |
| ST-12 | Delete the 0.6 model | mid | TI-D, TI-W, TI-P, TI-X, ST-7, ST-8, ST-9 | L (~ −4000 / +200) |

Parallel lanes:
- After ST-1, these run in parallel: ST-2, ST-3 and ST-7.
- ST-8 runs from ST-0.
- After ST-2, ST-6 and ST-11 run in parallel.
- The TI units run in parallel after their dependencies.

### 3.3 Unit details

All paths are relative to the foundry repository root.

Two scopes apply to every unit unless the unit says otherwise:
- **Allowed** always includes a new `.changeset/*.md` file.
- **Forbidden** always includes the §3.1 list.

**ST-0 Catalog data and validator** (mid)
- Allowed:
  - `packages/strategist/src/catalog/**`
  - `packages/strategist/src/catalog.ts`
  - `packages/strategist/src/index.ts` (additive exports only)
  - `packages/strategist/package.json` (`files`, and `exports` adding `./catalog`)
- Tests first: `src/catalog/catalog.test.ts`:
  - 57 leaves, 28 L2, 7 L1, 24 default core;
  - each validator rule rejects a mutated fixture: duplicate leaf, `&` in a name, ` or ` in a name, a 1-key must-contain, a dangling link, an unfrozen leaf, an extra that repeats a core cell.
- Steps:
  1. Split `drafts/strategist-v2/catalog/tree.json` into the six §1.2 files. The draft file travels in the packet.
  2. Write `loadCatalog()` and `validateCatalog()`.
- Done when:
  - `npm --workspace packages/strategist run test` exits 0;
  - `npm --workspace packages/strategist run build` exits 0;
  - `npm run check:package-framework` exits 0;
  - mutation proof: deleting one leaf from the freeze makes the test fail.
- Must not: change existing exports.

**ST-1 Formats and root reader** (high)
- Allowed:
  - `packages/strategist/src/format/**`
  - `packages/strategist/src/store.ts`
  - `packages/strategist/src/index.ts` (additive)
  - `packages/strategist/test-fixtures/strategy-v2/**` (fictional only)
- Tests first: `format/*.test.ts`:
  - round-trip `parseCell` / `serializeCell` byte-stable on the template example;
  - the YAML subset rejects nesting;
  - section order is enforced;
  - non-bullet lines are rejected;
  - `Key:` labels are parsed;
  - every ref form parses and formats;
  - a session `U`/`S` line index is built;
  - finding and request validators work;
  - `tree.json` validation covers missing leaves, a renamed leaf, the active pointer type and the core override, which must contain the default core;
  - `readStrategyRoot` on fixtures reports issues by path and line.
- Done when:
  - package test and build exit 0;
  - mutation proof: swapping `## Because` and `## Watch` in a fixture fails the parse test.
- Must not: read files outside the given root.

**ST-2 Read API and brief compiler** (high)
- Allowed:
  - `packages/strategist/src/api.ts`
  - `packages/strategist/src/brief.ts`
  - `packages/strategist/src/brief-contracts.ts` (discovery)
  - `index.ts` (additive)
  - fixtures
- Tests first: `api.test.ts` and `brief.test.ts`:
  - `getCell` latest versus pinned version;
  - `getActive` follows the tree pointer;
  - `isStale` is true only after activation of a newer version, and a draft never makes anything stale;
  - `getBrief` returns `ready`, `missing` (listing the missing cells) and `stale`;
  - the fingerprint is stable under file order;
  - `validateBriefContract` rejects unknown cell ids;
  - discovery reads `node_modules/@clossys/*/strategy-brief.json` and `<root>/contracts/*.json`.
- Done when:
  - package test and build exit 0;
  - mutation proof: forcing `isStale` to compare against the latest version, rather than the active one, fails a test.
- Must not: import any other `@clossys/*` package.

**ST-3 Checks** (high, gate)
- Allowed:
  - `packages/strategist/src/checks/**`
  - `index.ts` (additive)
  - fixtures
- Tests first: one positive and one negative fixture per rule:
  - Q1–Q7;
  - C1 (each of the 11 links, including an out-of-scope link being skipped);
  - C2 script pairs X1, X2, X4, X5, X6, and judge pairs X3 and X7 emitted as `judge`;
  - C3;
  - C4 presence;
  - each completion level, MVS for each archetype, and Complete;
  - "a not-now choice counts as active".
- Done when:
  - package test exits 0;
  - mutation proof: removing the Q7 listing check lets an unlisted confirm activate in a test, and the test fails.
- Must not: call a model. Judge findings are data only.

**ST-4 Read-only CLI** (mid)
- Allowed:
  - `packages/strategist/src/cli.ts`
  - `packages/strategist/src/cli/**`
  - `README.md` (the CLI section only)
- Tests first: `cli.test.ts`:
  - each read subcommand: exit 0, 1 or 2, `--json` shape, and `--root` handling;
  - `status` output matches the skill's progress format;
  - `handoff <contract>` returns 0 for ready, 1 for missing or stale, 2 for an unreadable root;
  - the old 0.6 modes keep working in this unit;
  - the subcommand list matches SPEC §1.11.
- Done when:
  - package test and build exit 0;
  - `npm run check:bin-reachability` and `npm run check:readme-examples` exit 0.
- Must not: write files.

**ST-5 Write path** (high, gate)
- Allowed:
  - `packages/strategist/src/write/**`
  - `cli.ts` (the propose, activate and request subcommands)
  - fixtures
- Tests first:
  - `propose` creates v1 from the template, or vN+1 from vN, and never overwrites a file;
  - `activate` refuses on any hard Q finding, a missing confirm, a confirm whose S line does not list the ref, a non-U confirm line, or a retired target;
  - a batch confirm activates exactly the listed refs;
  - siblings retire;
  - the pointer moves;
  - linked requests resolve;
  - active and retired file bodies are byte-unchanged after activation.
- Done when:
  - package test exits 0;
  - mutation proof: allowing an `S` line as a confirm fails a test.
- Must not: activate without a confirm ref under any flag; there is no `--force`.

**ST-6 Citation index and drift** (high, gate)
- Allowed:
  - `packages/strategist/src/citations/**`
  - `cli.ts` (`index`)
  - fixtures
- Tests first:
  - markers, the JSON `{cell, version}` walk and the brief sources are each indexed;
  - stale, dangling and fingerprint drift each exit 1;
  - a new draft causes no drift;
  - the scan options are honoured.
- Done when:
  - package test exits 0;
  - mutation proof: treating a draft as active fails a test.
- Must not: import consumer packages.

**ST-7 Ground and won't-claim retarget** (high, gate)
- Allowed:
  - `packages/strategist/src/ground/**`
  - `facts-gate.ts`, `fact-index.ts`, `facts-dir.ts`, `scan.ts`, `wont-claim-drift.ts`
  - `cli.ts` (the default mode, `ground`, `wont-claim`)
  - `clossys/agents/strategist/findings/publishable-package-count.md` (A207 target)
  - `clossys/strategist/facts.json` (delete)
- Tests first:
  - grounding traces a numeric claim to a finding's `value` and `aliases`;
  - an untraced number fails;
  - `wont-claim` reads quoted phrases from the active Proof and Voice, and ignores draft versions;
  - the bare positional form equals `ground`.
- Done when:
  - package test and build exit 0;
  - `npm run check:strategist-subject` exits 0; A207 permits the subject wrapper and its fixture test to retarget the root mechanically, preserving the scan scope and engine.
- Must not: change the subject engine, extensions or exclusions; A207 permits only its mechanical root retarget and fixture path.

**ST-8 Skill v2 and role prompts** (high, copy)
- Allowed:
  - `packages/strategist/skill/SKILL.md` (from `drafts/strategist-v2/skill/SKILL.md`)
  - `packages/strategist/skill/roles/*.md` (7)
  - `packages/strategist/skill/templates/cell.md`
  - `packages/strategist/README.md` ("The cell model" section)
  - `packages/strategist/package.json` (`files` already includes `skill`)
- Tests first: `npm run check:package-skills` must exit 0 against the new skill with **no change** to the check script. Run it first against the draft to prove it.
- Done when:
  - `check:package-skills` and `check:packed-consumer` exit 0;
  - `npm run check:neutrality` exits 0;
  - the skill's file conventions match ST-1's fixtures, checked by a test that parses the template with `parseCell`.
- Must not: name a business, a consumer, a model or a vendor.

**ST-9 Loop runner** (mid)
- Allowed:
  - `packages/strategist/src/loop.ts`
  - `cli.ts` (`review`)
  - fixtures
- Tests first:
  - each Watch grammar form (`by <date>`, `each <period>`, `in any <period>`) fires against a dated finding, and does not fire before its date;
  - stale cascades open `drift` requests;
  - requests are deduplicated per cell, rule and period;
  - `review` never changes `tree.json` or a cell.
- Done when:
  - package test exits 0;
  - mutation proof: firing on equality for a `>` comparator fails a test.

**ST-10 Eval harness** (mid)
- Allowed: `packages/strategist/evals/strategist/**` (fictional businesses, `rubric.json`, `RUN.md`, scorer script).
- Tests first: the scorer on two recorded fixture transcripts, one passing and one failing (the failure is an activation without a listed yes), returns the expected scores.
- Done when:
  - package test exits 0;
  - `npm run check:evals` exits 0 (the harness sits outside the repository `evals/scenarios` set);
  - one live run on Kilnpad has its score posted in the PR body.
- Must not: call paid APIs or name a real company.

**ST-11 Manifest rename** (high, cross-package contract)
- Allowed: the `foundry` blocks in `package.json` for strategist, designer, writer, publisher and customer (no `version` field), plus `evals/scenarios/single-role-strategist-only.json` and `single-role-designer-pulls-strategist.json`.
- Tests first: run these first against the rename so they fail where expected, and record the failures:
  - `npm run check:capability-maps`
  - `npm run check:package-framework`
  - `npm run check:evals`
  - `npm run check:role-assessment-surfaces`
  - `npm run check:role-loop-archetypes`
- Steps: §2.2 rows for ST-11, applied atomically in one commit.
- Done when: all five checks exit 0.
- Must not: rename artifact ids anywhere else.

**TI-D Designer** (high)
- Allowed:
  - `packages/designer/strategy-brief.json`
  - the `packages/designer/package.json` `files` entry
  - designer selection types and validator for the `strategy` refs (`src/**/selection*`)
  - `packages/designer/skill/SKILL.md` (the strategist paragraph only)
  - tests
- Tests first:
  - the contract validates with `validateBriefContract`;
  - selection with stale refs is reported stale;
  - `direction` is removed from the selection schema.
- Done when: designer test, `check:package-skills` and `check:packed-consumer` exit 0.

**TI-W Writer** (high)
- Allowed:
  - `packages/writer/strategy-brief.json`
  - `packages/writer/src/model/types.ts`, `validate.ts`, `record-drift.ts` and their tests
  - writer fixtures
  - the `packages/writer/skill/SKILL.md` strategist paragraph
- Tests first:
  - a claim record with `strategy: {cell, version}` validates;
  - `strategistClaimKey` is rejected with a migration message;
  - record drift flags a stale CellRef;
  - the manifest `strategy.root` validates.
- Done when: writer test, `check:package-skills` and `check:readme-examples` exit 0.

**TI-P Publisher** (high)
- Allowed:
  - `packages/publisher/strategy-brief.json`
  - `src/core/types.ts`, `src/core/output-manifest.ts`
  - `src/site-identity/**` (moved brand-facts and drift)
  - `templates/site/app/pack-review.ts`, `templates/site/app/site-records.ts`
  - `README.md` (§2.2 lines)
  - tests
- Tests first:
  - provenance `{contract, refs, fingerprint}` validates and old provenance is rejected;
  - site identity drift is equal to the 0.6 brand-facts drift on moved fixtures;
  - pack-review blocks on a `missing` brief.
- Done when: publisher test, `check:packed-consumer` and `check:readme-examples` exit 0.

**TI-X Customer and comments** (high)
- Allowed:
  - `packages/customer/strategy-brief.json`
  - `packages/customer/package.json` `files`
  - the `packages/customer/skill/SKILL.md` strategist paragraph
  - the comment-only lines in `packages/builder/README.md`:838 and `packages/builder/src/deployment/branch-binding.ts`:19
- Tests first: the contract validates.
- Done when: customer test, builder test and `check:package-skills` exit 0.

**ST-12 Delete the 0.6 model** (mid)
- Allowed: removing these strategist modules and their tests and fixtures, plus `index.ts`, `cli.ts` and the README:
  - `schema.ts` (except finding validators moved in ST-7), `brand-css.ts`, `css-decl-percent.ts`, `brand-derivation.ts`, `brand-surfaces.ts`, `direction-invalidation.ts`, `brand-facts.ts`, `brand-facts-drift.ts`, `strategy-brief.ts`, `reader.ts`, `handoff.ts`, `projector.ts`, `markers-gate.ts`, `audience-intake.ts`, `strategy-dir-default.ts`, `contract.ts`;
  - `test-fixtures/brand-facts/`;
  - the `checkFactsTraceability` alias.
- Tests first: `index.test.ts` pins the v2 export list exactly. Inspect every test that pins counts or exports first, and include them.
- Done when:
  - package test and build exit 0;
  - `check:import-purity`, `check:packed-consumer`, `check:bin-reachability` and `check:readme-examples` exit 0;
  - `git grep -n "readStrategy\b\|validateStrategyContract\|brand-derivation" packages/` returns nothing outside changelogs.
- Must not: touch other packages.

---

## 4. Risks

| Id | Risk | Mitigation or DEFAULT |
|---|---|---|
| R1 | Gate-review volume. ST-3, ST-5, ST-6 and ST-7 are gate-class, needing two blind passes plus a fresh final each | Keep them disjoint and small. ST-4, ST-9 and ST-10 are mid. Batch review where heads are ready together |
| R2 | ST-11 must be atomic. A half rename breaks `check:capability-maps` and the composition evals | One commit, all five packages. Tests are recorded first |
| R3 | Root divergence from nested working directories | A207 centralizes the default and product interview under `<repo root>/clossys/agents/strategist/`; explicit `--root` keeps the selected folder. No legacy fallback |
| R4 | Heuristic false positives in Q5 and Q6 annoy users | Heuristics are flags only. The mid checker judges, and only its `fail` blocks. The lexicon is short and versioned |
| R5 | Hand-written files drift from the parser | The template is parsed by `parseCell` in a test (ST-8). The skill tells hand-mode sessions to run `strategist-check check` when installed |
| R6 | YAML-subset parsing without dependencies | Flow lists and scalars only. Anything else is a hard parse error naming the line |
| R7 | Activation authenticity is trust-based: an agent can write a fake U line | Q7 requires the listing plus the U line. Session logs are append-only by convention. The eval rubric punishes unlisted activation. Real signatures are out of scope |
| R8 | The brand-facts move ripples into publisher's site template and README | It is isolated in TI-P with drift-equivalence tests |
| R9 | Freeze versus breaking change: in-tree 0.6.0 changes shape without a bump, so packed-consumer pins and npm 0.6.0 diverge | Changesets record the break. No consumer adopts until the owner lifts the freeze. Product hand mode needs no package code |
| R10 | The integration line diverges from `codex/integrate-scroll-preview` | Units merge mechanical default-branch integrations only. Rebase cadence is set by the planner |
| R11 | Privacy: interview content must never enter foundry | Fixtures and evals are fictional. Product content lives under its repository-root `clossys/agents/strategist/`. `check:neutrality` and `check:foreign-references` run in every unit |
| R12 | Interview fatigue: 57 cells is a lot | MVS first (24 cells). The skill drafts from hypotheses, so the user mostly confirms or corrects. Batch confirm. The rest are in the extended pass |
| R13 | Whether `check-package-skills.mjs` counts as a "scanner" | Moot: no edit is planned. The v2 skill satisfies the current rules truthfully |

## 5. Defaults decided here (no blocking questions)

1. The package default and product interview root are `<repo root>/clossys/agents/strategist/` (A207). Explicit `--root` selects another folder.
2. There is a `confirmed:` frontmatter key, plus a listed-batch playback S line, as the activation proof.
3. Frontmatter `cites` equals the union of Because refs.
4. Activation may rewrite only the `status` line of retired siblings.
5. Options are parallel draft versions with `note: option X`.
6. Brief contracts are discovered by the file convention `strategy-brief.json`, so there is no new manifest key.
7. The `planner.priorities` contract lives outside foundry, in a consumer-local `contracts/` folder.
8. The `handoff` subcommand name is kept, and now takes a contract id.
9. The bare positional CLI form is ground mode, so `check-strategist-subject.mjs` is unchanged.
10. No check-script edits.
11. The feeds are `strategy-map` and `strategy-brief`; the old feed ids are removed in ST-11.
12. Brand facts move to publisher as the site identity record.
13. The integration branch is `<agent>/strategist-v2-int` from `codex/integrate-scroll-preview` @ 003e3590e.
14. Eval pass bar: 18/24 per business, with no zero on confirm discipline or contradiction handling.
15. ST-0 is mid (fully specified data plus a structural validator). Every gate, contract or copy unit is high.
