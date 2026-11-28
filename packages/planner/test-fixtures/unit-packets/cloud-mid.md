# EX-CLOUD: reword the status probe's summary line (mid)

An accepted example: self-contained, so cloud by default; two behaviours, so mid.

## Repository and base
- Repository: clossys/foundry. Base: `claude/r2f-int2`. Branch: `claude/ex-cloud`.
- Env: cloud.

## Objective
- Reword the summary line in `packages/planner/src/owned-rules.ts`.
- Update the matching README sentence in `packages/planner/README.md`.

## Validation
- `npm run typecheck -w @clossys/planner` exits 0.
