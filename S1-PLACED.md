# S1-PLACED receipt

- Serving model: Claude Opus 5.5, id `claude-opus-5-5` (session_context.model and last_served_model).
- Base: `5a2e197ea` (claude/r2f-int2). Head: `2b96b4cd2` on `claude/r2f-0048-s1-placed`.
- Diff: 2 files, +81 / -5
  - `packages/producer/src/conform/assertions.ts` (+18 / -5, ASSERTIONS.S1 only, plus 3 imports)
  - `packages/producer/src/conform/assertions.test.ts` (new, +63)

## Change
For an agent `ia sync` scopes (`scopedToConsumed`: designer, writer), S1's expected set is now
`consumedIds(consumedLeaves(dirname(model.consumer)), agent)` plus the Producer-contributed slots
(`studioDesignerSlots()` ids, designer only). Both functions are imported, not re-implemented. For every other
agent (director, publisher), the expected set is still the whole package tree.
Red rows: `<id>: sync places it, not placed` and `<id>: placed, neither a package leaf nor a Producer slot`.
A placed package leaf outside the expected set is allowed and produces no row. When there are red rows, the first
one is the summary `sync places <n> leaves, the placed tree has <m> of them`. `evidence` is the size of the expected
set. An empty expected set is red: `nothing to judge: sync places no leaves`.

## Validation (exit codes)
| command | exit |
|---|---|
| `npm run typecheck -w @clossys/producer` | 0 |
| `npm exec -w @clossys/producer -- vitest run src/conform/assertions.test.ts` | 0 (6/6 passed) |
| `npm exec -w @clossys/producer -- vitest run src/conform` | 1: base red only (see below) |
| spec S1 measurement (`conform --all --json` piped to the designer S1 node filter) | 0 |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 |
| `npm run agent:cloud:bootstrap` / `npm run agent:cloud:check` | 0 / 0 |

`vitest run src/conform`:
- Base: 1 failed, 159 passed, 7 files.
- Head: 1 failed, 165 passed, 8 files (the 6 new tests pass).
- The one failure is the same on both: `conform.test.ts > dogfood probes > upstream-pinned on a model read from disk ... (U37)`. It is a base red I did not cause, so I named it here and did not fix it. No new named failure.

Measurement output at head:
```
director GREEN
designer GREEN
writer GREEN
publisher RED sync places 60 leaves, the placed tree has 0 of them | layout.marketing-home: sync places it, not placed
```
`conform --all --json` itself still exits 1, because other cells are red.

## Mutation proof
In the working tree, I replaced the expected-set ternary with `const expected = new Set(pkg);` (the whole package
tree again). The Producer build exited 0. The spec S1 command then **exited 1**:
```
director GREEN
designer RED sync places 252 leaves, the placed tree has 206 of them | assets.icon-business: sync places it, not placed
writer RED sync places 106 leaves, the placed tree has 105 of them | components.media-player.copy: sync places it, not placed
publisher RED sync places 60 leaves, the placed tree has 0 of them | layout.marketing-home: sync places it, not placed
```
I restored the file from a copy taken before the mutation. `cmp packages/producer/src/conform/assertions.ts <pre-mutation copy>`
exited 0. After a rebuild, the command exited 0 again (output as at head above).
Note: an earlier mutation attempt used `false && ...`. tsc rejected it (a type error, build exit 2), and I discarded it.
A second attempt cleared the shared `pkg` set in place, which also emptied the unscoped agents' set, so I discarded it too.
The clean replacement above is the proof.

## S1 per agent, before and after (fixture consumer, `conform --all`)
| agent | base | head |
|---|---|---|
| director | GREEN (evidence 55) | GREEN |
| designer | RED: 53 rows (46 unconsumed package leaves not placed, 6 Studio slots "placed, not in the package tree", summary) | GREEN |
| writer | RED: `components.media-player.copy: in the package tree, not placed` | GREEN (sync does not place that unconsumed leaf) |
| publisher | RED: package tree 60, placed 0 | RED (unchanged: sync does not scope Publisher, so the expected set is still the whole tree) |

advisor, controller and producer have no S1 cell in the report. Every S1 that was green at base is still green.
Designer S1 is green on `packages/producer/test-fixtures/consumer`. I made no change to the fixture.

## Studio slots: all six kept (each has readers)
Readers found with `git grep -l -F <id> -- packages`, leaving out `studio-defaults/designer-slots.json`:
- `themes.success`: Studio page `studio/app/designer/themes/colors/[slug]/page.tsx`; fixtures `test-fixtures/consumer{,-legacy-tree}/clossys/agents/designer/{ia.json,themes.success/slot.json}`; `src/migrate/recut.test.ts`; `packages/designer/scripts/check-source-ladder.test.mjs`; `studio/generated/studio-map.json`.
- `themes.warning`: the same Studio colors page; both fixture consumers (ia.json and slot.json); `studio/generated/studio-map.json`.
- `themes.info`: the same Studio colors page; both fixture consumers (ia.json and slot.json); `studio/generated/studio-map.json`.
- `sections.producer.team-strip`: Studio section `studio/sections/producer-team-strip/index.tsx` and page `studio/app/designer/sections/producer/[slug]/page.tsx`; shipped Publisher archetypes `packages/publisher/src/archetypes/archetypes.ts` (plus its conformance.test.ts); `src/studio-defaults/writer-declarations.json`; `studio/lib/home-inputs.test.ts`; `scripts/generate-studio-map.test.mjs`; `src/migrate/recut-one-model.test.ts`; both fixture consumers.
- `sections.producer.system-empty`: Studio section `studio/sections/producer-system-empty/index.tsx` and the sections page; Publisher `src/archetypes/archetypes.ts` and `extensions.ts` (plus conformance.test.ts); `src/studio-defaults/writer-declarations.json`; both fixture consumers.
- `components.studio.specimen-document`: Studio page `studio/app/designer/components/studio/[slug]/page.tsx`; `src/specimen/installed-specimens.ts`; both fixture consumers.

`studio-defaults/designer-slots.json` is unchanged.

## Notes
- Builds were package-scoped, in the order advisor, controller, director, designer, writer, publisher, producer. All exited 0.
- Publisher's `check:client-boundary` post-build step (`scripts/check-client-boundary.mjs`) hung idle for more than 10 minutes. A standalone rerun with a 180 s timeout also hung (exit 124). Publisher's tsc output was already complete, and I stopped the hung step. It is a base build check that this change does not touch. I did not investigate or fix it.
- Nothing else changed: no other assertion, scanner, allowlist, baseline or ceiling; no fixture, version, changelog, release-catalog or retired-leaves edit; no `receipts/` on the branch.

tier-outcome: high, done
DONE: 2b96b4cd2ea491af9707b6b0bae334aa15f59629
