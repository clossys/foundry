# clossys review and clossys receipt

<!-- Generated from packages/producer/src/review by `clossys review --write-doc`; `clossys review --check-doc` fails when this file differs. -->

`clossys review <base> <head> [--packet <unit.md>] [--receipt <receipt.json>] [--seed <s>] [--json]` runs every
mechanical review step in a temporary detached worktree of `<head>` and ends its report with

```
MECHANICAL: PASS|FAIL <head-sha> <tree-sha>
```

with the findings list just before that line. The temporary tree is a `git clone --shared` of the repository,
checked out detached at head in a temp folder, whose refs are replaced by the repository's own
(`refs/heads`, `refs/remotes`, `refs/tags`), so a command that names a local branch resolves it as in the checkout.
It registers nothing in the repository and is deleted afterwards.
A fail-level finding makes the verdict FAIL; a note is reported
only. `--json` prints the same report as a `clossys.review/1` document. The exit code is 0 for PASS, 1 for
FAIL and 2 for a usage error. When `git diff base...head` is empty and no packet is given, there is nothing to
run: the verdict is PASS with no findings. Counts, fixtures and the leak scan use the merge base of base and head.
A head that is an ancestor of base (the arguments swapped) and `--receipt` without `--packet` are usage errors.
A failed install, build, typecheck, test, probe or generator finding starts with its exit code, and says when the
command was killed at its timeout.

## Steps

| Step | Finding | Fails when |
|---|---|---|
| changed | `-` | never: the files and packages of git diff --name-status base...head |
| forbidden | `forbidden.*` | any forbidden path below |
| leak-scan | `leak-scan` | the merge base's public-safety script, run unchanged against the head tree, exits non-zero, or the merge base has no such script (its output is never stored or printed) |
| install | `install` | the install in the head tree (and the base tree, for the counts) exits non-zero |
| build | `build` | a build of a changed package, a probe or fixture package, or a prerequisite exits non-zero; each package builds once, dependencies first |
| types | `types` | the typecheck of a changed workspace package with a tsconfig.json exits non-zero |
| tests | `tests / test.uncovered` | a covering test file exits non-zero run on its own, or a changed source file has no covering test |
| counts | `count.increase / count.probe` | a probe finds more of a rule at head than at the merge base, or cannot run in either tree |
| fixtures | `fixture.*` | a registered generator is not at the head; or, for a fixture whose inputs changed, the head generator fails or writes anything diff -r finds against the head's committed copy |
| e2e | `e2e` | clossys check --e2e exits non-zero when the producer, designer, writer or publisher package changed |
| receipt | `receipt.*` | with --packet: any receipt finding below |
| mutation | `mutation.survived (note)` | never: each mutant is reported killed, survived, invalid (does not compile) or uncovered |

Mutation runs last, on the head tree, and restores every file it touches.

## Forbidden paths

| Finding | Matches |
|---|---|
| `forbidden.changelog` | any CHANGELOG file or .changeset/*.md entry, as either side of a change (a rename away included; bump freeze) |
| `forbidden.release-catalog` | any release-catalog.json, as either side of a change (a rename away included) |
| `forbidden.retired-leaves` | any retired-leaves.ts, as either side of a change |
| `forbidden.baseline` | an addition to a file named *baseline* or *allowlist*/*allow-list*, a governance/known-*.json, or a data file (json, yaml, txt, csv) named *exemption* or *ceiling*: an added line, any change to a binary one, or a rename or copy into such a name |
| `forbidden.version` | a modified package.json whose "version" differs between the merge base and head (bump freeze) |

Covering tests are every test file that reaches a changed source through the static import graph of the tracked
files: relative imports and imports of a workspace package by name (through its `exports`, `main` or
`./index.js`, `dist/` mapped back to `src/`), followed transitively across packages. A changed source file
(not a test, not a `.d.ts`) that no test reaches is `test.uncovered`.

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

