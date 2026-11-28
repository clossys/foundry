# CP1-UNITPACKET report

Unit branch: `claude/r2f-0048-cp1-unitpacket` at `7bfcc28f3` (pushed, fast-forward, new branch).
Base: `claude/r2f-int2` at `e8deb2e7391eb29276aaa7500957697f9fc72d3c`; merged in, in order:
`claude/r2f-0048-cp1-plannerrun` at `642d50eb089358b320301b5687b84251e054249b` (merge commit `5de211091`, no conflicts),
then `claude/r2f-0048-cp1-factory0` at `009240d0023b3d05b893d9aefe9d4bc66642f059` ("Already up to date": factory0 is already an ancestor of the int2 base).
All three shas resolve (`git cat-file -e <sha>^{commit}` ok after fetching).

## Preflight

| step | exit |
| --- | --- |
| `git remote get-url origin` → clossys/foundry | 0 |
| `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-plannerrun claude/r2f-0048-cp1-factory0` | 0 |
| `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-unitpacket` (and `-report`) | 0 |
| `node -v` v22.23.5, `npm -v` 10.9.9 | 0 |
| `npm ci` (21s) | 0 |
| `npm run agent:cloud:bootstrap` (29s), `npm run agent:cloud:check` | 0, 0 |

## What was done

