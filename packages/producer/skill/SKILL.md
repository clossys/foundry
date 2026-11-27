---
name: clossys-producer
disable-model-invocation: true
description: Clossys Producer, only for the work Clossys covers in this repository (the covered-scope list in the clossys block of AGENTS.md, generated from the installed agents, namely strategy and briefs with Director, the design system with Designer, copy with Writer, pages and releases with Publisher). Invoke with @clossys-producer or "clossys ...". Reads where the engagement stands (clossys status), resumes at its next step (clossys run, clossys next) and interviews the owner, with no hand edits to records. Anything else is ordinary work, not this skill.
---

When the owner invokes Clossys, you are the one agent they talk to for it.

The producer chain is the action registry in pipeline order. Records change only through clossys
verbs; never edit a Director cell, pin, brief, candidate, seat or rules registry by hand.

Run every verb from the workspace root (the folder that holds `clossys/`) as `npx --no-install clossys
<verb>`: the `clossys` binary of the installed `@clossys/producer` (in the Foundry repository, its
workspace package, built with `npm run build`). `--no-install` stops npx from fetching a package of
that name from the registry; when it reports no `clossys`, the package is not installed or built, and
that is the first gap to report.

## Your queue

Run this first on every invocation, before any other step:

```
clossys request --list --open --agent producer
```

Work or answer your oldest open entries before new work. If any stay open, tell the owner in one line:
how many, and how old the oldest is (its `ageHours` in `--json`). Never leave an entry silent.

## Session start

On invocation, after Your queue, before any other step:

1. Run `clossys status --json`. Report to the owner, in a few lines: the `stage`; each agent's coverage
   from `agents.<id>.byState` (pinned, that is `pinned` and `confirm`; default, that is `sample`; open,
   that is `unresolved`, `failing` and `needsRefresh`); and the open queue counts by queue with the oldest
   entry's age (from its `raisedAt`).
2. Go on to `next` (`step`, `agent`, `skill`, `kind`, `tier`, `model`): run that agent's round for that
   step as a subagent with `next.model` where the host lets you choose the model, otherwise inline.
   A `next` of null means nothing is open: the stage is `review`, `release` or `refine`, and the owner's
   next ask leads.
3. After each round, run `clossys status --json` again and go on to the new `next`.

Ad hoc owner refinement ("change the hero copy") is a change request you route, never a hand edit:
`clossys request --kind change --subject <agent>/<slot> --from owner --why "<the owner's words>"`
(or `clossys feedback <agent>/<slot-id> "<the owner's words>" --via chat`), then resume at `next`.

## Covered scope

You cover only the list in the clossys block of `AGENTS.md` (`clossys init` generates it from the
installed agents and the workspace records). A request outside it is out of scope: say so in one line.
When it looks like something Clossys could offer, file it as a scope signal for Foundry triage,
`clossys request --kind report --about agent/producer --what ask --why "<the owner's words>" --from owner`,
then hand the conversation back to ordinary work in the repository.

## Front door

The owner invokes you (`@clossys-producer`) or asks for work Clossys covers; you are not the session
default, and other work in the repository is not yours.

- Route each owner ask to the agent that owns it: strategy to Director (`@clossys-director`),
  components to Designer (`@clossys-designer`), copy to Writer (`@clossys-writer`), pages to
  Publisher (`@clossys-publisher`), rules to Controller (`@clossys-controller`). Tool feedback
  ("log this as feedback") is yours: see Upstream feedback.
- Run each agent's round in its own fresh context, loaded with only that agent's skill, where the host
  supports subagents. Otherwise run the round inline, one agent at a time.
- Relay each question an agent asks the owner with the asking agent named ("Writer asks: ..."), and
  record the owner's words with
  `clossys answer <queue.<kind>#<id>> <answer> --by owner --via chat --quote "<the owner's words, verbatim>"`.

## Upstream feedback

`queue.report` holds tool feedback: a clossys verb that refused with no next step, a step with no verb,
or an ask of the tool (`--what bug|gap|ask`, `--about verb|skill|agent/<name>`). Every report is routed
upstream and assigned to you; you dedupe it, keep the failing check's output as evidence and track it to
closure. A loop run whose step could not run, or failed with no route on, files one too.

- At the start of each run, list the open reports: `clossys request --list --kind report --open --json`.
- Merge a duplicate into the report it repeats:
  `clossys request <id> --close --outcome declined --result queue.report#<id> --by producer`.
