# Git CMS clean-up and hardening (R-GIT-CMS)

Base `383f032c2`, head on `claude/gitcms-harden`. Rule R-GIT-CMS
(owner words 2026-11-03: "ok clean up and harden").

## Checks, base vs head

| Check | Base | Head |
|---|---|---|
| `npm run check:git-cms` (script run on the base tree) | exit 1: 445 findings; red designer, director, producer, publisher, strategist, writer | exit 1: 2 findings; green designer, director, publisher, writer; red producer (listed) |
| `npm run check:decisions` | exit 0: 440 pinned, 40 not-needed, 0 open | exit 0: 440 pinned, 40 not-needed, 0 open |
| `npm run check:generated-derived` | exit 0 | exit 0 |
| `check:assemble-only` (packages/producer) | exit 0 | exit 0 |
| `npm run check:rules` | exit 1: 20 rules, 10 enforced, 16 findings | exit 1: 21 rules, 11 enforced, 16 findings (same 10 failing rules; R-GIT-CMS enforced) |
| pin CLI tests (`vitest run src/cli/pin.test.ts`) | exit 1: 11 of 13 failed (fixture had no `clossys/clossys.config.ts`) | exit 0: 16 of 16 passed |
| `npm run check:pipeline` | not run | exit 0 (graph regenerated for the moved evidence globs) |
| `npm run check:strategist-subject` | not run | exit 0 |
| producer build (`wt run --kind build -- npm run build`) | exit 0 | exit 0 |
| studio build (`wt run --kind build -- node scripts/build-studio.mjs`) | exit 0 | exit 0 |

Base check:git-cms findings: 440 `pin-attribution` (no basis), stray `director/_evidence`,
stray `strategist/findings`, `missing-ia` for strategist and producer, and stray `producer/pin`.

Head check:git-cms findings, both producer: `missing-ia producer/ia.json` and
`stray-entry producer/pin`. Producer is not in the slot layout. It is not exempt, so the root
`check` chain stops at `check:git-cms` until producer is converted.

## Mutation proof

Deleting `clossys/agents/designer/components.flow.node-status/candidates/node-status-v1.json`
makes check:git-cms report `no-candidates` and `pin-candidate` for that slot (exit 1, 4 findings).
Restoring the file brings it back to the 2 producer findings.

## Pin basis backfill

`packages/producer/scripts/backfill-pin-basis.mjs` wrote every pin's `basis` through `clossys pin`.
Candidate, sha256, decidedBy and at are unchanged.

| Pins | decidedBy | Rule | Basis |
|---|---|---|---|
| 301 | owner:2026-11-03 pin-if-agree | pin-if-agree | bulk |
| 38 | owner:2026-11-03 planner-pin COMPONENT-FIXTURES | planner-pin | planner |
| 34 | owner:2026-11-03 planner pins that pass the gate (SECTION-REPICK) | planner pins | planner |
| 20 | owner:2026-11-03 W2-COPY-THROUGH-WRITER go | `<UNIT>` go | bulk |
| 9 | planner:CONVERGE-R2 | planner:`<unit>` | planner |
| 7 | planner:PIPELINE-CANVAS | planner:`<unit>` | planner |
| 6 | owner:2026-11-03 one-brand clossys asterisk | owner names the choice | picked |
| 5 | planner:CANVAS-PARTS | planner:`<unit>` | planner |
| 4 | owner:2026-11-03 GEN-DERIVED go | `<UNIT>` go | bulk |
| 4 | owner:2026-11-03 planner pins that pass the gate (COMPOSE-SLOTS) | planner pins | planner |
| 4 | owner:2026-11-03 planner-pin SPECIMEN-THEME | planner-pin | planner |
| 2 | owner:2026-11-03 fix-all | ambiguous | bulk |
| 2 | owner:2026-11-03 planner pins that pass the gate (SECTION-DEPS) | planner pins | planner |
| 1 | owner:2026-11-03 planner pins that pass the gate (INTEGRATE-SPECIMENS) | planner pins | planner |
| 1 | owner:2026-11-03 planner pins that pass the gate (SECTION-SPECIMENS) | planner pins | planner |
| 1 | owner:2026-11-03 planner pins that pass the strict composition gate (W6-COMPOSITION-LINEAGE) | planner pins | planner |
| 1 | owner:2026-11-03 STUDIO-TEMPLATE-FIX go | `<UNIT>` go | bulk |

Totals: 440 pins. picked 6, bulk 328, planner 106.

After the backfill, `writer/strings.statuses` was re-pinned to `studio-v7` (the same strings as
v6 plus the `studio.confirm` key), with `--by planner:G15-GITCMS-HARDEN`, so its basis is planner.
At head the counts are picked 6, bulk 327, planner 107.
