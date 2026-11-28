# CP1-REVIEWQUEUE fold-merge report (int2 + factory0 into reviewqueue)

Status: BLOCKED. No merge was made and the unit branch was not pushed. It stays at 613f4697a03ca533b593402cfa60f6ef167657b6.

## Pins checked
- claude/r2f-0048-cp1-reviewqueue: the launch pin is 7ce2befe34. The origin tip is 613f4697a0, two commits ahead of the pin (1b9747a91, 613f4697a). The pin is an ancestor of the tip, so the branch is fine.
- claude/r2f-0048-cp1-factory0: the launch pin is 009240d002. The origin tip matches it.
- claude/r2f-int2: the launch pin is e8deb2e739. **No object has this id anywhere in the repository.** The origin tip is 25fe2a0e6 ("Fold CP1-CHECKS 2feb7b9803 into claude/r2f-int2").

## Commands (exit codes)
- `git remote get-url origin` -> 0 (names clossys/foundry)
- `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-reviewqueue claude/r2f-0048-cp1-factory0` -> 0
- `git checkout -B claude/r2f-0048-cp1-reviewqueue origin/claude/r2f-0048-cp1-reviewqueue` -> 0
- `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-reviewqueue` -> 0 (Everything up-to-date)
- `node -v` -> v22.23.5; `npm -v` -> 10.9.9
- `git fetch --unshallow origin` -> 0
- `git cat-file -t e8deb2e739` -> 128 (fatal: Not a valid object name)
- `git rev-list --all | grep ^e8deb2` -> no match
- `git fetch origin e8deb2e739` -> fatal: couldn't find remote ref e8deb2e739
- `git merge-base origin/claude/r2f-int2 009240d0` -> 67bb25580 (factory0 forks from int2 at the CP1-AGENTDEF fold)
- `npm ci` -> 0 (21.5 s)

## Files touched
None on the unit branch. This REPORT.md is the only file on the report branch.

## Related tests
Not run, because no merge happened. The new-red and base-red lists are empty and were not measured.

## Timings
- Preflight plus pin checks: about 2 min. `npm ci` took 21.5 s.

BLOCKED: the int2 pin e8deb2e739 cannot be resolved. It is not on origin under any ref and a direct fetch of the id fails. The only int2 available is the moving tip 25fe2a0e6, which may include folds (for example CP1-CHECKS 2feb7b9803, CP1-HELP c8bed8adaf) that were not cleared for this merge. Merging that tip would mean guessing which int2 state was cleared. Options: (1) re-launch with the full 40-character int2 sha that was cleared; (2) confirm that int2 tip 25fe2a0e6 is the intended base and re-launch against it.
model: claude-opus-5-5