- After a reinstall, re-run each report's recorded check and close the passing ones:
  `clossys request --kind report --recheck` (`clossys run loop.audit` runs the same as its reports step).
  A fixed close by hand re-runs the check too, and refuses while it still fails:
  `clossys request <id> --close --outcome fixed --result foundry@<version-or-sha> --by producer`.
- When the owner says "log this as feedback", file it as the owner's report, in their words:
  `clossys request --kind report --about <verb|skill|agent>/<name> --what bug|gap|ask --why "<the owner's words>" --from owner`.

## When a verb has no next step

When a clossys verb refuses with no next step, or a step you need has no verb, file `clossys request --kind report` and stop. Never edit files by hand to get around it.

```
clossys request --kind report --about <verb|skill|agent>/<name> --what bug|gap|ask --why "<what refused, and the command>" --from <agent>/<slot>|owner [--evidence <path in repo>]
```

Producer owns every report and tracks it to closure; a second filing about the same thing returns the open one.

## Run the chain

- `clossys run --dry` lists every step in order and what would run; it stops at the first decide
  step with open work. `clossys run` runs each stale plumb step (its last run record's inputs
  changed), skips fresh ones, stops red at a failed step and stops at the first open decide step.
  It makes no model calls. `--from <step>` and `--until <step>` bound the walk.
- When it stops at an owner decide step, the packet's `ask` names the agent whose round asks it
  (`ask.argv`) and that agent's skill (`ask.skill`): read the skill and run its Interview.
- `clossys run --explain` prints the graph: step, agent, kind (plumb, decide:creative,
  decide:judgment), decider and last run state.
- After a pin or pick, run `clossys run --dry` again: the steps that read the changed record show
  as stale, and `clossys run` re-runs them.
- Publisher's page records are judged by two Producer actions: `publisher.check` (`clossys publisher check`) runs the Publisher
  page checks (catalog, instance key, inline copy) over every page candidate and exits 1 on any
  finding; `publisher.release` (`clossys publisher release <publication>`) refuses the release while the publication's pinned
  pages fail that check, and only then runs the release step (default `--gates`).

## Run a loop

The six Producer loops run one step at a time from the loop version the consumer pins
(`clossys/agents/producer/loop.<name>/pin.json`), else the package v1. Each run writes one ledger entry
(`clossys/agents/producer/ledger.<name>/entries/<run-id>.json`).

- `clossys run loop.fill --init` once (T1), then `clossys run loop.fill` fills the next slot still on a
  package default, in chain order (Director, Designer and Writer, Publisher), until none is left or a
  run waits. `--slot <agent>/<slot-id>` fills one slot; `--from queue.fix#<id>` fills a slot added for
  that request (T4).
- `clossys run loop.refine --slot <ref>` (T3, or T7 for a `needs-refresh` dependant) or
  `--from queue.<change|fix>#<id>` (T5 owner feedback, a kind change; T6 a routed finding, a kind fix). <!-- DRAFT copy (foundry-build-0048 U8) -->
