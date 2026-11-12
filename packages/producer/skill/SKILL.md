---
name: clossys-producer
disable-model-invocation: true
description: Run the clossys chain (clossys run), answer its open decide step (clossys next) and interview the owner for the producer decisions, with no hand edits to records.
---

The producer chain is the action registry in pipeline order. Records change only through clossys
verbs; never edit a Director cell, pin, brief, candidate, seat or rules registry by hand.

Run every verb from the workspace root (the folder that holds `clossys/`) as `npx --no-install clossys
<verb>`: the `clossys` binary of the installed `@clossys/producer` (in the Foundry repository, its
workspace package, built with `npm run build`). `--no-install` stops npx from fetching a package of
that name from the registry; when it reports no `clossys`, the package is not installed or built, and
that is the first gap to report.

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
- `--rung`, `--seed` and `--reason` record the selection ladder the packet's skill states (see
  Rules).
- An agent pick (a `pick.<agent>` seat with an llm) is recorded with
  `clossys pick <agent>/<slot> <candidate> --by agent:<agent>`; the owner confirms it with
  `clossys pin <agent>/<slot> <candidate> --confirm --ref <where their words are>` (the pick keeps
  basis `agent` and gains `confirmed`), or re-pins it with `--basis picked`.

## Rules

Each rule is stated once, here or in the one place named, and the named check or refusal holds it.

- **Only wiring blocks.** A step fails red only on wiring: a missing, stale or invalid input,
  record or citation, or a check that cannot run. A wording or visual finding is a report: the step
  passes and lists it under its `reports` for the owning agent. A gate's mode (`block` or `report`)
  and the reason live in the gate's own config (the Designer's `scripts/process-gates.json`); a
  broken gate fails in every mode.
- **Each step runs only its own check.** A step's contract (`actions/<id>/action.json`) names its
  inputs, outputs, command, `checks` and `pass`; `clossys run` runs a step's own command only when
  an input it read last time changed, and re-measures nothing a later step could not have changed
  (`check:step-standard`, rules `snapshot.stale` and `steps.drift`).
- **Owner questions are policy-level**: the Interview below (`check:step-standard` rules
  `owner.argv` and `owner.policy`; `clossys pipeline check` rule `owner.wiring`).
- **The selection ladder** is stated in each `<agent>.candidates` step skill, the skill the
  packet hands over (`check:step-standard` rule `skill.ladder`). A submission whose
  ladder record does not hold is refused, and `clossys gaps` lists a recorded one as a `ladder` gap;
  the Designer's sources are held by `check:source-ladder`.
- **A pointer-only upstream change is re-cited in place.** After `pin.director` and `pin.writer`,
  `clossys run` runs `recite.direct` and `recite.design` (`clossys migrate recite --cascade`): a
  citer whose cited meaning is byte-for-byte unchanged (the Director cell's Direction section; any
  other candidate without its note and slot versions) is re-cited by `agent:producer`, with the
  meaning hash recorded as `recited.proof`. A changed meaning re-cites nothing and opens
  `<agent>.candidates` for that slot (its pick, once a newer candidate is drafted). The steps' pass,
  `--cascade --check`, fails while a re-cite is pending.
- **Requests go to the upstream owner**: the Interview's gaps below (`check:step-standard` rule
  `request.addressee`).
- **Agent work is submitted only through `clossys next --submit`** from the step's seat (Answer
  the open decide step lists what it refuses).

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
  lacks. A request is asked in the upstream agent's round; never hand-fill it or the slot it names.
  Close agent-decided gaps with the agent's own skill.
- **Then the rounds**: `clossys next --owner --agent <id> --json` returns `rounds` of at most 4
  questions, taken from the gaps. Each question has 2 to 4 options, the recommended one first, and a
  free-text answer (`freeText.verb`). Items that share an option set are one question whose option
  runs one call per item (the 18 seats are about 4 questions); a request joins the question on the
  same item and lists `requestedBy`. A question with `after` waits for those questions' answers.
  The Designer, Writer and Publisher ask by policy: one `<id>.policy` question covers every slot the
  agent can infer (its agent pick or recommended candidate), with by-group options; a slot is asked
  on its own only with a stated `reason`. `clossys pipeline check` (owner.wiring) runs every option
  on a scratch copy, so an option that records nothing fails the check.
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
