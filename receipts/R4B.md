# Receipt: R4B (exec, high, gate-class)

- Serving model: Claude Opus 5.5 (`claude-opus-5-5`), local, session 1d9842e0, agent r4b-exec.
- Branch `claude/r2f-0048-r4b`, wt lease `slot-1`. Base `claude/r2f-int2` at 87c8b461c4c3dde559fec2cb4c7b03e476e202ee.
- Validated head: 2b348040fee1fb428dad69ae4a0657daf2bff893. The commit after it adds only this receipt.
- Diff against base: 2 files, +36/-3.
  - `packages/producer/src/conform/assertions.ts`: +5/-2. The one code change is that `KIND_CERTIFIER` gains `publication: "page"`, next to `release: "release"`. The other lines are the doc comment.
  - `packages/producer/src/conform/assertions.test.ts`: +31/-1. It adds one describe block, `K3 counts the existing certifier of every held kind (R4B)`, with 3 cases.
- No other check, rule, scanner, allowlist, baseline, ceiling, certifier, fixture, version or changelog changed.
- `DECIDED D1`: enforced code wins. `certify/publication.ts` does not exist. `certifyPublication` lives in `certify/page.ts`, and the certifier index dispatches a publication to it. So the entry names `page`, the certifier file conform's `readMachinery` detects.
- `DECIDED D2`: nothing was loosened. K3 still goes red for any held kind with no certifier, and the new test pins that.

## Validation (exit codes)
1. `npm run typecheck -w @clossys/producer`: **0**.
2. `npm exec -w @clossys/producer -- vitest run src/conform src/constitution`
   - Head: **1**, 15 failed / 740 passed / 3 skipped (44 files).
   - Base (base `assertions.ts` and `assertions.test.ts`, same tree): **1**, 15 failed / 737 passed / 3 skipped.
   - The sorted `FAIL` lists are identical (`diff` empty), so there is no new named failure. The 3 extra passes at head are the new cases.
   - The 15 failures predate this unit and match R4's list: conform U37 CASCADE x1, director-fixtures x2, choose-gate x4, guard-session x1, pin-gate x7.
3. `node packages/producer/dist/cli/index.js conform --all --json`: base **1**, head **1**.
   - Both runs have the same 172 cells.
   - Exactly one cell changed colour. Publisher K3 went **red to green**: base rows `["publication: no certifier"]` (evidence 5), head rows `[]` (evidence 5).
   - **No cell went green to red.**
   - Red cells per agent, base to head: director 4 to 4, designer 6 to 6, writer 3 to 3, publisher 7 to 6, producer 3 to 3.
4. `git merge-tree --write-tree claude/r2f-int2 HEAD`: **0** (tree b7b461f6f).
5. Builds went through `wt run --kind build` and were package-scoped. At base, director, advisor, controller, writer, designer, publisher and producer each exited 0. Producer at head exited 0.

## Mutation proof
- Scratch copy: `mktemp -d $TMPDIR/mut.XXXXXX`. In it, the head `assertions.ts` had `publication: "page"` removed with `sed`. `diff` shows only line 43 changed.
- With the mutant in place, `vitest run src/conform/assertions.test.ts` exited **1**: 3 failed / 10 passed. All 3 new cases failed:
  - mapping case: `expected { release: 'release' } to deeply equal { release: 'release', …(1) }`;
  - Publisher kinds case: expected `{ rows: [], evidence: 5 }`, got a `publication: no certifier` row;
  - unknown kind case: got `[ 'publication: no certifier', … ]` instead of `[ 'invented: no certifier' ]`.
- Restore: the head files were copied back from the `mktemp -d` head copy.
  - `cmp` for `assertions.ts` and `assertions.test.ts` both exited 0.
  - `git status` then showed only the two intended files, and they are committed at the head.
- Unmutated, the same file exited 0: 13/13 passed.

DONE: 2b348040fee1fb428dad69ae4a0657daf2bff893
