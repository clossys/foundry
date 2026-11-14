# create.tokens

Creates one `themes.*` token slot (colour, typeface or scale) as a shadcn `registry:theme` candidate with `cssVars` and the DTCG file `clossys/<slot>.json`, when the slot's verdict is `create`.

- Produces: `token.color`, `token.typeface`, `token.scale` (rung `create`, Designer rung L4).
- Tier: high. Axes: `temperament`, `departure`, `emphasis`.
- Base reference: Tailwind v4 `theme.css` and the shadcn default theme are the base reference only. A base value is never a reason: keeping one is a decision with a Director reason (`keeps[].because` cites `director:<trait>`), recorded in `meta.element.reason`.
- Director derivation: every direction realises named traits of `identity.visual.style` (v9: quiet and exact, stock shadcn with restrained colour only), `identity.brand.essence` and `identity.brand.personality` (precise, plain-spoken, calm); `token.typeface` also reads `identity.verbal.voice`. The traits are listed in each direction's `traits` and cited in `meta.element.reason` (`derive.director`, R20).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `temperament` | `departure` | `emphasis` |
| --- | --- | --- | --- |
| `token.color` | neutral temperature (cool, neutral, warm grey) | distance from the base (keep, shift, replace) | where the accent lives (primary only, primary and ring, charts) |
| `token.typeface` | letterform family (grotesk, humanist, geometric) | distance from the base stack | weight and size contrast carried by the face |
| `token.scale` | step ratio (tight, even, open) | distance from the Tailwind v4 steps | which steps carry the contrast |

Contract rules the draft must meet (`token.dtcg`): the slot contract's `$type`, its closed member set, every
mode it names (`token.color` needs `light` and `dark`), provenance per member where the standard asks for it,
and `source.ref` kinds and licences the standard allows (`token.typeface`: fontsource or npm faces under
MIT, OFL-1.1 or Apache-2.0, each with `com.clossys.font` kind and dependency).

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `token.color`, `token.typeface`, `token.scale`; `<tier>` is `high`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options designer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/designer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`token.color`, `token.typeface`, `token.scale`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.tokens", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
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
clossys next designer/<slot> --stage brief --file brief.json --recipe create.tokens --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`temperament`, `departure`, `emphasis`.

```json
{"recipe": "create.tokens", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"temperament": "<value>", "departure": "<value>", "emphasis": "<value>"},
  "traits": ["<Director slot id realised>"], "keeps": [{"ref": "<base value kept>", "because": "director:<trait> ..."}]}]}
```

- Each direction names the traits it realises (`traits`, pinned slot ids); together the directions
  cover every trait the standard derives from, and every required trait in each direction.
- `token.color`: accent economy follows `identity.visual.style` (restrained colour only); a direction that
  adds colour says which trait asks for it.
- A value kept from the base reference is a `keeps` entry whose `because` cites `director:<trait>`.
- `meta.element.reason` is written as `director:<slot id>` citations (no version suffix); a kept base
  value is written `default:<ref>` beside the citation that justifies it (`derive.director`).

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json
clossys next designer/<slot> --stage diverge --file directions.json --recipe create.tokens --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 3. render (deterministic)

Write one spec per direction (`spec.json`: `slot`, `members` by mode, `reason` citing `director:<slot id>`
for each realised trait and kept default, `source`, optional `provenance`, `font`, `dependencies`,
`cssScope`) and generate the draft candidate deterministically from the slot contract:

```sh
node packages/designer/recipes/create.tokens/generate.mjs spec.json > draft.json
```

The generator is plumbing only: it refuses a member outside the closed set, a missing mode, a reason
without `director:` and a missing source. The same spec and contract always give the same bytes.

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
clossys next designer/<slot> --stage render --file renders.json --recipe create.tokens --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
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
clossys next designer/<slot> --stage critique --file critique.json --recipe create.tokens --model <critic model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/designer/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its preflight) and critique:

```sh
clossys next designer/<slot> --stage refine --file directions.json --recipe create.tokens --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
clossys check --constitution --slot designer/<slot>       # same preflight, last time before the write
clossys next designer/<slot> --submit <draft> --rung L4 --reason "<create gap or Director reason>" --basis agent --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

Submit `draft.json` from the generator unchanged. The candidate is named by the writer (`<leaf>-v<n>`). `meta.element.reason` cites every
realised Director trait as `director:<slot id>`; a kept base value is in the reason with its Director
trait. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
