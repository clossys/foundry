# Receipt: ANSWER-REPLAY

Unit branch: `claude/r2f-0048-answer-replay`, base `5a2e197ea` (equal to `origin/claude/r2f-int2` at run time).
Head: `0d850cb03a2e7774d8c2012da0575a9f3ea7f08a`.
Serving model id: `claude-opus-5-5` (session_context.model and last_served_model).

## Change

- `packages/producer/src/queue/replay.ts` (new): `exportAnswers` / `replayAnswers`.
  - Export (`clossys.answers/1`): every owner `answered` event, oldest first (ties by queue, then entry id), as
    `{queue, subject, ask, answer, via, quote, note?}`. No entry ids and no times, so two consumers holding the
    same answers export the same bytes.
  - Replay: matches each answer in order to an entry with the same queue, subject and ask (lowest id first, each
    entry used once). It answers through `answerQueueEntry`, so every answer rule runs; there are no model calls.
    All answers are matched before any is written. The first unmatched answer exits 1 with its name and
    nothing is written. An entry already answered with the same words counts as applied, so a re-run writes
    nothing. The answers it writes are stamped one second apart from `now`, so the order survives a re-export.
- `packages/producer/src/cli/answer.ts`: `clossys answer --export <file>` and `clossys answer --replay <file>`
  (with `--root`), plus a usage line.
- `packages/producer/src/queue/replay.test.ts` (new): the spec's proof. It answers two rounds on temp consumer A
  (pick + approve, then clarify), exports, raises the same questions on fresh consumer B under different ids and
  times, and replays. The test then checks three things: the records match with ids and times removed, B's
  export equals A's byte for byte, and a re-run reports "already" and changes no bytes. A second test checks
  that an unmatched answer exits 1 naming answer 1 and writes nothing.

Scope limit: replay covers queue answers (`clossys answer`). It does not re-run the follow-up pins that an
interview option's argv runs, or `clossys evidence` records. `clossys answer` itself writes no pins.

## Conform cells

The spec names no conform cells; this is a feature unit. Before and after:
`node packages/producer/dist/cli/index.js conform --all --json` gave exit 1 both times, with 51 red cells, the
same set before and after. No cell changed. The census reds are unrelated to answers.

## Commands (exit codes)

| command | exit |
|---|---|
| `npm ci` | 0 |
| `npm run build -w @clossys/{advisor,controller,director,designer,writer,publisher,producer}` | 0 each |
| `node packages/producer/dist/cli/index.js conform --all --json` (before) | 1 (51 red) |
| `npx vitest run packages/producer/src/queue/replay.test.ts packages/producer/src/queue/queue.test.ts` | 0 (48 passed) |
| `npm run typecheck` | 0 |
| `npx vitest run packages/producer/src/queue` | 0 (77 passed) |
| `npx vitest run packages/producer/src/cli/cli.test.ts` | 0 (24 passed) |
| `npx vitest run packages/producer/src/cli/subcommand-help.test.ts` | 0 (6 passed) |
| `npx vitest run packages/producer/src/cli/one-format.test.ts` | 1 (7 failed, 12 passed): **also 7 failed at base 5a2e197ea with this change stashed** |
| `npm run build -w @clossys/producer` (after) | 0 |
| `node packages/producer/dist/cli/index.js conform --all --json` (after) | 1 (same 51 red) |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 |
| `git push origin claude/r2f-0048-answer-replay` (first try) | 128: the git proxy refused; the repo was not in the session's sources |
| repo attached to the session at the owner's request, then `git push origin claude/r2f-0048-answer-replay` | 0 |

The `one-format.test.ts` failures (pick / writePin / re-pick / owner approval / B1 / B2 / reissue) are in pick
and pin code outside this unit's scope (answer/owner only). They are red at the int2 tip itself, so the gate's
`vitest run src/cli src/queue src/conform` command cannot pass on this branch without a change outside scope.

## Mutation proof

1. Replaced the "already applied" match in `replayAnswers` with `undefined`. `replay.test.ts` failed: the
   idempotent re-run test went red. Restored.
2. Replaced the per-answer stamp `new Date(now.getTime() + 1000 * written++)` with `now`. `replay.test.ts`
   failed: B's re-export no longer equalled A's byte for byte. Restored.

After the restore, `replay.test.ts` passed 2 of 2.
