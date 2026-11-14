# create.glyph

Creates one `assets.icon-*` glyph slot when no registry icon fits (the slot's verdict is `create`), as a DTCG glyph value on the 24 grid (a lucide node array).

- Produces: `asset.glyph` (rung `create`, Designer rung L4).
- Tier: mid. Axes: `metaphor`, `construction`, `weight`.
- Base reference: lucide's 24 grid, 2px stroke, round caps and joins are the base reference; keeping them is a `keeps` entry with a Director reason. `source.ref` kind `derived` (from a named lucide icon) or `original`, licensed ISC or MIT.
- Director derivation: derives from `identity.visual.imagery` (required); `identity.visual.style` (quiet and exact) bounds stroke and detail. Traits are cited in `meta.element.reason` (R20).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes

- `metaphor`: the object or action the glyph shows.
- `construction`: the primitive build (outline, cut-out, composed of two lucide parts).
- `weight`: optical weight against the pinned glyph set (lighter, matched, heavier).

Contract rules (`asset.svg-files`): viewBox 24, legible at 16px, strokes at least 1px, at most 12 shapes.

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `asset.glyph`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options designer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/designer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`asset.glyph`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.glyph", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
 "inputs": [{"slot": "<slot id>", "candidate": "<pinned candidate>", "sha256": "<pinned sha>"}],
 "tasteLog": <newest 20 entries, or all when fewer>, "brief": "<one paragraph, at most 1200 chars>"}
```

- `requirements` lists the standard's requirement ids exactly (from
  `packages/designer/standards/<standard>/requirements.json`).
- `inputs` lists every pinned upstream input: the slot's `inputs` plus every Director trait the
  standard's `derive.director` names, each at its pinned candidate and sha256. Name slots by slot id
  only (R06.7): never a file path, package name or candidate body.
- The taste log (`clossys/agents/designer/taste/<standard>/taste-log.json`) is read as preferences, never as a rubric.

Check, then record:

```sh
node packages/designer/recipes/stage-check.mjs brief <slot> brief.json
clossys next designer/<slot> --stage brief --file brief.json --recipe create.glyph --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`metaphor`, `construction`, `weight`.

```json
{"recipe": "create.glyph", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"metaphor": "<value>", "construction": "<value>", "weight": "<value>"},
  "traits": ["<Director slot id realised>"], "keeps": [{"ref": "<base value kept>", "because": "director:<trait> ..."}]}]}
```

- Every direction lists `identity.visual.imagery` in `traits`.
- A direction derived from a lucide icon names it in `idea`; three directions never derive from the same icon.
- `meta.element.reason` cites each realised trait as `director:<slot id>` (no version suffix); a kept
  base value is `default:<ref>` beside the citation that justifies it.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json
clossys next designer/<slot> --stage diverge --file directions.json --recipe create.glyph --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 3. render (deterministic)

Write the glyph as a lucide node array (`[["path", {"d": "..."}], ...]`) in the candidate's DTCG
file. Nothing is generated; the preflight checks the grid, size and shape limits mechanically.

For each direction's draft candidate:

```sh
clossys render <slot> <candidate>          # cached by (candidate sha256, dependency pin-set hash)
clossys check --slot designer/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing preflight prints the rule id and the fix: fix the draft and re-render; never edit the check.
Open tooling gaps (foundry-feedback-0015, -0018): `clossys render` renders submitted candidates only, and
`clossys check --slot` is being built (INLINE-GATES). Until each lands, this stage stops at `NEED` naming
the missing verb; it never renders by hand or skips the preflight.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next designer/<slot> --stage render --file renders.json --recipe create.glyph --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet designer/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, generator, directions, brief or notes; R16.2). A fresh critic
context that has never seen this recipe reads only that manifest and writes `critique.json` (scores
per taste id of the standard, notes, the packet sha).

```sh
clossys critique designer/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next designer/<slot> --stage critique --file critique.json --recipe create.glyph --model <critic model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its preflight) and critique:

```sh
clossys next designer/<slot> --stage refine --file directions.json --recipe create.glyph --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
clossys check --slot designer/<slot>       # same preflight, last time before the write
clossys next designer/<slot> --submit <draft> --rung L4 --reason "<create gap or Director reason>" --basis agent --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

The candidate is named by the writer (`<leaf>-v<n>`). `meta.element.reason` cites every
realised Director trait as `director:<slot id>`; a kept base value is in the reason with its Director
trait. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
