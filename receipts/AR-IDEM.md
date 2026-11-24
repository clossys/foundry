# AR-IDEM receipt

- Unit: AR-IDEM (high, non-gate). Model: Claude Opus 5.5 (`claude-opus-5-5`), as served to this executor session.
- Base: `claude/r2f-0048-answer-replay` at c4b2c9df481b9ca6180916f372f278351c223fd4. Branch: `claude/r2f-0048-ar-idem`.
- Fix commit: 24e9d15e9dd9b436b9e4016600edd3790cd97e9c. The commit after it adds this receipt only.
- Diff against base (code): 2 files, +63/-5. `packages/producer/src/queue/replay.ts` +14/-4, `packages/producer/src/queue/replay.test.ts` +49/-1.

## Change
- `pinRecorded` (replay path only) now also counts a pick's follow-up pin as applied when the slot's `ledger.json` holds an
  event with `op: "pin"`, `decidedBy` equal to the answer's `--by`, and the same candidate and record. The pin.json check stays.
  The pin verb is unchanged. A ledger that cannot be read counts as not applied, so the pin verb runs and reports it.
- The ledger can tell which answer a pin event came from: every pin event records `decidedBy: owner:queue.pick#<entry id>`.
  So BLOCKED-D5 does not apply.
- The module header now describes the ledger rule.

## Validation
| Command | Exit |
|---|---|
| `npm run typecheck -w @clossys/producer` | 0 |
| `npm exec -w @clossys/producer -- vitest run src/cli src/queue src/conform` | 1, base-red: 27 failed / 740 passed / 8 skipped |
| `npm exec -- vitest run src/queue/replay.test.ts` (in packages/producer) | 0, 3/3 |
| `git merge-tree --write-tree claude/r2f-int2 HEAD` (int2 c50deaf7b) | 0, no conflicts |
| `wt run --kind build -- npm run build -w @clossys/producer` (after the change) | 0 |

Subset against base: 27 head failures and 27 recorded base reds (mech record for ANSWER-REPLAY, base a50a6cb78). The sets
differ by two names on each side:
- Base only: `repeatability.e2e.test.ts` and `write.test.ts`, both `<suite load or start error>` at base. They load and pass here.
- Head only: two 5000 ms timeouts under machine load (load average about 8).
  - `cli.test.ts > clossys bin > --check leaves file lists, hashes and mtimes unchanged when inputs are missing` passed
    24/24 when re-run alone (exit 0).
  - `craft-recipe.e2e.test.ts > ... refuses at next --stage a diverge naming create.element ...` passed when re-run
    alone with `cli.test.ts`.
  Neither imports the replay module.
- No new named failure is caused by this diff.

## Two-pick test
`replay.test.ts > re-runs write nothing when a later owner pick re-pinned the slot an earlier pick pinned`:
- On the original consumer, two owner picks on `writer/sections.hero.copy#copy` (copy-v2, then copy-v3) run, each with its
  printed pin. Then it exports.
- A fresh consumer raises both picks, and the first replay exits 0. It answers and pins both, and it ends at the second
  pick (its pin record equals the original's, candidate copy-v3).
- A second and a third replay exit 0. They run no pin and print no `answered` or `pinned` line, so there is no fall-back to
  copy-v2. Both pins print as `already`. Every file under the consumer, including `ledger.json`, `pin.json`, the scorecard
  and `.state`, is byte-equal to the snapshot taken after the first replay.

## Mutation proof
- The working-tree `replay.ts` was replaced with the base version (the applied-check change reverted).
- The two-pick test failed: 1 failed / 2 passed, exit 1. A re-run printed `pinned` lines.
- The fixed file was restored from a copy, and `shasum -a 256 -c` reported OK
  (bffad477e229f83e78b10f864f455051633fea77f4e10033b8792f67fcd446f8). `git diff` showed only the intended change.

## Not changed
- Check logic, scanners, allowlists, baselines, ceilings, `retired-leaves.ts` and `references/**` were not touched.
- No version, changelog or release-catalog edit was made.
- No PR, tag, publish or push. N6 and N7 are left as they were.

tier-outcome: high, done
