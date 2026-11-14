# create.element

Creates one frame, app section, adaptive section or media rule slot when the slot's verdict is `create`. Frames and sections compose pinned parts; media rules are a rules value.

- Produces: `frame`, `section.app`, `section.adaptive`, `asset.media-rule` (rung `create`, Designer rung L4).
- Tier: mid. Axes: `structure`, `density`, `emphasis`.
- Base reference: pinned components and sections (frames, sections); for `asset.media-rule`, the contract's rules members. Frames and sections use tokens only and name parts by slot id (`compose.layers`, `tokens.only`).
- Director derivation: `identity.visual.style` bounds every direction; `asset.media-rule` derives from `identity.visual.imagery` (required: live previews of real candidates, no stock photos, original assets only for consumer items). Cited in `meta.element.reason` (R20).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `structure` | `density` | `emphasis` |
| --- | --- | --- | --- |
| `frame` | navigation and region layout | chrome weight | what orients the user first |
| `section.app` | list, table, form or detail layout | rows per view | the primary action |
| `section.adaptive` | how it reflows between site and app | compact or relaxed | what stays first in both |
| `asset.media-rule` | ratio and crop rule | how often media appears | what the media shows |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `frame`, `section.app`, `section.adaptive`, `asset.media-rule`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options designer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/designer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`frame`, `section.app`, `section.adaptive`, `asset.media-rule`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.element", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
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
clossys next designer/<slot> --stage brief --file brief.json --recipe create.element --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`structure`, `density`, `emphasis`.

```json
{"recipe": "create.element", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"structure": "<value>", "density": "<value>", "emphasis": "<value>"},
  "traits": ["<Director slot id realised>"], "keeps": [{"ref": "<base value kept>", "because": "director:<trait> ..."}]}]}
```

- `asset.media-rule` directions list `identity.visual.imagery` in `traits`.
- Frame and section directions name composed part slots by slot id only.
- `meta.element.reason` cites each realised trait as `director:<slot id>` (no version suffix); a kept
  base value is `default:<ref>` beside the citation that justifies it.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json
clossys next designer/<slot> --stage diverge --file directions.json --recipe create.element --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 3. render (deterministic)

Write the candidate in the contract's shape (registry item with `meta.source.parts` for frames and
sections, the rules value for media rules). Nothing is generated; the preflight checks it mechanically.

For each direction's draft candidate:

```sh
clossys render <slot> <candidate>          # cached by (candidate sha256, dependency pin-set hash)
clossys check --constitution --slot designer/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing preflight prints the rule id and the fix: fix the draft and re-render; never edit the check.
Open tooling gaps (foundry-feedback-0015, -0018): `clossys render` renders submitted candidates only, and
`clossys check --constitution --slot` is being built (INLINE-GATES). Until each lands, this stage stops at `NEED` naming
the missing verb; it never renders by hand or skips the preflight.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next designer/<slot> --stage render --file renders.json --recipe create.element --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
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
clossys next designer/<slot> --stage critique --file critique.json --recipe create.element --model <critic model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its preflight) and critique:

```sh
clossys next designer/<slot> --stage refine --file directions.json --recipe create.element --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
clossys check --constitution --slot designer/<slot>       # same preflight, last time before the write
clossys next designer/<slot> --submit <draft> --rung L4 --reason "<create gap or Director reason>" --basis agent --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

The candidate is named by the writer (`<leaf>-v<n>`). `meta.element.reason` cites every
realised Director trait as `director:<slot id>`; a kept base value is in the reason with its Director
trait. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
