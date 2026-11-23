# Census: int2 at 925ae7f — conform and e2e reds

Source commit: `925ae7fbb2c869438a6e88803eee4944c90bfca4` (branch `claude/r2f-int2`).
Serving model: `claude-opus-5-5` (session `last_served_model`).

Measurement only: no source file changed. Each red reason is the first row the conform report gives for that cell; the count of further rows is in parentheses.

## Conform (`clossys conform --all --json`)

Totals: **152 cells, 98 green, 54 red** (report `ok: false`).

| agent | cells | red |
|---|---|---|
| producer | 8 | 3 |
| director | 36 | 10 |
| designer | 36 | 12 |
| writer | 36 | 13 |
| publisher | 36 | 16 |

| agent | cell id | red reason |
|---|---|---|
| producer | P1 | producer IA queue: queue.change is not placed |
| producer | P3 | queue.change: no loop fills it (no owner step raises it, no failure routes to it, no step writes it) |
| producer | P4 | loop.fill: step create has no failure route: a failed run stops and lands in no queue (+25 more rows) |
| director | L2 | context.market.size: placement records no reuse-or-create decision with its overlaps (+54 more rows) |
| director | L4 | vacuous: nothing to judge (empty is red) |
| director | L5 | vacuous: nothing to judge (empty is red) |
| director | K1 | R15.1 is building, not enforced for director (+1 more rows) |
| director | K4 | recipes/create.statement: ships no fixture output (+1 more rows) |
| director | Q2 | request.input-unclear director/advantage.proposition.promise: printed by the interview, no queue entry records it (+27 more rows) |
| director | Q6 | vacuous: nothing to judge (empty is red) |
| director | Q7 | vacuous: nothing to judge (empty is red) |
| director | Q8 | vacuous: nothing to judge (empty is red) |
| director | W2 | director/loop.scope: missing (the consumer places director but holds none of its loop slots; run clossys loop director/loop.scope) (+4 more rows) |
| designer | S1 | package tree has 252 leaves, the placed tree 212 (+52 more rows) |
| designer | L2 | themes.background: placement records no reuse-or-create decision with its overlaps (+211 more rows) |
| designer | L4 | vacuous: nothing to judge (empty is red) |
| designer | L5 | vacuous: nothing to judge (empty is red) |
| designer | K1 | R15.1 is building, not enforced for designer (+1 more rows) |
| designer | K2 | components.button: no package default, no seed, no createOnly reason (+56 more rows) |
| designer | K3 | R05.1 is building, not enforced for designer |
| designer | K4 | recipes/create.app-section: ships no fixture output (+7 more rows) |
| designer | Q2 | request.input-unclear director/advantage.proposition.promise: printed by the interview, no queue entry records it (+14 more rows) |
| designer | Q7 | vacuous: nothing to judge (empty is red) |
| designer | Q8 | vacuous: nothing to judge (empty is red) |
| designer | W2 | designer/loop.scope: missing (the consumer places designer but holds none of its loop slots; run clossys loop designer/loop.scope) (+4 more rows) |
| writer | S1 | package tree has 106 leaves, the placed tree 105 (+1 more rows) |
| writer | S4 | page.not-found.meta and page.app-not-found.meta: same kind and inputs, similar purpose (0.75) |
| writer | L2 | lexicon.formality: placement records no reuse-or-create decision with its overlaps (+104 more rows) |
| writer | L4 | vacuous: nothing to judge (empty is red) |
| writer | L5 | src/derive/copy.ts: a fixed list of 6 slot ids, not derived from source data |
| writer | K1 | R15.1 is building, not enforced for writer (+1 more rows) |
| writer | K2 | narratives.article: no package default, no seed, no createOnly reason (+59 more rows) |
| writer | K3 | R05.1 is building, not enforced for writer |
| writer | K4 | recipes/create.copy: ships no fixture output (+2 more rows) |
| writer | Q2 | request.input-unclear director/identity.verbal.voice: printed by the interview, no queue entry records it (+18 more rows) |
| writer | Q7 | vacuous: nothing to judge (empty is red) |
| writer | Q8 | vacuous: nothing to judge (empty is red) |
| writer | W2 | writer/loop.scope: missing (the consumer places writer but holds none of its loop slots; run clossys loop writer/loop.scope) (+4 more rows) |
| publisher | S1 | package tree has 60 leaves, the placed tree 0 (+61 more rows) |
| publisher | S3 | vacuous: nothing to judge (empty is red) |
| publisher | S6 | layout.marketing-home: declares no inputs list (+59 more rows) |
| publisher | L2 | vacuous: nothing to judge (empty is red) |
| publisher | L4 | vacuous: nothing to judge (empty is red) |
| publisher | L5 | vacuous: nothing to judge (empty is red) |
| publisher | K1 | R15.1 is building, not enforced for publisher (+61 more rows) |
| publisher | K2 | release.site: no package default, no seed, no createOnly reason (+4 more rows) |
| publisher | K3 | R05.1 is building, not enforced for publisher (+1 more rows) |
| publisher | C1 | layout.marketing-home: no family {options, varyOn, values} (+59 more rows) |
| publisher | C2 | layout.marketing-home: contract carries no requirements (+59 more rows) |
| publisher | C4 | vacuous: nothing to judge (empty is red) |
| publisher | Q2 | interview gap request.director-*: printed, never filed as a queue entry (+5 more rows) |
| publisher | Q6 | requests.issuing to director: no input or uses edge of publisher reads director (+1 more rows) |
| publisher | Q7 | vacuous: nothing to judge (empty is red) |
| publisher | Q8 | vacuous: nothing to judge (empty is red) |
## E2E (`npm run check:e2e -w @clossys/producer`)

Result: **fail** (exit 1). The gate has no list-all-reds mode (`check --e2e` accepts only `--from`, `--scenario`, `--keep`, `--json`); it stops at the first red step.

- Install: six first-party tarballs installed, one copy each; peers installed (exit 0).
- Steps passed before the red: 28 (`config.init` through `craft.frame.critique`).
- First red step: `craft.frame.submit` — `clossys next designer/frames.site-shell --submit <e2e>/site-shell.json --model e2e-fixture --tier low --basis planner --skill packages/designer/actions/designer.candidates/skill.md --rung L4 --reason "no seed: a fresh consumer holds none"` exited 1, expected 0.
- Exact message: `next --submit refused: recipe create.frame crafts composition candidates; this one's meta.source.kind is derived; fix: submit a composition candidate (meta.source.kind) that the recipe's checks (R05.1, R06.1, R07.1, R07.6, ref-verbatim) judge`

(`<e2e>` stands for the installed `@clossys/producer/e2e` directory inside the gate's temporary consumer.)

## Commands and exit codes

| command | exit |
|---|---|
| `git fetch origin claude/r2f-int2` | 0 |
| `git checkout -b claude/r2f-census-925ae7f 925ae7fbb` | 0 |
| `npm ci` | 0 |
| `npm run build -w @clossys/advisor` | 0 |
| `npm run build -w @clossys/controller` | 0 |
| `npm run build -w @clossys/director` | 0 |
| `npm run build -w @clossys/designer` | 0 |
| `npm run build -w @clossys/writer` | 0 |
| `npm run build -w @clossys/publisher` | 0 |
| `npm run build -w @clossys/producer` | 0 |
| `node packages/producer/dist/cli/main.js conform --all --json` | 0 (printed nothing: `main.js` is the library module, not the bin entry) |
| `node packages/producer/dist/cli/index.js conform --all --json` | 1 (reds present; report above) |
| `npm run check:e2e -w @clossys/producer` | 1 |
