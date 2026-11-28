# Sample packet (check:heal guard sample)

A well-formed validation section: each command states exactly one expectation, and the root
check is judged against the base in the same environment.

## Validation
- `npm run typecheck -w @clossys/controller`, exit 0.
- `npm run check`: same exit as base, measured in the same environment.
- `git merge-tree --write-tree claude/r2f-int2 HEAD` exits 0.
