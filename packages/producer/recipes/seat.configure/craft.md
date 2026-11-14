# seat.configure

Configures one pipeline seat (who decides one step, which model and tier runs it from which skill, how a person does it by hand) when the slot's verdict is `create`.

- Produces: `seat` (rung `create`).
- Tier: mid. Axes: `holder`, `tier`, `hand`.
- Base reference: the slot contract (`step`, its `fixture` seat); `clossys/seat-policy.json` (the model per tier, human-only); the step's skill file under `packages/<agent>/actions/`.
- Producer derivation: a seat held by `agent:<agent>` runs a skill of that agent; an owner or planner seat runs a Producer skill (`seat.prompt-owner`); an owner seat keeps a human procedure (`seat.assigned`).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `holder` | `tier` | `hand` |
| --- | --- | --- | --- |
| `seat` | agent, planner or owner | a tier the seat policy maps (llm hand), or none (human only) | llm only, human only, or both |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `seat`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

Producer gap (foundry-feedback-0015, F-seat-craft): `clossys next --stage`, `critique-packet` and `critique`
take Director, Designer, Writer and Publisher slots only (no `producer.candidates` step), so for a seat
each `clossys next producer/<slot> --stage` and critique call stops at `NEED` naming the verb; the stage
checks still run, and the seat is written by `clossys seat` (stage 6).

### 0. Preconditions (deterministic)

1. `clossys options producer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/producer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`seat`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "seat.configure", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
 "inputs": [{"slot": "<slot id>", "candidate": "<pinned candidate>", "sha256": "<pinned sha>"}],
 "tasteLog": <newest 20 entries, or all when fewer>, "brief": "<one paragraph, at most 1200 chars>", "step": "<contract.step>"}
```

- `requirements` lists the standard's requirement ids exactly (from
  `packages/producer/standards/<standard>/requirements.json`).
- `inputs` lists every pinned upstream input (the slot's `inputs`, none for most seats), each at its pinned candidate and sha256. Name slots by slot id
  only (R06.7): never a file path, package name or candidate body.
- The taste log (`clossys/agents/producer/taste/<standard>/taste-log.json`) is read as preferences, never as a rubric.

Check, then record:

```sh
node packages/producer/recipes/stage-check.mjs brief <slot> brief.json
clossys next producer/<slot> --stage brief --file brief.json --recipe seat.configure --model <model> --tier <tier> --skill packages/producer/actions/seats/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`holder`, `tier`, `hand`.

```json
{"recipe": "seat.configure", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"holder": "<value>", "tier": "<value>", "hand": "<value>"},
  "traits": ["<pinned upstream id realised>"]}]}
```

- Each direction is a feasible seat: `holder` is `owner`, `planner` or `agent:<agent>`; `hand` is `llm`, `human` or `llm+human`; an owner holder needs a human hand; an llm hand needs a `tier` the seat policy maps to a model, and a human-only hand sets `tier` to `none`.
- Seats have no pinned upstream: `traits` may be empty.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/producer/recipes/stage-check.mjs diverge <slot> directions.json
clossys next producer/<slot> --stage diverge --file directions.json --recipe seat.configure --model <model> --tier <tier> --skill packages/producer/actions/seats/skill.md
```

### 3. render (deterministic)

Write each direction's draft candidate in the contract's shape: a JSON seat: `{"by": "owner" | "planner" | "agent:<agent>", "llm": {"model", "tier", "promptFile": "packages/<agent>/actions/<step>/skill.md"} | null, "human": {"procedure": "<a sentence of six words or more>", "command": "clossys <verb>"} | null}`.
Nothing is generated; the checks read it mechanically.

For each direction's draft candidate, check the draft first (a holder of owner, planner or agent:<agent>, an llm with a model id, a tier and a skill path of the holder's agent that exists, the seat policy's model for that tier, a human procedure sentence and a clossys verb, a human for an owner seat; a requirement it does not
check is named in its clean line as left to `clossys check --constitution --slot`), then render and preflight:

```sh
node packages/producer/recipes/stage-check.mjs draft <slot> <draft>
clossys render <slot> <candidate>          # cached by (candidate sha256, dependency pin-set hash)
clossys check --constitution --slot producer/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing check prints the rule id, the requirement and the fix: fix the draft and re-check; never edit the check.
Open tooling gaps (foundry-feedback-0015, -0018): `clossys render` renders submitted candidates only, and
`clossys check --constitution --slot` is being built (INLINE-GATES). Until each lands, this stage stops at `NEED` naming
the missing verb; it never renders by hand or skips the preflight. The draft check above is the maker's
own preflight and runs now; it does not replace `clossys check --constitution --slot`.
Then record the render set (`renders.json`: `{"renders": [{"direction": "<id>", "candidate": "<name>",
"path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next producer/<slot> --stage render --file renders.json --recipe seat.configure --model <model> --tier <tier> --skill packages/producer/actions/seats/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet producer/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, stage check, directions, brief or notes; R16.2). A fresh critic
context that has never seen this recipe reads only that manifest and writes `critique.json` (scores
per taste id of the standard, notes, the packet sha).

```sh
clossys critique producer/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next producer/<slot> --stage critique --file critique.json --recipe seat.configure --model <critic model> --tier <tier> --skill packages/producer/actions/seats/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/producer/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its draft check and preflight) and critique:

```sh
clossys next producer/<slot> --stage refine --file directions.json --recipe seat.configure --model <model> --tier <tier> --skill packages/producer/actions/seats/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
node packages/producer/recipes/stage-check.mjs draft <slot> <draft>
clossys check --constitution --slot producer/<slot>       # same preflight, last time before the write
clossys seat <step> --by <holder> --model <model> --tier <tier> --prompt-file <promptFile> --procedure "<procedure>" --command "<clossys verb>"
```

`clossys seat` writes the seat candidate and pins it as the seat policy allows. A human-only seat (hand `human`) takes `--no-llm` in place of `--model`, `--tier` and `--prompt-file`; `--decided-by owner|planner` only on an owner or planner seat. Never hand-edit slot, candidate, pin or ledger files: the verbs write them.
