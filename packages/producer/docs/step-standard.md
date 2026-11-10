# The step standard

Every pipeline step is one **action contract**: a data file at
`packages/<package>/actions/<action-id>/action.json`. Each action has a flat folder of its own.
Grouping lives only in `packages/<package>/actions/ia.json`, with three levels: L1 agent, L2 stage
and L3 action. Code binds to a contract by its id in `src/pipeline/steps/bindings.ts`.

Three files are generated from the contracts and the bindings, and nobody writes them by hand:

- `pipeline/actions.json` holds every contract in pipeline order, and the runtime loads its steps from it.
- `pipeline/manifest.json` lists, per agent, its steps, verbs, commands, skill files, code and exceptions.
- `pipeline/graph.json` is the step graph.

To regenerate all three, run `npm run generate:pipeline-graph` after the build.
`check:step-standard` (`scripts/check-step-standard.mjs`) enforces everything in this file. It is a
root gate and runs after `check:pipeline`. Its header lists one failure rule per requirement, and
`scripts/check-step-standard.test.mjs` breaks each rule once to prove that the check exits 1.

## Schema (`pipeline/schemas/action.schema.json`, `clossys.action/1`)

| field | required | meaning |
|---|---|---|
| `id` | yes | Dotted lowercase name. It equals the folder name. |
| `agent` | yes | One of `director`, `designer`, `writer`, `publisher`, `producer` or `owner`. It equals the package, except that producer also holds `owner` actions. |
| `kind` | yes | One of `plumb`, `decide:creative` or `decide:judgment`. |
| `stage` | yes | `<round>.<stage>`, taken from `define.ts` `STAGES`. |
| `summary` | yes | One sentence. |
| `run` / `gap` | exactly one | `run` is one `clossys` command, run from the action's package directory. `gap` is `{unit, reason}`: a decision that has no clossys verb yet, together with the backlog unit that adds one. Only a decide action may be a gap. |
| `inputs` / `outputs` | yes | Typed ports `{glob, schema}`. Every schema is a file under `pipeline/schemas/`. Globs are workspace-relative. `pkg:` is relative to this package, `arg:` is a path the caller passes, and `#field` names one field of the file (the port uses the file's schema). |
| `pass` | yes | `{command, exit}`. This is the check that decides pass or fail, never "it ran". `command` is a `clossys` command, and `exit` is always `{pass:[0], fail:[1], error:[2]}`. |
| `record` | yes | Always `clossys.pipeline-run/1`, W1b's run-record format. Rows go to `.clossys/runs/<step>.jsonl`. |
| `checks` | yes | Check ids from `src/pipeline/steps/checks.ts`. A traced pass's `check:<id>` must be one of them. |
| `uses` | yes | Package bins (`bin:<name>`) and skill files (package-relative) that the step runs or reads. |
| `decider` | decide only | `owner` or `agent`. An `owner` action is always owner-decided. |
| `packet` | decide only | `{inputs, write, checks}`. `inputs` are the input globs the decider is given, `write` are the typed ports it writes, and `checks` are what those ports must pass. Each item is a subset of the contract's own inputs, outputs and checks. |
| `skill` | decide only | Always `"skill.md"`. The judgment-only skill sits beside the contract. |
| `open`, `pending` | optional | `open` names the counter of open decisions. `pending` marks a step that lands on another branch. |

### The forms a run takes

A run takes one of two forms:

- `clossys <verb> [mode flags] [<agent>/<slot>] [<placeholders>]` is a CLI verb. The verb is either
  a shared-parser verb from `src/cli/args.ts` `VERBS`, or a verb with its own parser that a bound
  handler serves. Mode flags are bare `--flag` words. `<...>` words are values the caller supplies.
- `clossys pipeline trace <id> -- <npm run X | node file>` is a traced script. The id is the
  action's own id (or `check:<id>` in a pass). The traced command must resolve in the action's
  package, and it must run the script the binding names.

There is no `manual` form. An owner decision names the clossys verb that records it, such as
`clossys pin`, or it is a `gap`.

### Bindings (`src/pipeline/steps/bindings.ts`)

A binding is `{entry?, parser?, script?, module?}`, with paths relative to the package. Each part
has its own rule:

- A `clossys` verb binds its handler `entry`, which is a `src/pipeline/handlers.ts` `HANDLERS` key.
  A verb with its own argv parser also binds that parser.
- A traced run binds the `script` its command runs.
- A gap may bind only the `module`s its decider writes through.

The check fails in both directions:

- a contract with a run but no binding
- a binding with no contract
- a handler that no binding names
- a binding that disagrees with its run

### Bins, skill files and exceptions

Every package bin and every package skill file (any `.md` under `skill/`) must be one of these:

- named in some contract's `uses`
- the `clossys` CLI itself
- listed in `packages/<package>/actions/exceptions.json` with a reason and the unit that closes it

An exception that has since become covered, or whose item no longer exists, fails the check as stale.

### Skill versions

Code actions have no candidates or pins. A decide action's `skill.md` is the only versioned
judgment. A new version replaces it only when the packet's checks pass.

## One example per kind

### `plumb`: `packages/producer/actions/compile/action.json`

```json
{
  "schema": "clossys.action/1", "id": "compile", "agent": "producer", "kind": "plumb", "stage": "publish.assemble",
  "summary": "Compile the Studio from decision files only into the compile lock.",
  "run": "clossys compile",
  "inputs": [{ "glob": "clossys/agents/*/*/pin.json", "schema": "pin" }, { "glob": "clossys/agents/*/*/slot.json", "schema": "slot" }],
  "outputs": [{ "glob": "pkg:studio/compile.lock.json", "schema": "compile-lock" }],
  "pass": { "command": "clossys pipeline trace check:compile-pure -- node scripts/check-compile-pure.mjs", "exit": { "pass": [0], "fail": [1], "error": [2] } },
  "record": "clossys.pipeline-run/1", "checks": ["compile-pure"], "uses": []
}
```

The binding is `compile: { entry: "src/cli/compile.ts#runCompileCli", parser: "src/cli/compile.ts" }`.
The inputs above are trimmed; the file lists every candidate port.

### `decide:creative`: `packages/writer/actions/writer.candidates/action.json`

```json
{
  "schema": "clossys.action/1", "id": "writer.candidates", "agent": "writer", "kind": "decide:creative", "stage": "design.make",
  "summary": "Create Writer candidates: one immutable file per option, per L3 slot.",
  "gap": { "unit": "W6a", "reason": "no clossys verb records a candidate yet; the agent's skill writes through writeCandidate" },
  "inputs": [{ "glob": "clossys/agents/director/*/pin.json", "schema": "pin" }, { "glob": "clossys/agents/writer/*/slot.json", "schema": "slot" }],
  "outputs": [{ "glob": "clossys/agents/writer/*/candidates/*", "schema": "candidate-strings" }],
  "pass": { "command": "clossys check", "exit": { "pass": [0], "fail": [1], "error": [2] } },
  "record": "clossys.pipeline-run/1", "checks": ["workspace"], "uses": ["skill/SKILL.md"],
  "decider": "agent",
  "packet": { "inputs": ["clossys/agents/director/*/pin.json", "clossys/agents/writer/*/slot.json"], "write": [{ "glob": "clossys/agents/writer/*/candidates/*", "schema": "candidate-strings" }], "checks": ["workspace"] },
  "skill": "skill.md", "open": "slots-without-candidates:writer"
}
```

### `decide:judgment`: `packages/producer/actions/pin.designer/action.json`

```json
{
  "schema": "clossys.action/1", "id": "pin.designer", "agent": "owner", "kind": "decide:judgment", "stage": "design.pin",
  "summary": "Pin one candidate per Designer L3 slot, or mark the slot not needed.",
  "run": "clossys pin designer/<slot> <candidate-id>",
  "inputs": [{ "glob": "clossys/agents/designer/*/candidates/*", "schema": "candidate-element" }, { "glob": "clossys/agents/designer/*/slot.json", "schema": "slot" }],
  "outputs": [{ "glob": "clossys/agents/designer/*/pin.json", "schema": "pin" }, { "glob": "clossys/agents/designer/*/slot.json#notNeeded", "schema": "slot" }],
  "pass": { "command": "clossys pipeline trace check:slot-pins -- npm run check:slot-pins", "exit": { "pass": [0], "fail": [1], "error": [2] } },
  "record": "clossys.pipeline-run/1", "checks": ["decisions", "slot-state", "slot-pins", "pin-propagation", "every-candidate-previewable"], "uses": [],
  "decider": "owner",
  "packet": { "inputs": ["clossys/agents/designer/*/candidates/*", "clossys/agents/designer/*/slot.json"], "write": [{ "glob": "clossys/agents/designer/*/pin.json", "schema": "pin" }, { "glob": "clossys/agents/designer/*/slot.json#notNeeded", "schema": "slot" }], "checks": ["slot-pins", "decisions"] },
  "skill": "skill.md", "open": "slots-undecided:designer"
}
```

## Adding or changing a step

1. Write or edit `packages/<package>/actions/<id>/action.json`. For a decide action, also write its `skill.md`.
2. Place the id once in that package's `actions/ia.json`, under the action's agent and stage.
3. Bind its code in `src/pipeline/steps/bindings.ts`.
4. Build, run `npm run generate:pipeline-graph`, then run `npm run check:step-standard` and `npm run check:pipeline`.
