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
  --tier <tier> --basis <basis> --skill <packet skill path> --rung <rung> [--seed <id>]
  [--reason <text>]`. A submission whose skill is not the contract's, whose model or tier is not
  the seat's, whose file fails its schema or the slot model, which is byte-identical to a held
  candidate, or whose selection-ladder record does not hold is refused and records nothing.
- The selection ladder (each `<agent>.candidates` skill): select a seed first (stock shadcn, a
  trusted free registry, an existing candidate or template), adapt one only when none fits, create
  only when none can be adapted. `--rung` records which (`select`, `adapt`, `create`; the Designer's
  source-ladder rungs `L1` to `L4`), `--seed` names the seed, and a created candidate needs
  `--reason`: why no seed fit.
- An agent pick (a `pick.<agent>` seat with an llm) is recorded with
  `clossys pick <agent>/<slot> <candidate> --by agent:<agent>`; the owner confirms it with
  `clossys pin <agent>/<slot> <candidate> --confirm --ref <where their words are>` (the pick keeps
  basis `agent` and gains `confirmed`), or re-pins it with `--basis picked`.

## Interview

This is the Interview contract. Every agent skill (Producer, Director, Designer, Writer, Publisher)
cites it and runs it for its own agent id; `<id>` below is that id, `producer` here.

- **When to run it**: at session start; after every pin, pick, approve or seat answer; when
  `clossys run` stops at an owner decide step; when a downstream agent reports a need.
- **Gaps first**: `clossys gaps --agent <id> --json` lists what keeps the agent from done, in three
  kinds. Coverage: open decide items, slots with no candidates or no pin, failing checks, a missing
  seat policy. Wiring: pinned slots citing an input pinned since (stale citations), steps with no
  seat, plumb steps that failed or went stale (chain drift), a candidate whose ladder record does
  not hold. Requests: a downstream agent's need addressed `to` this agent (`from`, `need`), such as
  a Designer slot citing an unclear Director cell or a Publisher page naming Writer keys the copy
  lacks. Close agent-decided gaps with the agent's own skill; never hand-fill a request.
- **Then the rounds**: `clossys next --owner --agent <id> --json` returns `rounds` of at most 4
  questions, taken from the gaps. Each question has 2 to 4 options, the recommended one first, and a
  free-text answer (`freeText.verb`). Items that share an option set are one question whose option
  runs one call per item (the 18 seats are about 4 questions); a request joins the question on the
  same item and lists `requestedBy`. A question with `after` waits for those questions' answers.
- **Ask each round** with the host's control: on Claude one `AskUserQuestion` call per round (each
  question's `header`, `question` and option labels); on Codex a numbered list per question, the
  recommended answer first. Never answer an owner question for the owner.
- **Record through the verbs**: run every argv in the chosen option's `calls`, exactly, filling only
  the words its `fill` names from the owner's answer. A free-text answer is recorded through
  `freeText.verb` with the owner's words as its arguments; when it carries `freeText.calls`, run
  each in order, filling its `fill` words. `<model:tier>` words come from
  `clossys/seat-policy.json`, written by `clossys seat --policy --model <tier>=<id>` (or
  `--human-only`); while it is missing its question is asked first. Never guess a model id; never
  edit a record by hand.
- **Cascade**: run `clossys run` after each round, so the steps that read a changed record re-run
  and the next decide step opens.
- **Stop at 0 gaps**: repeat gaps, rounds, verbs and `clossys run` until
  `clossys gaps --agent <id>` reports 0 gaps (held gaps, such as a human-only seat, stay listed by
  rule and count as held).

For this skill: `clossys gaps --agent producer --json`, then
`clossys next --owner --agent producer --json`.
