# create.structured

Creates one Director list, measure or profile brief when the slot's verdict is `create`. The three share one shape (keys, reasons, watch) and differ in what the Direction holds.

- Produces: `brief.list`, `brief.measure`, `brief.profile` (rung `create`).
- Tier: mid. Axes: `selection`, `cut`, `evidence`.
- Base reference: the slot contract's question and `mustContain` keys; the pinned Director briefs and recorded findings the slot derives from.
- Director derivation: a brief derives from pinned Director slots and recorded findings only (`brief.derived-upstream`); every source ref backs a Because line (`brief.because-cited`). A measure states at least two quantities (`brief.quantified`); a profile draws a boundary (`brief.boundary`).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `selection` | `cut` | `evidence` |
| --- | --- | --- | --- |
| `brief.list` | which items are in the list | where the list stops | which pinned brief or finding each item rests on |
| `brief.measure` | what is counted | the threshold or range stated | the finding or brief the number comes from |
| `brief.profile` | which traits define it | who or what it is not | the brief or finding behind each trait |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `brief.list`, `brief.measure`, `brief.profile`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options director/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/director/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`brief.list`, `brief.measure`, `brief.profile`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.structured", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
 "inputs": [{"slot": "<slot id>", "candidate": "<pinned candidate>", "sha256": "<pinned sha>"}, {"finding": "finding:<id>", "sha256": "<file sha>"}],
 "tasteLog": <newest 20 entries, or all when fewer>, "brief": "<one paragraph, at most 1200 chars>"}
```

- `requirements` lists the standard's requirement ids exactly (from
  `packages/director/standards/<standard>/requirements.json`).
- `inputs` lists every pinned upstream input (the slot's `inputs`, then the Director slots and recorded findings the brief derives from; at least one), each at its pinned candidate and sha256. Name slots by slot id
  only (R06.7): never a file path, package name or candidate body.
- The taste log (`clossys/agents/director/taste/<standard>/taste-log.json`) is read as preferences, never as a rubric.

Check, then record:

```sh
node packages/director/recipes/stage-check.mjs brief <slot> brief.json
clossys next director/<slot> --stage brief --file brief.json --recipe create.structured --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`selection`, `cut`, `evidence`.

```json
{"recipe": "create.structured", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"selection": "<value>", "cut": "<value>", "evidence": "<value>"},
  "traits": ["<pinned upstream id realised>"]}]}
```

- `traits` lists the pinned Director slots and `finding:<id>` the direction derives from; another agent's slot fails (R20).
- A measure direction names its quantities on the `cut` axis (a number, a date, or an explicit zero, none or free); a profile direction names its boundary there.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/director/recipes/stage-check.mjs diverge <slot> directions.json
clossys next director/<slot> --stage diverge --file directions.json --recipe create.structured --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 3. render (deterministic)

Write each direction's draft candidate in the contract's shape: a Markdown brief: frontmatter `slot`, `source: {"kind": "derived", "ref": [<Director slot ids and finding:<id>>]}`, `feeds`, `functions`, `note`; then `## Direction` (one `- Key: value` line per contract key, plain language), `## Because` (each line ends `(<ref>)`, every source ref cited) and `## Watch` (each line `If <metric> <comparator> <number> <window>, then <action>.`).
Nothing is generated; the checks read it mechanically.

For each direction's draft candidate, check the draft first (sections in order, every contract key once, a derived source of pinned Director slots and recorded findings, each cited in Because, Watch lines with a numeric threshold and a time window, plain Direction within the standard's word and sentence limits (45/2 list and measure, 40/2 profile), two quantities for a measure, a boundary for a profile; a requirement it does not
check is named in its clean line as left to `clossys check --constitution --slot`), then render and preflight:

```sh
node packages/director/recipes/stage-check.mjs draft <slot> <draft>
clossys render <slot> --draft <direction file>   # a draft before submit; cached by (sha256, dependency pin-set hash)
clossys check --constitution --slot director/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing check prints the rule id, the requirement and the fix: fix the draft and re-check; never edit the check.
Both verbs have landed: a draft renders before it is submitted (`--draft`), and the preflight is the
constitution on this one slot. This stage never renders by hand or skips the preflight. The draft check above is the maker's
own preflight and runs now; it does not replace `clossys check --constitution --slot`.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next director/<slot> --stage render --file renders.json --recipe create.structured --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet director/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, stage check, directions, brief or notes; R16.2). A fresh critic
context that has never seen this recipe reads only that manifest and writes `critique.json` (scores
per taste id of the standard, notes, the packet sha).

```sh
clossys critique director/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next director/<slot> --stage critique --file critique.json --recipe create.structured --model <critic model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/director/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its draft check and preflight) and critique:

```sh
clossys next director/<slot> --stage refine --file directions.json --recipe create.structured --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
node packages/director/recipes/stage-check.mjs draft <slot> <draft>
clossys check --constitution --slot director/<slot>       # same preflight, last time before the write
clossys next director/<slot> --submit <draft> --rung create --reason "<create gap and the upstream it derives from>" --basis agent --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

The candidate is named by the writer (`<leaf>-v<n>`). The reason states the create gap and the pinned upstream the draft derives from. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