Every registered generator must exist at the head: one that is missing is `fixture.generator-missing` (the detail
says when the merge base had it, so the change deleted it). When one of a fixture's trigger paths changed, its
`needs` packages join the build, the merge base's committed copy replaces the head tree's copy (for a generator
that reads the committed copy in place), the head's generator writes into a new temp folder, and the head tree's
copy is restored. The generator's own marks are removed from the output, the head's committed copy is extracted
with `git archive` (both the archive and the `tar` exit codes are checked: `fixture.extract`), and `diff -r`
compares the two. A generator that exits non-zero is `fixture.generate`; any difference is `fixture.drift`.

| Fixture | Committed copy | Generator | Needs built | Marks removed | Triggers |
|---|---|---|---|---|---|
| producer-consumer | `packages/producer/test-fixtures/consumer` | `node packages/producer/scripts/seed-pinned-world.mjs --out {out}` (cwd `packages/producer`) | `packages/producer` | `.seed-pinned-world` | `packages/producer/`, `packages/designer/`, `packages/writer/`, `packages/publisher/`, `packages/director/` |

## E2E and leak scan

- E2E: `node packages/producer/dist/cli/index.js check --e2e --json` when one of `packages/producer`, `packages/designer`, `packages/writer`, `packages/publisher` changed.
- Leak scan: the merge base's root package.json script `check:safety`, which must be one `node <script> <args>` command, run from the merge base's tree, unchanged, with the head tree as its working directory, before anything installs there. The head cannot rewire the script or edit the scanner it is judged by. A non-zero exit is `leak-scan`; only the exit code is kept, nothing of the output is stored or printed. A merge base without such a script is `leak-scan` too.
- Typecheck, per changed package with a tsconfig.json: `npx tsc --noEmit -p {pkg}`.
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
- A command repeated in the list runs once; listing it with two different expected exit codes is an error.
- Every command is expected to exit 0, unless the text right after its span says `exits N` (or `must exit N`,
  `exit code N`): then N is expected. `clossys receipt` exits 1 when a command's exit is not the expected one.

`commands.json` is `{ "schema": "clossys.review-commands/1", "packet", "commands": [{ "id", "run", "from", "expect" }], "skipped": [{ "text", "reason" }] }`.

`receipt.json` is `{ "schema": "clossys.receipt/1", "packet", "head", "tree", "dirty", "at", "commands": [{ "id", "run", "expect", "exit", "ms", "tailSha256" }], "skipped" }`.

`tailSha256` is the sha256 of the last 40 non-empty lines of the command's combined output after
normalizing: colour codes and carriage returns dropped, the checkout root and the temp root replaced by `<root>`,
and then each of these replaced by its marker. Other numbers, such as counts of tests or failures, are kept.

| Marker | Replaces |
|---|---|
| `<date>` | an ISO date and time |
| `<clock>` | a clock time hh:mm:ss |
| `<duration>` | a number with a time unit (ms, s, m, min, h) |
| `<size>` | a number with a size unit (B, k, K, Ki, KB, M, Mi, G, Gi, ...) |
| `<percent>` | a percentage |

`clossys review --packet <unit.md>` parses the packet's Validation list again at review time, holds the receipt
(`--receipt`, else the packet's default receipt folder) to it, and re-runs each packet command in the head tree:

| Finding | Fails when |
|---|---|
| `receipt.missing` | there is no receipt.json for the packet |
| `receipt.packet` | receipt.json names another packet file than --packet |
| `receipt.head` | receipt.json was taken at another head |
| `receipt.dirty` | receipt.json was taken on uncommitted changes |
| `receipt.command-missing` | a command the packet's Validation list gives (parsed again at review time) is not in receipt.json |
| `receipt.command-extra` | receipt.json holds a command the packet does not give |
| `receipt.exit` | a recorded exit code is not the one the packet expects (0 unless the item says `exits N`) |
| `receipt.mismatch` | a re-run at the head differs from the recorded exit code or output tail |
