---
name: clossys-producer
disable-model-invocation: true
description: Run the clossys chain (clossys run), answer its open decide step (clossys next) and interview the owner for the producer decisions, with no hand edits to records.
---

The producer chain is the action registry in pipeline order. Records change only through clossys
verbs; never edit a Director cell, pin, brief, candidate, seat or rules registry by hand.

## Run the chain

- `clossys run --dry` lists every step in order and what would run; it stops at the first decide
  step with open work. `clossys run` runs each stale plumb step (its last run record's inputs
  changed), skips fresh ones, stops red at a failed step and stops at the first open decide step.
  It makes no model calls. `--from <step>` and `--until <step>` bound the walk.
- `clossys run --explain` prints the graph: step, agent, kind (plumb, decide:creative,
  decide:judgment), decider and last run state.
- After a pin or pick, run `clossys run --dry` again: the steps that read the changed record show
  as stale, and `clossys run` re-runs them.

## Answer the open decide step

- `clossys next --json` prints the packet: the compiled brief, the slot contract, the options, the
  output path and schema, the checks, the decider (from the seat), the step's `skill.md` with its
  hash, and the command that records the answer. Read the packet's skill before deciding.
- An agent candidate is recorded with `clossys next <agent>/<slot> --submit <file> --model <id>
  --tier <tier> --basis <basis> --skill <packet skill path>`. A submission whose skill is not the
  contract's, whose model or tier is not the seat's, or whose file fails its schema or the slot
  model is refused and records nothing.

## Interview the owner

- `clossys next --owner --json` lists every open owner packet in dependency order (seats, rules,
  workspace config, IA placement, evidence, Writer approvals, pins). Each is one question with two
  to four options, the recommended one first, and a free-text option.
- Ask them in rounds of four. Each option names the exact verb arguments it records; run that
  command for the chosen option (`clossys seat`, `clossys rule`, `clossys config`, `clossys ia`,
  `clossys evidence`, `clossys approve`, `clossys pin`). A free-text answer becomes the same verb
  with the owner's values.
- Seat options carry `<model:tier>` placeholders: fill them with `--model <tier>=<id>` on
  `clossys next --owner`, or ask the owner for the model id. Never guess a model id.
- An owner decision is the owner's: present the packet, never pick for them.
