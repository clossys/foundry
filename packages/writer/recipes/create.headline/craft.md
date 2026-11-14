# create.headline

Creates one headline copy slot (hero, tagline, page and section headings) when the slot's verdict is `create`.

- Produces: `copy.headline` (rung `create`).
- Tier: high. Axes: `angle`, `register`, `length`.
- Base reference: the slot contract (kind `passage`, `pattern` or `string`, its fields, parts and limits); the pinned Director voice and the other pinned upstream the slot lists.
- Director (and Writer) derivation: all Writer copy derives from the pinned voice: the source cites `director:identity.verbal.voice` (`copy.voice-derived`) and every ref is `director:<slot>`, `writer:<slot>[#key]` or a finding (`copy.derived-upstream`).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `angle` | `register` | `length` |
| --- | --- | --- | --- |
| `copy.headline` | the promise or fact the line leads with | how plain or warm the voice sits | short, standard or long within the limit |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `copy.headline`; `<tier>` is `high`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options writer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/writer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`copy.headline`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.headline", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
 "inputs": [{"slot": "<slot id>", "candidate": "<pinned candidate>", "sha256": "<pinned sha>"}, {"finding": "finding:<id>", "sha256": "<file sha>"}],
 "tasteLog": <newest 20 entries, or all when fewer>, "brief": "<one paragraph, at most 1200 chars>"}
```

- `requirements` lists the standard's requirement ids exactly (from
  `packages/writer/standards/<standard>/requirements.json`).
- `inputs` lists every pinned upstream input (the slot's `inputs` plus `identity.verbal.voice`), each at its pinned candidate and sha256. Name slots by slot id
  only (R06.7): never a file path, package name or candidate body.
- The taste log (`clossys/agents/writer/taste/<standard>/taste-log.json`) is read as preferences, never as a rubric.

Check, then record:

```sh
node packages/writer/recipes/stage-check.mjs brief <slot> brief.json
clossys next writer/<slot> --stage brief --file brief.json --recipe create.headline --model <model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`angle`, `register`, `length`.

```json
{"recipe": "create.headline", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"angle": "<value>", "register": "<value>", "length": "<value>"},
  "traits": ["<pinned upstream id realised>"]}]}
```

- Every direction lists `identity.verbal.voice` in `traits`; the other traits are the slot's pinned inputs (R20).
- A headline direction is a different claim or angle, not the same line reworded.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/writer/recipes/stage-check.mjs diverge <slot> directions.json
clossys next writer/<slot> --stage diverge --file directions.json --recipe create.headline --model <model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

### 3. render (deterministic)

Write each direction's draft candidate in the contract's shape: a Markdown copy file: frontmatter `slot`, `locales: ["en"]`, `source: {"kind": "derived", "ref": ["director:identity.verbal.voice", ...]}`; then `## en`, and per key `### <key>`, the meta comment `<!-- {"id": "<key>", "bindings": []} -->` and a plain value (no Markdown or HTML, no placeholder, no doubled spaces, valid ICU), sentence case, within the contract's limits (160 characters by default).
Nothing is generated; the checks read it mechanically.

For each direction's draft candidate, check the draft first (the voice cited, a derived source of `director:`/`writer:` pins and findings, one entry per key with its meta id equal to the key, plain values (no markup or placeholder, valid ICU), within the contract's limits, sentence case except the standard's proper names, pattern parts where the contract has them; a requirement it does not
check is named in its clean line as left to `clossys check --constitution --slot`), then render and preflight:

```sh
node packages/writer/recipes/stage-check.mjs draft <slot> <draft>
clossys render <slot> --draft <direction file>   # a draft before submit; cached by (sha256, dependency pin-set hash)
clossys check --constitution --slot writer/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing check prints the rule id, the requirement and the fix: fix the draft and re-check; never edit the check.
Both verbs have landed: a draft renders before it is submitted (`--draft`), and the preflight is the
constitution on this one slot. This stage never renders by hand or skips the preflight. The draft check above is the maker's
own preflight and runs now; it does not replace `clossys check --constitution --slot`.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next writer/<slot> --stage render --file renders.json --recipe create.headline --model <model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet writer/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, stage check, directions, brief or notes; R16.2). A fresh critic
context that has never seen this recipe reads only that manifest and writes `critique.json` (scores
per taste id of the standard, notes, the packet sha).

```sh
clossys critique writer/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next writer/<slot> --stage critique --file critique.json --recipe create.headline --model <critic model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/writer/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its draft check and preflight) and critique:

```sh
clossys next writer/<slot> --stage refine --file directions.json --recipe create.headline --model <model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
node packages/writer/recipes/stage-check.mjs draft <slot> <draft>
clossys check --constitution --slot writer/<slot>       # same preflight, last time before the write
clossys next writer/<slot> --submit <draft> --rung create --reason "<create gap and the upstream it derives from>" --basis agent --model <model> --tier <tier> --skill packages/writer/actions/writer.candidates/skill.md
```

The candidate is named by the writer (`<leaf>-v<n>`). The reason states the create gap and the pinned upstream the draft derives from. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
