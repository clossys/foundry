# writer.candidates

Create Writer candidates for the open L3 slots: one immutable file per option.

- Read the slot contract and the pinned upstream inputs; a candidate that cannot cite them is not made.
- Offer distinct options (slot.json options); two candidates that differ only cosmetically are one.
- Never edit or delete a candidate; a better option is a new file.
- The craft and commands are in the package skill (skill/SKILL.md); `clossys check` must pass.

## Selection ladder

Adopt a seed before you create one (owner, 2026-11-11). Climb the rungs in order and stop at the first that fits:

1. **adopt**: a seed fits as it is, taken verbatim: stock shadcn, a trusted free registry item, an existing
   candidate or a template.
2. **adapt**: no seed fits as it is, so adapt the closest one.
3. **create**: no seed can be adapted, so write a new candidate and say why no seed fit.

Record the rung on submission: `clossys next writer/<slot> --submit <file> ... --rung <adopt|adapt|create>
--seed <the seed's id> [--reason <why no seed fit>]`. An adopt or adapt names its seed; a create
without `--reason` is refused, and `clossys gaps` lists any recorded one as a ladder gap.

## Requests

DRAFT, for owner approval (foundry-build-0048 U7): this wording is not approved yet.

- A kind change or fix entry about a Writer slot reaches this skill through Producer's routing table (loop.create is its handler). List yours with `clossys request --list --open --agent writer` and read one with `clossys request <id> --json`.
- A change says what it wants (`want`: repin, candidate or contract); a fix carries its failing `check`, `findings` and `cause`. Do the work on the Writer's own slot only, by the steps above.
- When you need something of another agent's slot, raise a request (`clossys request --kind change --subject <agent>/<slot> --from writer/<slot> ...`, or a slot need); it is refused unless your conform.json declares that issuing edge. Never edit the other agent's slot.
- Close with `clossys request <id> --close --outcome changed|declined --result <ref> --by writer` for a change, `--outcome fixed --by writer` for a fix: only the assignee closes, and `--by` is never defaulted. A fix closes `declined` (or with a check Producer cannot re-run) only on the owner's answer: `--by owner:queue.fix#<id>`, the answered entry citing it; bare `owner` is refused. Code re-runs the requester's check first, and for a fix closed `fixed` its own check too: a pass closes the entry and notifies `from`; a fail records `rejected` and the entry stays open with you.
