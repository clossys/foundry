# publisher.candidates

Create Publisher candidates for the open L3 slots: one immutable file per option.

- Read the slot contract and the pinned upstream inputs; a candidate that cannot cite them is not made.
- Offer distinct options (slot.json options); two candidates that differ only cosmetically are one.
- Never edit or delete a candidate; a better option is a new file.
- The craft and commands are in the package skill (skill/SKILL.md); `clossys check` must pass.