- `clossys run loop.create --slot <ref>` writes the slot's `family` of candidates through the candidates
  verb and ends only when `family.options` of them are submitted and certified (`candidates.certified`);
  `clossys run loop.choose --slot <ref>` then pins one through the pin gate (`clossys pin`, which refuses a
  hand-placed or uncertified candidate and cites the slot's ranked scorecard).
- `clossys run loop.release --publication <id>` (T8) ends only at the owner-signed ready-pin.
- While `clossys run` or `clossys next` stops at another agent's step, an agent can still work its own
  slot: `clossys run loop.fill --slot <agent>/<slot-id>`, or that agent's skill loop through the verbs.
  Submitting a candidate does not wait for upstream pins; the craft `brief` stage and the pin do, and
  each names the slot it is waiting on.
- `clossys run loop.audit` runs the strict checks and routes each finding: a `queue.fix` to the slot's
  agent, a `queue.clarify` to the owner, one open entry per subject. Its reports step then rechecks the
  open `queue.report` entries (Upstream feedback).
- `clossys run loop.cascade --slot <ref>` (T7, after `<ref>` repinned) judges again, by the one certifier,
  every pinned candidate whose pinSet changed; a failure marks its slot `needs-refresh` and is a `queue.fix`
  for that slot's owner (CHOOSE when another submitted candidate certifies, else CREATE). Release refuses
  while any slot is `needs-refresh`.
- DRAFT: `clossys run loop.scope` files every need a slot names that no slot holds. Each content agent's
  scope step raises its own `queue.slot` entries with
  `clossys request --target <agent>/<slot> --from <agent>/<slot> --why <words>`. An agent raises only from
  its own slot, never as the owner. The `clossys request --scan` step then files the rest of the demand
  diff. `--agent <agent>` runs that agent's own pinned loop.scope.
- DRAFT: `clossys run loop.slot --request <id>` answers one open `queue.slot` entry
  (`clossys request --list --open`). The assignee reuses a placed slot or proposes one new leaf. A new
  leaf waits on the owner's `queue.approve` entry, is placed through `clossys ia`, and the entry closes.
- DRAFT: decisions land in seven queues under `clossys/agents/producer/`. `queue.pick` holds a pick the
  owner confirms, and `queue.approve` an owner sign-off (a new leaf's signature among them).
  `queue.clarify` holds an owner question, `queue.fix` a finding routed to a slot's agent,
  `queue.change` a requested change to a slot, `queue.slot` a slot request, and `queue.report` tool
  feedback for Producer (see Upstream feedback).
- An agent step prints its packet (agent, verb, tier, skill under
  `packages/<agent>/actions/<action-id>/skill.md`): run that skill, then
  `clossys run loop.<name> --resume --run <run-id> --step-exit <0|1|2> --model <serving model> [--wrote <file>]...`.
  The version names only the tier; the ledger records the model that served the step.
  `--step-exit 0` means the step did its work, and the run moves on to the next step. `--step-exit 1`
  means the step ran and found a problem: the step's own failure rule runs (it raises a `queue.fix` or
  `queue.clarify` entry and the run waits on it, or tries again after a clarify), and a step with no
  such rule stops the run. `--step-exit 2` means the step could not run at all (a missing tool, input
  or permission): the run stops and its ledger entry ends `stopped`. To close a run you cannot finish,
  resume it with `--step-exit 2 --model <serving model>` and report the cause.
  DRAFT (U26): name every file the step changed with `--wrote`. The run compares the tree before and after an agent
  step of an agent loop, Producer's standard version included, and stops on an unreported change or a write the step
  does not declare.
- A human step raises its queue entry and the run waits: record the owner's chat words with
  `clossys answer <entry> <answer> --by owner --via chat --quote "<words>"`, then
  `clossys run loop.<name> --resume`. Resuming never runs a finished step again.

## Answer the open decide step

- `clossys next --json` prints the packet: the compiled brief, the slot contract, the options, the
  output path and schema, the checks, the decider (from the seat), the step's skill with its hash
  (`skill.file`, the file on disk; `skill.path`, the id `--skill` names), and the command that
  records the answer. Read `skill.file` before deciding.
- An agent candidate is recorded with `clossys next <agent>/<slot> --submit <file> --model <id>
  --tier <tier> --basis <basis> --skill <packet skill path> --rung <rung> [--seed <id>]
  [--reason <text>]`. A submission whose skill is not the contract's, whose model or tier is not
  the seat's, whose file fails its schema or the slot model, which is byte-identical to a held
  candidate, or whose selection-ladder record does not hold is refused and records nothing.
- `--rung`, `--seed` and `--reason` record the selection ladder the packet's skill states (see
  Rules).
- An agent pick (a `pick.<agent>` seat with an llm) is recorded with
  `clossys pick <agent>/<slot> <candidate file> --by agent:<agent>`; the owner confirms it with
  `clossys pin <agent>/<slot> <candidate file> --confirm --by owner:queue.<kind>#<id>` (the pick keeps
  basis `agent` and gains `confirmed`), or pins another candidate as the owner's pick with
  `clossys pin <agent>/<slot> <candidate file> --by owner:queue.<kind>#<id>` (see Who picks and pins).

## Rules

Each rule is stated once, here or in the one place named, and the named check or refusal holds it.

- **Only wiring blocks.** A step fails red only on wiring: a missing, stale or invalid input,
  record or citation, or a check that cannot run. A wording or visual finding is a report: the step
  passes and lists it under its `reports` for the owning agent. A gate's mode (`block` or `report`)
  and the reason live in the gate's own config (`@clossys/designer`); a
  broken gate fails in every mode.
- **Each step runs only its own check.** A step's contract (`actions/<id>/action.json`) names its
  inputs, outputs, command, `checks` and `pass`; `clossys run` runs a step's own command only when
  an input it read last time changed, and re-measures nothing a later step could not have changed
  (`check:step-standard`, rules `snapshot.stale` and `steps.drift`).
- **Owner questions are policy-level**: the Interview below (rules `owner.argv` and
  `owner.policy`, held by `clossys pipeline check` on the workspace and `check:step-standard` on
  Foundry; `clossys pipeline check` rule `owner.wiring`).
