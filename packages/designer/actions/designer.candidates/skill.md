# designer.candidates

Create Designer candidates for the open L3 slots: one immutable file per option.

- Read the slot contract and the pinned upstream inputs; a candidate that cannot cite them is not made.
- Offer distinct options (slot.json options); two candidates that differ only cosmetically are one.
- Never edit or delete a candidate; a better option is a new file.
- The craft and commands are in the package skill (skill/SKILL.md); `clossys check` must pass.

## Selection ladder

Select before you create (owner, 2026-11-11), on the Designer's source ladder (check:source-ladder).
Climb the rungs in order and stop at the first that fits:

1. **L1** stock shadcn (React Aria base): select the stock item.
2. **L2** the most popular shadcn-compatible partner registry part (MIT, Apache-2.0, BSD or ISC): select it.
3. **L3** question the slot: merge, delete or compose stock; adapt the closest seed.
4. **L4** a Foundry part, last: create it, with the reason no seed fit.

Record the rung on submission: `clossys next designer/<slot> --submit <file> ... --rung <L1|L2|L3|L4>
--seed <shadcn@aria/<item> or the partner id> [--reason <why no seed fit>]`. L1 to L3 name their
seed; L4 without `--reason` is refused, and `clossys gaps` lists any recorded one as a ladder gap.

## Requests

DRAFT, for owner approval (foundry-build-0048 U7): this wording is not approved yet.

- A kind change or fix entry about a Designer slot reaches this skill through Producer's routing table (loop.create is its handler). List yours with `clossys request --list --open --agent designer` and read one with `clossys request <id> --json`.
- A change says what it wants (`want`: repin, candidate or contract); a fix carries its failing `check`, `findings` and `cause`. Do the work on the Designer's own slot only, by the steps above.
- When you need something of another agent's slot, raise a request (`clossys request --kind change --subject <agent>/<slot> --from designer/<slot> ...`, or a slot need); it is refused unless your conform.json declares that issuing edge. Never edit the other agent's slot.
- Close with `clossys request <id> --close --outcome changed|fixed|declined --result <ref>`. Code re-runs the requester's check first: a pass closes the entry and notifies `from`; a fail records `rejected` and the entry stays open with you.
