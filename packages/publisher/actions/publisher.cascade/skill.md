# publisher.cascade

Read the impact of one repin of a Publisher slot (loop.cascade, the impact step): Producer's reverdict step has judged every dependant of the slot on the pinSet now; you read the result and note it.

DRAFT, for owner approval (foundry-build-0048 U26): this wording is not approved yet.

- Read the slot first: `clossys slot publisher/<slot> --json` (its pin, who consumes it, open queue items).
- Read the re-verdicts the reverdict step wrote under `clossys/.state/checks/` for each dependant it names.
- Write one short note to `clossys/.state/checks/publisher/<slot>/scratch/impact.md`: what the repin changed and which dependants it reached. That note is the step's only write.
- Never pin, unpin or answer a queue entry here, and never edit a dependant or another agent's tree. Code accepts a clean cascade before this step (the accept step: the reverdict passed and cascade.clean holds now), so it reaches you only when code could not accept it; a failing re-verdict stops the run before it (Producer sends that dependant to its owner as a queue.fix, then loop.choose), so there is no failure to route here.
- The run refuses any other write, reported or not: the note is all this step may change.
- If the repin needs work in one of your own slots, raise it through loop.slot or loop.create; this step only reads and notes.
