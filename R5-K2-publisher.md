# Receipt: R5-K2-publisher

Serving model: claude-opus-5-5 (session_context.model and last_served_model)
Base: 5a2e197ea · Unit head: b8489f05d77fa813d2d08e43e105906622ffa431 · Branch: claude/r2f-0048-r5-k2-publisher

## Root cause
The five live release slots (release.site, release.docs, release.app, release.admin, release.slides) had no
package default, and their slot records in `packages/publisher/src/catalog/ia/release.json` named no standard,
so K2 could not find a seed or a createOnly reason (K1 also reported "names no standard" for them).

## Change (packages/publisher data and tests only)
- `src/catalog/ia/release.json`: each of the 5 release slots names `"standard": "release"` (matching what
  `clossys ia --standard release` writes for these slots, per producer `ia-release-slot.test.ts`).
- `standards/release/requirements.json`: `createOnly: true` plus a one-sentence `createOnlyReason`. Written with
  `clossys standard publisher/release --by planner --requirements <file>`, which appended one ledger event to
  `standards/release/ledger.json`. A temporary `clossys/clossys.config.ts` consumer root was created for the verb
  and removed afterwards; it was never committed.
- New test `src/catalog/ia/release-standard.test.ts`.

## Cells (node packages/producer/dist/cli/index.js conform --all --json)
| | before (5a2e197ea) | after (b8489f05d) |
|---|---|---|
| exit | 1 | 1 (other cells still red) |
| publisher K2 | red, 5 rows (release.site/docs/app/admin/slides: no package default, no seed, no createOnly reason) | green, 0 rows (evidence 60) |
| publisher K1 | red, 62 rows | red, 57 rows (the 5 "names no standard" rows are gone) |
| every other cell, all agents | — | identical red flag and rows; no green cell turned red |

## Commands and exit codes
- git fetch origin claude/r2f-int2; git checkout -b claude/r2f-0048-r5-k2-publisher 5a2e197ea: 0
- npm ci: 0
- npm run build -w @clossys/{advisor,controller,director,designer,writer,publisher,producer}: 0 each
- conform --all --json (before): 1
- clossys standard publisher/release --by planner ... --dry: 0 (valid); without --dry: 0
- conform --all --json (after): 1; publisher K2 green
- npx vitest run src/catalog/ia/release-standard.test.ts src/catalog/counts.test.ts (publisher): 0 (30 passed)
- npm run typecheck (publisher): 0
- node scripts/check-public-safety.mjs . : 0 (PARTIAL; no denylist in a cloud session, so not a FULL clearance)
- git merge-tree --write-tree origin/claude/r2f-int2 HEAD: 0
- git push origin claude/r2f-0048-r5-k2-publisher: 0
- Full publisher vitest suite and producer src/conform + standards + ia-release-slot tests: still running when the
  gate was started. The publisher full suite already showed failures in web/UI files that this change does not
  touch (reason-keys.test.tsx, layout-purity.test.tsx, core/instance-body.test.ts, elevation-panel tests). Whether
  they also fail at base was not yet confirmed. The gate runs producer `vitest run src/conform` itself.

## Mutation proof
- Revert release.json to base: release-standard.test.ts exit 1 ("release.site: expected undefined to be 'release'").
- Revert requirements.json to base: exit 1 ("the release standard is createOnly with a reason and no seeds").
- Both restored: exit 0 (2 passed).
