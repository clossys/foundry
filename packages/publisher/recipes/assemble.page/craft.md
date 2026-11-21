# assemble.page

Assembles one page (a Designer frame, Designer sections and Writer keys) or one publication (pinned pages in route order) when the slot's verdict is `create`. Publisher assembles: it never writes copy or designs.

- Produces: `page`, `publication` (rung `create`).
- Tier: mid. Axes: `lead`, `order`, `grouping`.
- Base reference: the slot's pinned inputs: for a page, one `frames.*` frame and the `sections.*` sections it lists, and the Writer slots its copy keys come from; for a publication, the pinned `page.*` slots.
- Designer and Writer derivation: a page names a pinned Designer frame and pinned sections by id (`page.assembled`) and carries every display string as a Writer key, never inline text (`page.no-inline-copy`); a publication orders pinned page slots into routes (`publication.routes`).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `lead` | `order` | `grouping` |
| --- | --- | --- | --- |
| `page` | which section opens the page | the order of the other sections | which sections share a region |
| `publication` | which route is home | the route order | how pages group in the tree |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `page`, `publication`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options publisher/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/publisher/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`page`, `publication`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "assemble.page", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
 "inputs": [{"slot": "<slot id>", "candidate": "<pinned candidate>", "sha256": "<pinned sha>"}],
 "tasteLog": <newest 20 entries, or all when fewer>, "brief": "<one paragraph, at most 1200 chars>"}
```

- `requirements` lists the standard's requirement ids exactly (from
  `packages/publisher/standards/<standard>/requirements.json`).
- `inputs` lists every pinned upstream input (the slot's `inputs`; a page lists a pinned `frames.*` frame), each at its pinned candidate and sha256. Name slots by slot id
  only (R06.7): never a file path, package name or candidate body.
- The taste log (`clossys/agents/publisher/taste/<standard>/taste-log.json`) is read as preferences, never as a rubric.

Check, then record:

```sh
clossys recipe check assemble.page brief <slot> brief.json
clossys next publisher/<slot> --stage brief --file brief.json --recipe assemble.page --model <model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`lead`, `order`, `grouping`.

```json
{"recipe": "assemble.page", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"lead": "<value>", "order": "<value>", "grouping": "<value>"},
  "traits": ["<pinned upstream id realised>"]}]}
```

- A page direction lists exactly one pinned `frames.*` frame in `traits`, one the slot names in `inputs` or `uses`, and its sections by `sections.*` id (R20).
- A publication direction lists the pinned `page.*` slots it places.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
clossys recipe check assemble.page diverge <slot> directions.json
clossys next publisher/<slot> --stage diverge --file directions.json --recipe assemble.page --model <model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

### 3. render (deterministic)

Write each direction's draft candidate in the contract's shape: a JSON record: a page is `{"schema": "clossys.page/1", "path": "/<route>", "title": "<Writer key>", "frame": "frames.<id>", "sections": ["sections.<id>", ...], "copy": {"<name>": "<slot>#<key>"}, ...}` with every display field (label, title, description, prompt ...) a Writer key; a publication is `{"schema": "clossys.publication/1", "format", "entryOrder", "routePack": {"packId", "homeRouteId"}, "meta": {"source": {"kind": "derived", "ref": [...]}, "tree": [...]}}`.
Nothing is generated; the checks read it mechanically.

For each direction's draft candidate, check the draft first (schema, a route path, a pinned `frames.*` frame the slot names, unique pinned `sections.*` sections, a Writer title key found in a pinned Writer slot the page uses, `<slot>#<key>` copy references, no inline display text; for a publication, a format, a unique kebab-case entry order with its home in it, a derived source and a tree of pinned page slots the slot lists; a requirement it does not
check is named in its clean line as left to `clossys check --constitution --slot`), then render and preflight:

```sh
clossys recipe check assemble.page draft <slot> <draft>
clossys render <slot> --draft <direction file>   # a draft before submit; cached by (sha256, dependency pin-set hash)
clossys check --constitution --slot publisher/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing check prints the rule id, the requirement and the fix: fix the draft and re-check; never edit the check.
Both verbs have landed: a draft renders before it is submitted (`--draft`), and the preflight is the
constitution on this one slot. This stage never renders by hand or skips the preflight. The draft check above is the maker's
own preflight and runs now; it does not replace `clossys check --constitution --slot`.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next publisher/<slot> --stage render --file renders.json --recipe assemble.page --model <model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet publisher/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, stage check, directions, brief or notes; R16.2). A fresh critic
context that has never seen this recipe reads only that manifest and writes `critique.json` (scores
per taste id of the standard, notes, the packet sha).

```sh
clossys critique publisher/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next publisher/<slot> --stage critique --file critique.json --recipe assemble.page --model <critic model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`clossys recipe check assemble.page diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its draft check and preflight) and critique:

```sh
clossys next publisher/<slot> --stage refine --file directions.json --recipe assemble.page --model <model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
clossys recipe check assemble.page draft <slot> <draft>
clossys check --constitution --slot publisher/<slot>       # same preflight, last time before the write
clossys next publisher/<slot> --submit <draft> --rung create --reason "<create gap and the upstream it derives from>" --basis agent --model <model> --tier <tier> --skill packages/publisher/actions/publisher.candidates/skill.md
```

The candidate is named by the writer (`<leaf>-v<n>`). The reason states the create gap and the pinned upstream the draft derives from. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
