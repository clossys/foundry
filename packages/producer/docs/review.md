# clossys review and clossys receipt

<!-- Generated from packages/producer/src/review by `clossys review --write-doc`; `clossys review --check-doc` fails when this file differs. -->

`clossys review <base> <head> [--packet <unit.md>] [--receipt <receipt.json>] [--seed <s>] [--json]` runs every
mechanical review step in a temporary detached worktree of `<head>` and ends its report with

```
MECHANICAL: PASS|FAIL <head-sha> <tree-sha>
```

with the findings list just before that line. The temporary tree is a `git clone --shared` of the repository,
checked out detached at head in a temp folder: it registers nothing in the repository and is deleted afterwards.
A fail-level finding makes the verdict FAIL; a note is reported
only. `--json` prints the same report as a `clossys.review/1` document. The exit code is 0 for PASS, 1 for
FAIL and 2 for a usage error. When `git diff base...head` is empty and no packet is given, there is nothing to
run: the verdict is PASS with no findings. Counts and fixtures compare against the merge base of base and head.

## Steps

| Step | Finding | Fails when |
|---|---|---|
| changed | `-` | never: the files and packages of git diff --name-status base...head |
| forbidden | `forbidden.*` | any forbidden path below |
| leak-scan | `leak-scan` | the repository's public-safety check reports a failure kind more often at the head than at the merge base (details are never stored or printed) |
| install | `install` | the install in the head tree (and the base tree, for the counts) exits non-zero |
| build | `build` | a build of a changed package or its prerequisite exits non-zero; each package builds once, dependencies first |
| types | `types` | tsc --noEmit -p <package> exits non-zero for a changed workspace package with a tsconfig.json |
| tests | `tests` | a touched test file, or a test importing a changed module, exits non-zero run on its own |
| counts | `count.increase / count.probe` | a probe finds more of a rule at head than at the merge base, or cannot run at head |
| fixtures | `fixture.drift / fixture.generate` | the head generator, run on the base copy of a generated fixture, writes anything diff -r finds in the head's committed copy |
| e2e | `e2e` | clossys check --e2e exits non-zero when the producer, designer, writer or publisher package changed |
| receipt | `receipt.*` | with --packet: the receipt is missing, names another head, was taken dirty, or a re-run differs in exit code or output tail |
| mutation | `mutation.survived (note)` | never: each mutant is reported killed, survived, invalid (does not compile) or uncovered |

Mutation runs last, on the head tree, and restores every file it touches.

## Forbidden paths

| Finding | Matches |
|---|---|
| `forbidden.changelog` | any CHANGELOG file, or a .changeset/*.md entry (bump freeze) |
| `forbidden.release-catalog` | any release-catalog.json |
| `forbidden.retired-leaves` | any retired-leaves.ts |
| `forbidden.baseline` | an added line in a file named *baseline* or *allowlist*/*allow-list*, or in governance/known-*.json |
| `forbidden.version` | a modified package.json whose "version" differs between the merge base and head (bump freeze) |

## Count probes

Each probe runs in the base tree and in the head tree after the probe packages build there
(`packages/producer`). Every rule id either side reports is compared; any increase is `count.increase`.

| Probe | Counts | Command |
|---|---|---|
| check | clossys check --json on packages/producer/test-fixtures/consumer: findings per rule | `node packages/producer/dist/cli/index.js check --json --root packages/producer/test-fixtures/consumer` |
| constitution | clossys check --constitution --json on packages/producer/test-fixtures/consumer: rows per registered rule | `node packages/producer/dist/cli/index.js check --constitution --json --root packages/producer/test-fixtures/consumer` |
| side-door | clossys check --side-door --json on the checkout: engine.side-door findings | `node packages/producer/dist/cli/index.js check --side-door --json --root .` |
| ia-orphans | ia.orphans over packages/producer/test-fixtures/consumer: orphan slot folders | `node --input-type=module -e const m = await import("./packages/producer/dist/check/ia-orphans.js"); console.log(JSON.stringify({ n: m.iaOrphans.run("packages/producer/test-fixtures/consumer").findings.length }));` |

## Generated fixtures