- **(a) Schema** — `packages/producer/src/cli/unit-packet.ts`: H1 `# <ID>: <title> (<tier>, gate: yes|no)`; sections Why, Repository and base, Objective, Validation, Forbidden, Stop rule, Output, After the fold (present once, in order, not empty); required fields Branch (exactly one backticked `claude/<name>` ref, G1), Depends on, Env, Tier (must match H1), Write set (≥1 backticked path or glob, G2). Env/Tier are also passed through the CP1-PLANNERRUN reader (`readPacket`), so a malformed value is named the same way.
- **(b) Verbs** in `packages/producer/src/cli/unit.ts`: `clossys unit new <ID> [--out]` (skeleton with `<<fill: ...>>` placeholders that lint refuses; never overwrites), `clossys unit lint <packet|dir>` (exit 1, one `refused <file>  R-UNIT-PACKET  <findings>` line naming each missing section/field/write set), `clossys unit brief <packet> --role exec|fix|blind|final|delta` (lints first and refuses a packet that fails; prints the role template, the rules scoped to the role, and the packet with local paths withheld).
- **(c) Rules as data — partial.** Registry rows can now carry an optional `scope` (role list), added to `registry.schema.json` and validated in `scripts/check-rules.mjs` (stricter, not weaker). `brief` reads the registry only. `scope` is set on R-CHECKS-WIRED and R-REVIEW-MECHANICAL (reviewer → blind, final, delta) and R-NO-HIDDEN-FALLBACKS (developer → exec, fix). Role templates are data in a `unit-roles` table in the Planner skill, read the same way as the tier table. **The rules.md rows were not added; see BLOCKED below.**
- **(d) Rule and skill** — new registry row R-UNIT-PACKET (`owner_agent: planner`, enforced) with check `.#check:unit-packet-schema` (new root script, added to root `check` after `check:unit-packets`; it lints `packages/planner/test-fixtures/packet-schema/`) and fixture `scripts/rules/fixtures/R-UNIT-PACKET/no-write-set.md`. The fixture run passes under `check:rules` (R-UNIT-PACKET isn't in the failing list). `packages/planner/skill/SKILL.md` lists R-UNIT-PACKET as owned and documents the schema and roles.
- **(e) Parity — not done**; see BLOCKED.
- `unit run` is **not** gated on lint. Gating it would change CP1-PLANNERRUN behaviour, which is still in review, and its existing run tests use packets that predate the schema. Option for the planner: gate `run` on `lint` in a follow-up once both units fold, and update those test packets.

## Files touched

- `package.json` (root script `check:unit-packet-schema`; added to `check`)
- `packages/planner/skill/SKILL.md`
- `packages/planner/test-fixtures/packet-schema/clean.md` (new)
- `packages/producer/src/cli/unit-packet.ts` (new)
- `packages/producer/src/cli/unit-packet.test.ts` (new)
- `packages/producer/src/cli/unit-rules.ts` (exports `withholdLocalPaths`; cloud prompt uses it, same behaviour)
- `packages/producer/src/cli/unit.ts`
- `scripts/check-rules.mjs` (validates `scope`)
- `scripts/rules/fixtures/R-UNIT-PACKET/no-write-set.md` (new)
- `scripts/rules/registry.json`
- `scripts/rules/registry.schema.json`

## Commands and exit codes

| command | exit | time |
| --- | --- | --- |
| `npm run build -w @clossys/controller` | 0 | 3s |
| `npm run build -w @clossys/designer` (first try, before director was built) | 2 | 26s |
| `npm run build -w @clossys/writer` (first try, before director was built) | 2 | 4s |
| `npm run build -w @clossys/director` | 0 | 1s |
| `npm run build -w @clossys/publisher` | 0 | ~9 min |
| `npm run build -w @clossys/designer` (rerun) | 0 | 28s |
| `npm run build -w @clossys/writer` (rerun) | 0 | 5s |
| `npm run typecheck -w @clossys/producer` | 0 | 9s |
| `npm run typecheck -w @clossys/planner` | 0 | 0s |
| `npm run build -w @clossys/producer` | 0 | 27s |
| `npx vitest run src/cli/unit-packet.test.ts src/cli/unit.test.ts` (producer; first run: one assertion on the brief refusal text) | 1 | 16s |
| same, after naming the rule in the brief refusal | 0 (23/23) | 13s |
| `npx vitest run src/cli/cp1-help.test.ts src/cli/unit.test.ts src/cli/unit-packet.test.ts` | 0 | 23s |
| `npm run check:unit-packet-schema` | 0 | 0s |
| `node packages/producer/dist/cli/index.js unit lint scripts/rules/fixtures/R-UNIT-PACKET` | 1 (expected: refused, missing write set) | 0s |
| `npm run check:unit-packets` | 0 | 1s |
| `node --test scripts/check-rules.test.mjs` | 0 | 1s |
| `npm run check:rules` | 1 (base-red, see below) | 302s |
| `npm run check:orphan-checks` | 1 (base-red, see below) | 1s |
| `npm test -w @clossys/planner` | 0 | 1s |
| `npm run check:package-skills` | 0 | 0s |
| `node --test scripts/pre-push-ratchet.test.mjs` | 0 | 15s |
| `npm run check:safety` | 0 (PARTIAL: no denylist in cloud, not a clearance) | 4s |
| `npm run check:conflict-markers` | 0 | 0s |
| `npm run check:scope` | 0 | 1s |
| `git merge-tree --write-tree claude/r2f-int2 HEAD` | 1: no local `claude/r2f-int2` ref in this clone | 0s |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 | 0s |
| `git push -u origin claude/r2f-0048-cp1-unitpacket` | 0 | 3s |

## Mutations (each restored and checked with `cmp`)

| mutation | result | restored |
| --- | --- | --- |
| make the write set optional (`if (found.length === 0 && (name as string) !== "Write set")`) | fails "lint refuses a packet with no write set" (and the brief-refusal test) | `cmp` ok |
| drop role filtering in brief (`rulesForRole` returns every row) | fails "brief for a blind role includes review rules and omits exec rules" | `cmp` ok |

The first write-set mutation (`if (name === "Write set") continue;`) didn't typecheck (TS2367), so the build failed before any test ran. It was replaced with the compiling form above and doesn't count as a mutation result.

## Named tests

| test | status |
| --- | --- |
| "lint refuses a packet with no write set" | passes |
| "lint refuses a malformed branch line" | passes |
| "new writes a skeleton that lints clean once filled" | passes |
| "brief for a blind role includes review rules and omits exec rules" | passes |
| "every rules.md id has a registry row with an owner" | **not written** (input missing) |
| "unit lint matches unit.py on the recorded packets" | **not written** (input missing) |

## Related tests: new red / base red

Base-red was measured on the merged base `5de211091` in a scratch worktree, with the same `node_modules` and package builds.

- `check:orphan-checks`: HEAD 8 findings, base 8 findings, the same 8 files. **New red: none.**
- `check:rules`: HEAD fails R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER, plus 2 unmapped designer studio checks. Base fails all of those and also R-SHADCN-STOCK, R-VENDORED-SOURCES, R-SLOT-PINS, R-ONE-BRAND, R-REAL-SPECIMENS, R-USAGE-GRAPH (base-only reds come from the scratch worktree's environment). HEAD's failing set is a subset of base's. **New red: none.** R-UNIT-PACKET passes its fixture.
- unit, unit-packet, cp1-help, planner, check-rules and pre-push-ratchet tests: all green on HEAD.

## Out of scope / not done

- The planner-side scripts (`unit.py`, `brief.py`, `cut.sh`, `ready-gate.sh`, `preflight.py`) and `bin/templates/rules.md` are outside this repository. Retiring them is for the planner after the fold.
- No publish, no version/changelog/release-catalog edits, no PR, no merge.

BLOCKED: objectives (c) and (e) need two inputs this cloud session didn't have, and the packet forbids reading outside the repository. (1) The content of `bin/templates/rules.md` is not in clossys/foundry, so its F, W, S, B, C, Q, R and D rules, flags and caps can't be turned into registry rows with scope and `owner_agent`. That leaves the test "every rules.md id has a registry row with an owner" unwritten, and also means the BLOCKED-D5 single-owner check can't be evaluated. (2) The packet says the launch prompt attaches 3 recorded packets with their recorded `unit.py lint` results (one clean, one missing a section, one with a malformed branch line). None were attached, so "unit lint matches unit.py on the recorded packets" and parity (e) are unwritten. Everything else is on the unit branch at 7bfcc28f3: the schema, `unit new`, `unit lint`, `unit brief` with role filtering from the registry's new `scope` field, R-UNIT-PACKET with its check and fixture, the skill entry, the four other named tests and both mutations. Options: (a) relaunch this unit on top of 7bfcc28f3 with a scrubbed copy of rules.md and the 3 recorded fixtures in the prompt. The executor then adds one `scope`/`owner_agent` registry row per rules.md id (raising BLOCKED-D5 for any id without a single owner), adds the fixtures under `packages/planner/test-fixtures/unit-packet-parity/` with their recorded verdicts, and writes the two missing tests. (b) The planner commits scrubbed rules.md content and the fixtures to the repository first, then relaunches. (c) Fold the partial unit now and cut the rules.md migration and parity as a separate unit.
model: claude-opus-5-5
