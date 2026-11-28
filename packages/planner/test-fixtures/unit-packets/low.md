# EX-LOW: fix the owned-rules summary count (low)

An accepted example: one behaviour, one file, a named failing test, so low.

## Repository and base
- Repository: clossys/foundry. Branch: `claude/ex-low`.

## Objective
- Count only listed rules in the summary of `packages/planner/src/owned-rules.ts`.

## Validation
- "summary counts listed rules" fails before the fix and passes after it.
