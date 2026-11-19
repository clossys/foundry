# writer.cascade

Read the impact of one repin of a Writer slot (loop.cascade, the impact step): Producer's reverdict step has judged every dependant of the slot on the pinSet now; you read the result and note it.

DRAFT, for owner approval (foundry-build-0048 U26): this wording is not approved yet.

- Read the slot first: `clossys slot writer/<slot> --json` (its pin, who consumes it, open queue items).
- Read the re-verdicts the reverdict step wrote under `.clossys/checks/` for each dependant it names.
- Write one short note to `.clossys/checks/writer/<slot>/scratch/impact.md`: what the repin changed and which dependants it reached. That note is the step's only write.
- Never pin, unpin or answer a queue entry here, and never edit a dependant or another agent's tree: a failing dependant already went to its owner as a queue.fix.
- If the repin needs work in one of your own slots, raise it through loop.slot or loop.create; this step only reads and notes.
