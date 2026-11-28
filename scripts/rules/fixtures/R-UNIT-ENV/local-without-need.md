# FIX-ENV: reword one status line (mid)

The violation: this packet says local, but nothing in it needs a local machine.

## Repository and base
- Repository: clossys/foundry. Branch: `claude/fix-env`.
- Env: local (it is faster on the planner's machine)

## Objective
- Reword the summary line in `packages/planner/src/owned-rules.ts`.
- Update the matching README sentence in `packages/planner/README.md`.

## Validation
- `npm run typecheck -w @clossys/planner` exits 0.
