# Choose a library fill

This companion reserves the choice procedure. The complete choose-and-fill
workflow is pending the shipped chooser and its direction contract.
`designer-library recommend --root library` currently reports unavailable
(exit 2); it does not write a recommendation or change the library. Stop and
report that missing capability when asked to use the chooser.

The chooser never authors values. Consumer-supplied authored values, registered
derivation rules and adopted fills must retain their provenance. Preserve the
rationale, runner-up and human overrides when a choice can be reviewed. A
chooser ChangeSet belongs in the Studio basket and must never be auto-saved.
Run `designer-library apply --root library --changeset changeset.json` only
when the human explicitly instructs it in this session; a request for advice
or a chooser recommendation is not that instruction.
