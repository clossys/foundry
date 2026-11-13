# writer.candidates

Create Writer candidates for the open L3 slots: one immutable file per option.

- Read the slot contract and the pinned upstream inputs; a candidate that cannot cite them is not made.
- Offer distinct options (slot.json options); two candidates that differ only cosmetically are one.
- Never edit or delete a candidate; a better option is a new file.
- The craft and commands are in the package skill (skill/SKILL.md); `clossys check` must pass.

## Selection ladder

Select before you create (owner, 2026-11-11). Climb the rungs in order and stop at the first that fits:

1. **select**: a seed fits as it is: stock shadcn, a trusted free registry item, an existing
   candidate or a template.
2. **adapt**: no seed fits as it is, so adapt the closest one.
3. **create**: no seed can be adapted, so write a new candidate and say why no seed fit.

Record the rung on submission: `clossys next writer/<slot> --submit <file> ... --rung <select|adapt|create>
--seed <the seed's id> [--reason <why no seed fit>]`. A select or adapt names its seed; a create
without `--reason` is refused, and `clossys gaps` lists any recorded one as a ladder gap.