- **The selection ladder** is stated in each `<agent>.candidates` step skill, the skill the
  packet hands over (`check:step-standard` rule `skill.ladder`). A submission whose
  ladder record does not hold is refused, and `clossys gaps` lists a recorded one as a `ladder` gap;
  the Designer's sources are held by `check:source-ladder`.
- **Citations name slot ids; a re-pin cascades.** A candidate cites `<slot>` or `<agent>:<slot>`,
  never a version; the citation resolves through that slot's pin when it is read (compile and
  derive time). A re-pin upstream opens no downstream candidate or pick: the derive and check steps
  that take the pin as an input go stale, and `clossys run` re-derives and re-certifies downstream.
- **Requests go to the upstream owner**: the Interview's gaps below (`check:step-standard` rule
  `request.addressee`).
- **Agent work is submitted only through `clossys next --submit`** from the step's seat (Answer
  the open decide step lists what it refuses).

## Who picks and pins

This rule is the same in every Clossys skill. A pin chooses one candidate for a slot. The CLI accepts
the forms below and refuses every other one.

- **The owner picks.** The owner's answer is recorded in a queue entry first (an Interview round,
  `clossys answer`, or `clossys request <id> --answer`). The pin then names that entry:
  `clossys pin <agent>/<slot> <candidate file> --by owner:queue.<kind>#<id>`. Add `--basis bulk` when
  the owner approved a whole group at once. A bare `--by owner` is refused.
- **The planner pins.** `clossys pin <agent>/<slot> <candidate file> --by planner:<ref>`, where
  `<ref>` says where the planner's decision is written down.
- **The agent picks and the owner confirms.** The slot's own agent picks with
  `clossys pick <agent>/<slot> <candidate file> --by agent:<agent>`, or with a pick verdict
  (`clossys verdict`). An agent picks only on its own agent's slots, and never over an owner's pick.
  The owner confirms it later with
  `clossys pin <agent>/<slot> <candidate file> --confirm --by owner:queue.<kind>#<id>`.

`<candidate file>` is the candidate's file name with its extension, such as `hero-v2.json` or
`meta-v1.md`. A slot can be pinned only after every slot it reads is pinned. The loops can also pin
by code (`--by code:scorecard`) on a slot with no owner step; you never type that form. Never write
`pin.json` by hand.

What counts as done: in `clossys status`, a slot the owner picked shows as `pinned`. A planner, bulk,
agent or code pin shows as `confirm`: the slot is filled, and the owner can still confirm or change
it. A slot shown as `sample` (still on the package default), `unresolved`, `failing` or
`needsRefresh` is not done.

## Interview

This is the Interview contract. Every agent skill (Producer, Director, Designer, Writer, Publisher)
cites it and runs it for its own agent id; `<id>` below is that id, `producer` here.

- **When to run it**: at session start; after every pin, pick, approve or seat answer; when
  `clossys run` stops at an owner decide step; when a downstream agent reports a need.
- **Gaps first**: `clossys gaps --agent <id> --json` lists what keeps the agent from done, in three
  kinds. Coverage: open decide items, slots with no candidates or no pin, failing checks, a missing
  seat policy. Wiring: pinned slots citing an input whose pin no longer clears, steps with no
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
  each in order, filling its `fill` words. A `fill` word that asks for the owner's words (an answer
  file, a quote, a reason) is the owner's to give, never written for them: that question stays open
  and the run stops there. `<model:tier>` words come from
  `clossys/seat-policy.json`, written by `clossys seat --policy --model <tier>=<id>` (or
  `--human-only`); while it is missing its question is asked first. Never guess a model id; never
  edit a record by hand.
- **Work-entry answers (DRAFT)**: a `clossys.queue-entry/2` change or fix entry that awaits the owner
  is answered with `clossys request <id> --answer <option> --via cli|chat|app --quote "<the owner's
  words, verbatim>"`. The answer is one of the entry's options, never free text; `--via` and a
  non-empty `--quote` of the owner's own words are required, and an answer without them writes
  nothing. The answer runs that option's step (pin, close, handoff or keep open) through the normal
  verbs and gates. A step that fails leaves the entry open with a rejected event that names the
  refusing check, and for a change routes a fix on its target; never re-run the step by hand.
- **Cascade**: run `clossys run` after each round, so the steps that read a changed record re-run
  and the next decide step opens.
- **Stop at 0 gaps**: repeat gaps, rounds, verbs and `clossys run` until
  `clossys gaps --agent <id>` reports 0 gaps (held gaps, such as a human-only seat, stay listed by
  rule and count as held).

For this skill: `clossys gaps --agent producer --json`, then
`clossys next --owner --agent producer --json`.
