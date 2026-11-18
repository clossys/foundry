# create.statement

Creates one Director statement brief (one sentence of direction per contract key) when the slot's verdict is `create`.

- Produces: `brief.statement` (rung `create`).
- Tier: high. Axes: `stance`, `scope`, `horizon`.
- Base reference: the slot contract's question and `mustContain` keys; the pinned Director briefs and recorded findings the slot derives from. A statement is a one-sentence answer per key, at most 30 words (`brief.direction-values`).
- Director derivation: a brief derives from pinned Director slots and recorded findings only (`finding:<id>` under `clossys/evidence/director/`); never another agent, a URL or an owner note (`brief.derived-upstream`). Every source ref backs a Because line (`brief.because-cited`).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes per standard

| Standard | `stance` | `scope` | `horizon` |
| --- | --- | --- | --- |
| `brief.statement` | what the statement commits to | how much of the company it covers | when it holds and when it is re-read |

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `brief.statement`; `<tier>` is `high`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options director/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/director/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`brief.statement`).

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.statement", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
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
clossys next director/<slot> --stage brief --file brief.json --recipe create.statement --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`stance`, `scope`, `horizon`.

```json
{"recipe": "create.statement", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"stance": "<value>", "scope": "<value>", "horizon": "<value>"},
  "traits": ["<pinned upstream id realised>"]}]}
```

- `traits` lists the pinned Director slots and `finding:<id>` the direction derives from; another agent's slot fails (R20).
- A statement direction differs in what it commits to, not in wording: two directions that say the same thing in other words fail the `stance` axis.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
node packages/director/recipes/stage-check.mjs diverge <slot> directions.json
clossys next director/<slot> --stage diverge --file directions.json --recipe create.statement --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 3. render (deterministic)

Write each direction's draft candidate in the contract's shape: a Markdown brief: frontmatter `slot`, `source: {"kind": "derived", "ref": [<Director slot ids and finding:<id>>]}`, `feeds`, `functions`, `note`; then `## Direction` (one `- Key: value` line per contract key, plain language; a key that lists values is one line, comma-separated, such as `focus.reach.geography`'s `- Language: en, fr`, which the release reads as its locales), `## Because` (each line ends `(<ref>)`, every source ref cited) and `## Watch` (each line `If <metric> <comparator> <number> <window>, then <action>.`).
Nothing is generated; the checks read it mechanically.

For each direction's draft candidate, check the draft first (sections in order, every contract key once, a derived source of pinned Director slots and recorded findings, each cited in Because, Watch lines with a numeric threshold and a time window (`by <date>`, `in any month`, `per quarter` ...), plain Direction (no slot ids, refs, code or paths), at most 30 words and 1 sentence per value; a requirement it does not
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
clossys next director/<slot> --stage render --file renders.json --recipe create.statement --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
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
clossys next director/<slot> --stage critique --file critique.json --recipe create.statement --model <critic model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`node packages/director/recipes/stage-check.mjs diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its draft check and preflight) and critique:

```sh
clossys next director/<slot> --stage refine --file directions.json --recipe create.statement --model <model> --tier <tier> --skill packages/director/actions/director.candidates/skill.md
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
