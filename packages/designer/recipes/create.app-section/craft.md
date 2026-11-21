# create.app-section

Creates one app or adaptive section slot by composing installed stock components, when the slot's verdict is `create`.

- Produces: `section.app`, `section.adaptive` (rung `create`, Designer rung L4).
- Tier: mid. Axes: `layout`, `density`, `emphasis`.
- Source: `composition` only (`recipe.json` `sources`; `clossys next --submit` refuses any other kind for a run under this recipe).
  Parts: stock components only (`recipe.json` `parts`; the composition rule refuses a frame or section part).
- Chosen by code: the one recipe producing for `section.app` and `section.adaptive`; `clossys next --stage brief`
  records it, and a run naming any other recipe is refused (R15.5).
- Checks: `R05.1`, `R06.1`, `R07.1`, `ref-verbatim` (`recipe.json` `checks`; each one the submit guard runs, see Checks).
- Base reference: the pinned stock components the slot uses (registry or npm lineage). The section
  places those parts only (`compose.layers`), uses tokens only (`tokens.only`) and reads copy only by
  Writer slot keys.
- Director derivation: `identity.visual.style` bounds every direction; `identity.brand.personality`
  sets the voice of the arrangement. Cited in `meta.element.reason` as `director:<slot id>` (R20).
- Judge: the standard and its certifier, which import nothing from this folder (R16.1). This recipe
  carries no rubric; the standard's requirements and taste are the only measure (R15.5).

## Axes

- `layout`: the arrangement of the parts (stacked, split, inline, centred).
- `density`: rows or items per view, compact or relaxed spacing from the pinned `themes.*` scale.
- `emphasis`: what the eye takes first (the heading, the primary action, the illustration).

## Composition

The candidate is a shadcn registry item whose `meta.source` is
`{"kind": "composition", "ref": [], "license": "MIT", "parts": [{"slot": "<component slot id>", "files": ["<its pin's vendored paths>"]}]}`.

- Every part is a pinned stock component (a `components.*` slot): registry lineage adopted verbatim, or an npm re-export.
  `files` lists exactly the vendored reference paths that part's pin maps.
- Every UI import is `@clossys/designer-ui` (named imports) or the `@/components/ui/<name>` alias, and
  resolves to a declared part's file. No other package, no relative file outside the candidate, no
  dynamic import.
- No raw element carries `className` or `style`: layout and look come from the parts and their
  props. A hand-written primitive is not a part.
- No literal copy: every string a reader meets (JSX text, a literal child, a literal `alt`, `title`,
  `label`, `placeholder` or `aria-*` label) is read by its Writer slot key from the props, never
  written in the code (`REF-COMP-COPY`). A bare separator glyph is not copy.
- The slot's contract holds: `contract.root` is an element of the candidate (`REF-COMP-ROOT`), and each
  `contract.landmarks` entry is a declared part its contract slot accepts or an element of the
  landmark's role, by its tag's implicit role or a literal `role` (`REF-COMP-LANDMARK`).
- The slot's `uses` equals the declared parts. If it does not, change `uses` with
  `clossys ia designer/<slot> --contract <contract.json> --uses <part,...>`; never edit slot.json.
- The candidate ships the file the contract fixture mounts (`contract.fixture.fixtures.file`) with
  the export it names, and renders with the fixture's props.

## Checks

The candidate must pass each check `recipe.json` names; the submit guard (and the pin gate) runs every
one, so a draft that fails one is refused, never written:

- `R05.1`: certified against the slot's own contract fixture: schema, server render with the fixture
  props, and every requirement of the standard (`compose.layers`, `source.ref`, `tokens.only`).
- `R06.1`: every `dependencies` entry is `<name>@<x.y.z>` and in the consumer's package-lock.
- `R07.1`: every slot the candidate cites (its parts, its `@/` imports) is in the slot's `inputs` or `uses`.
- `ref-verbatim`: the composition rule: each part stock and verbatim (`REF-COMP-PART`), each import a
  declared part's file identical to its pin (`REF-COMP-IMPORT`), each part used (`REF-COMP-UNUSED`),
  `uses` equal to the parts (`REF-COMP-USES`), no styled raw markup (`REF-COMP-MARKUP`), no literal copy
  (`REF-COMP-COPY`), the contract root and landmarks rendered (`REF-COMP-ROOT`, `REF-COMP-LANDMARK`).

## Stages (slot-constitution 5b, fixed order)

Model judgement happens at three nodes only: **brief**, **diverge** and **critique**. Every other step
is a deterministic verb or check, and render and preflight are cached by sha (candidate sha256, standard
sha, contract sha, dependency pin-set hash), so a re-run with unchanged inputs costs nothing. Each stage
checks its own output before it is recorded; a non-zero exit is fixed at that stage, never carried
forward. The same error twice is `BLOCKED`. Never run a full suite from a recipe.