When one of a fixture's trigger paths changed, the review puts the base's committed copy where the generator
reads it, runs the head's generator into a temp folder, restores the head's copy, then runs `diff -r` from the
regenerated output to the head's committed copy. Any difference is `fixture.drift`. A head without the generator
skips the fixture with a `fixture.skipped` note.

| Fixture | Committed copy | Generator | Triggers |
|---|---|---|---|
| producer-consumer | `packages/producer/test-fixtures/consumer` | `node packages/producer/scripts/seed-pinned-world.mjs --out {out}` (cwd `packages/producer`) | `packages/producer/`, `packages/designer/`, `packages/writer/`, `packages/publisher/`, `packages/director/` |

## E2E and leak scan

- E2E: `node packages/producer/dist/cli/index.js check --e2e --json` when one of `packages/producer`, `packages/designer`, `packages/writer`, `packages/publisher` changed.
- Leak scan: `npm run -s check:safety -- --json`, unchanged, in the head tree and then the merge base's tree, before either installs anything. Only each failure's file and kind are kept, as counts: a kind that occurs more often at the head is `leak-scan` (subject: the kind), failures the merge base already has are one `leak-scan.preexisting` note. Nothing else of its output is stored or printed; output that is not its JSON report falls back to its exit code.
- Install, in each fresh tree: `npm ci --no-audit --no-fund --prefer-offline`.

## Mutation

At most 40 mutants of the head's changed lines (the `-U0` hunks of each changed source file that is not a
test). Above the cap the selection is the mutants with the lowest sha256 of `<seed>:<mutant id>`, kept in file and
line order, so the same diff and seed always pick the same mutants (`--seed`, default `0`). Each mutant runs the
tests covering its file (touched tests and the tests importing it) one at a time until one fails.

| Operator | Rewrites |
|---|---|
| flip-comparison | === <-> !==, <= -> >, >= -> <, < -> >=, > -> <= (spaced binary operators only) |
| negate-condition | if (c) -> if (!(c)), when the condition closes on the same line |
| drop-return | return <expr>; -> return undefined; (as never in TypeScript) |
| drop-throw | throw <expr>; -> void (<expr>); |
| swap-literal | true <-> false, an integer n -> n + 1 (0 -> 1) |

A mutant is `killed` when a covering test fails, `invalid` when that failure is a compile error, `survived` when every
covering test passes (a `mutation.survived` note), and `uncovered` when no test covers its file or one is red at the head.

## Receipts

`clossys receipt --packet <unit.md> [--out <dir>] [--root <dir>]` reads the packet's `Validation` section (from that
heading to the next heading of the same or a higher level), takes every inline code span in its list items whose
first word is one of `clossys`, `cmp`, `df`, `diff`, `git`, `node`, `npm`, `npx`, `wt` with at least one argument, and writes
`commands.json`, then runs each command in the checkout root and writes `receipt.json` and `receipt.md` to
`<packet dir>/<packet name>.receipt/` unless `--out` says otherwise.

- `wt run <options> -- <command>` records the wrapped command only.
- `clossys <verb>` runs the checkout's own CLI: `node packages/producer/dist/cli/index.js <verb>`.
- `clossys review` and `clossys receipt` are skipped and listed as skipped.
- A command repeated in the list runs once.

`commands.json` is `{ "schema": "clossys.review-commands/1", "packet", "commands": [{ "id", "run", "from" }], "skipped": [{ "text", "reason" }] }`.

`receipt.json` is `{ "schema": "clossys.receipt/1", "packet", "head", "tree", "dirty", "at", "commands": [{ "id", "run", "exit", "ms", "tailSha256" }], "skipped" }`.

`tailSha256` is the sha256 of the last 40 non-empty lines of the command's combined output after
normalizing: colour codes and carriage returns dropped, the checkout root and the temp root replaced by `<root>`, and
every digit run replaced by `0`, so timings and counts of temp folders do not change it.

`clossys review --packet` re-runs every receipt command in the head tree and fails with `receipt.mismatch` on any
exit code or tail difference, with `receipt.head` when the receipt names another head, with `receipt.dirty` when it
was taken on uncommitted changes, and with `receipt.missing` when there is no receipt.
