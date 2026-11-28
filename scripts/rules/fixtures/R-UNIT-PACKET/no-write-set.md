# FIX-SCHEMA: reword the status probe's summary line (mid, gate: no)

The violation: the Repository and base section has no Write set, so the unit's scope is judged only by reviewers.

## Why
- The status probe's summary line names the wrong command.

## Repository and base
- Repository: clossys/foundry (public). Base: `claude/r2f-int2`. Branch: `claude/fix-schema`.
- Depends on: none.
- Env: cloud.
- Tier: mid.

## Objective
- Reword the summary line in `packages/planner/src/owned-rules.ts`.
- Update the matching README sentence in `packages/planner/README.md`.

## Validation
- `npm run typecheck -w @clossys/planner` exits 0.

## Forbidden
- Weakening or skipping any existing check.

## Stop rule
- BLOCKED after the same error twice, and at once on a permission refusal.

## Output
- The unit branch and its `-report` branch pushed. The last line of the report is DONE or BLOCKED.

## After the fold
- Nothing further.
