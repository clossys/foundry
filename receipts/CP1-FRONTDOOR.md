# Receipt: CP1-FRONTDOOR carry onto claude/r2f-int2

Branch `claude/r2f-0048-cp1-frontdoor`, carried by merge (no rebase) onto the
integration branch. Every command below ran in a cloud session, which has no
public-safety denylist, so this receipt is not a FULL clearance.

## Merge

| Command | Exit | Time |
| --- | --- | --- |
| `git merge --no-edit origin/claude/r2f-int2` (tip 67bb25580f), giving merge 64a2f42ade | 0, no conflicts | <1s |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 (tree e7162abf68) | <1s |

No conflicts needed resolving. The integration side changed producer fixtures
(`test-fixtures/consumer`), and this unit does not touch them, so nothing
needed regenerating.

## Install and build

`wt` is not on this sandbox's PATH, so builds ran as `npm run build -w <pkg>`.
The merged diff against the integration branch touches one package,
`@clossys/producer`. Its workspace dependencies were built first, because the
container started with no build output.

| Command | Exit | Time |
| --- | --- | --- |
| `npm ci` | 0 | 21s |
| `npm run build -w @clossys/producer` (first attempt, dependencies not yet built) | 2 | 11s |
| `npm run build -w @clossys/director` | 0 | 2s |
| `npm run build -w @clossys/writer` | 0 | 5s |
| `npm run build -w @clossys/controller` | 0 | 3s |
| `npm run build -w @clossys/designer` | 0 | 27s |
| `npm run build -w @clossys/publisher` | 0 | 657s |
| `npm run build -w @clossys/producer` | 0 | 26s |
| `npm run agent:cloud:bootstrap` | 0 | 28s |
| `npm run agent:cloud:check` | 0 | <1s |
| `node scripts/check-agents-definition.mjs` | 0 (22 packages, 0 findings) | <1s |

## Validation

| Command | Exit | Time |
| --- | --- | --- |
| `npm run typecheck -w @clossys/producer` | 0 | 12s |
| `npx vitest run src/read/stage.test.ts` | 0 (3 passed) | 24s |
| `npx vitest run src/views/entry-block.test.ts` | 0 (3 passed) | 25s |

Named tests:
- "a fresh workspace is stage strategy with next on Director": passes.
- "a workspace whose Director IA init adopted moves next to Designer or Writer":
  passes. This is the test the packet names "a workspace with Director pinned
  moves next to Designer or Writer". The carry leaves its title as committed.
- "next.tier follows the step kind and next.model reads seat-policy": passes.
- "the AGENTS.md block is idempotent and leaves owner text untouched": passes.
- "the block lists covered scope generated from installed agents and formats and
  does not make Producer the default": passes.

Mutations. Each was applied, its test file run, and the file restored from a
saved copy and compared with `cmp`.

| Mutation | Test exit | Failing named test | `cmp` after restore |
| --- | --- | --- | --- |
| `decide:creative` mapped to `mid` (stage.ts `tierOfKind`) | 1 | next.tier follows the step kind and next.model reads seat-policy | 0 |
| Block written outside the markers (entry-block.ts update path appends instead of replacing between markers) | 1 | the AGENTS.md block is idempotent and leaves owner text untouched (plus the scope test and the init-twice test) | 0 |
| Hard-coded scope list (`coveredScope` returns a constant) | 1 | the block lists covered scope generated from installed agents and formats and does not make Producer the default (plus the idempotence test and the init-twice test) | 0 |

## Related tests

`npx vitest related --run <the 12 producer files changed vs origin/claude/r2f-int2>`
in `packages/producer`: exit 1 in 613s, with 114 failed, 1909 passed,
5 skipped and 2 todo across 37 failing files. Each failing file was then run
alone at head, and again alone at the integration tip in a detached worktree.

New at head: none.

Base-red: all 37 files. Each fails alone at the integration tip with the same
named tests failing as at head, except `src/preview/preview.test.ts`, which is
explained below.

`src/preview/preview.test.ts` passed (4/4) in a base worktree under the
system temp directory, but failed 4/4 in the main checkout. Its failure,
`Could not resolve "../../../../../../component-selection"
(clossys/publisher-host.tsx)`, depends on the checkout's location:
- A clean worktree of this head under the temp directory passes it 4/4.
- A base worktree at the same path depth as the main checkout fails it 4/4,
  with the identical render failure.

It is therefore labelled base-red: it fails at base under the same conditions
as at head.

Failing named tests per file (head alone, then base alone in a temp-directory
worktree):

| File | Head | Base |
| --- | --- | --- |
| `src/check/loop-reachable.test.ts` | 2 | 2 |
| `src/check/ref-verbatim-default.test.ts` | 1 | 1 |
| `src/cli/check-readiness-strict.test.ts` | 1 | 1 |
| `src/cli/guard.e2e.test.ts` | 1 | 1 |
| `src/cli/ia-adopt-records.test.ts` | 1 | 1 |
| `src/cli/inline-gates.e2e.test.ts` | 1 | 1 |
| `src/cli/one-format.test.ts` | 7 | 7 |
| `src/cli/publication-slot2.e2e.test.ts` | 1 | 1 |
| `src/cli/starter-plan.test.ts` | 1 | 1 |
| `src/conform/conform.test.ts` | 1 | 1 |
| `src/constitution/certify/director-fixtures.test.ts` | 2 | 2 |
| `src/constitution/choose-gate.test.ts` | 4 | 4 |
| `src/constitution/guard-session.test.ts` | 1 | 1 |
| `src/constitution/pin-gate.test.ts` | 7 | 7 |
| `src/loop/flows.test.ts` | 4 | 4 |
| `src/loop/repin-cascade.test.ts` | 5 | 5 |
| `src/migrate/copy-keys.test.ts` | 4 | 4 |
| `src/migrate/inputs.test.ts` | 1 | 1 |
| `src/migrate/recut-nested.test.ts` | 1 | 1 |
| `src/migrate/requests.test.ts` | 1 | 1 |
| `src/pipeline/absent-only.test.ts` | 8 | 8 |
| `src/pipeline/chain.test.ts` | 1 | 1 |
| `src/pipeline/interview.test.ts` | 4 | 4 |
| `src/pipeline/owner-wiring.test.ts` | 6 | 6 |
| `src/pipeline/writer-wording.test.ts` | 3 | 3 |
| `src/preview/preview.test.ts` | 4 | 0 |
| `src/publish/install-next.test.ts` | 6 | 6 |
| `src/read/status-absent-only.test.ts` | 2 | 2 |
| `src/records/pinned-world-strict.test.ts` | 1 | 1 |
| `src/records/request.test.ts` | 1 | 1 |
| `src/records/schema.test.ts` | 1 | 1 |
| `src/server/default-avatar.test.ts` | 5 | 5 |
| `src/server/installed-specimens.test.ts` | 9 | 9 |
| `src/server/publication.test.ts` | 13 | 13 |
| `src/server/publications.test.ts` | 1 | 1 |
| `src/server/selection.test.ts` | 1 | 1 |
| `src/server/studio-checks.test.ts` | 1 | 1 |