`<slot>` is one slot of `section.app` or `section.adaptive`; `<tier>` is `mid`; `<model>` is the serving model id of the run.

### 0. Preconditions (deterministic)

1. `clossys options designer/<slot>` lists the options packet; the slot's latest verdict must be
   `create` for that packet's inputs (P2). `clossys next --stage` refuses itself otherwise, so read the
   refusal and stop: the recipe never records a verdict.
2. Read `clossys/agents/designer/<slot>/slot.json`: `standard`, `contract`, `inputs`, `uses`. The
   standard must be one this recipe produces for (`section.app`, `section.adaptive`).
3. Every part the section will place is a pinned stock component (registry or npm lineage). A part
   that is unpinned or pinned with any other lineage stops the run at `NEED`: request its pin, never
   hand-write it.

### 1. brief (model)

Before any direction exists, write `brief.json`:

```json
{"recipe": "create.app-section", "standard": "<standard id>", "requirements": ["<every requirement id of the standard>"],
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
clossys recipe check create.app-section brief <slot> brief.json
clossys next designer/<slot> --stage brief --file brief.json --recipe create.app-section --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 2. diverge (model)

Write `directions.json`: 3 directions (4 at most), each one line, each a distinct point on the axes
`layout`, `density`, `emphasis`.

```json
{"recipe": "create.app-section", "directions": [{"id": "<slug>", "idea": "<one line>", "axes": {"layout": "<value>", "density": "<value>", "emphasis": "<value>"},
  "traits": ["<Director slot id realised>"], "keeps": [{"ref": "<base value kept>", "because": "director:<trait> ..."}]}]}
```

- Each direction names the parts it places in `idea` by slot id only.
- `meta.element.reason` cites each realised trait as `director:<slot id>` (no version suffix); a kept
  base value is `default:<ref>` beside the citation that justifies it.

Check the axes are pairwise distinct (and every rule above) before anything renders, then record:

```sh
clossys recipe check create.app-section diverge <slot> directions.json
clossys next designer/<slot> --stage diverge --file directions.json --recipe create.app-section --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 3. render (deterministic)

Write each direction's draft as a composition (see Composition). Nothing is generated; the preflight
checks layers, tokens-only and parts mechanically.

For each direction's draft candidate:

```sh
clossys render <slot> --draft <direction file>   # a draft before submit; cached by (sha256, dependency pin-set hash)
clossys check --constitution --slot designer/<slot>       # per-slot preflight, under 10s, cached by sha
```

A failing preflight prints the rule id and the fix: fix the draft and re-render; never edit the check.
This stage never renders by hand or skips the preflight. Then record the render set (`renders.json`:
`{"renders": [{"direction": "<id>", "candidate": "<name>", "path": "<render path>", "sha256": "<render sha>"}]}`):

```sh
clossys next designer/<slot> --stage render --file renders.json --recipe create.app-section --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 4. critique (model, fresh critic)

```sh
clossys critique-packet designer/<slot> --standard <standard> --render <path> --render <path> --render <path>
```

The packet is anonymised (A, B, C), shuffled, carries `taste.md`, at most 3 exemplars and the contract,
and no maker file (no recipe, craft.md, directions, brief or notes; R16.2). A fresh critic context that
has never seen this recipe reads only that manifest and writes `critique.json` (scores per taste id of
the standard, notes, the packet sha).

```sh
clossys critique designer/<slot> --record critique.json --model <critic model> --tier <tier> --candidate <name>
clossys next designer/<slot> --stage critique --file critique.json --recipe create.app-section --model <critic model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

### 5. refine (at most 2 rounds)

Choose the direction the critique scored highest (a deterministic read of the recorded scores). A
refine round re-enters the diverge node for that one direction: it changes only that direction's values,
only on the axes the critique named, and writes them back into `directions.json`;
`clossys recipe check create.app-section diverge <slot> directions.json` must still pass, so a refine never collapses into another
direction. Then repeat render (with its preflight) and critique:

```sh
clossys next designer/<slot> --stage refine --file directions.json --recipe create.app-section --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

Two rounds is the cap (`refine render critique` twice at most). If the second critique still fails a
taste id, submit the best render with that finding in the reason, or stop at `NEED` naming it.

### 6. submit (deterministic)

```sh
clossys check --constitution --slot designer/<slot>       # same preflight, last time before the write
clossys next designer/<slot> --submit <draft> --rung L4 --reason "<create gap or Director reason>" --basis agent --model <model> --tier <tier> --skill packages/designer/actions/designer.candidates/skill.md
```

The submit runs every check this recipe names and refuses a candidate that is not a composition. The
candidate is named by the writer (`<leaf>-v<n>`). Never hand-edit slot, candidate, pin or ledger
files: the verbs write them.
