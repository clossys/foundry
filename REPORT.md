# CP1-FACTORY0 comparison report

- Base: `67bb25580f7aea06038ac3d8c6c2cb74b5c42977`
- Head: `009240d0023b3d05b893d9aefe9d4bc66642f059` (branch `claude/r2f-0048-cp1-factory0`)

## Method

Each side got its own detached worktree in the same container, built the same way:

1. `npm ci` (exit 0 on both sides)
2. `npm run build -w @clossys/producer` on its own failed on both sides (exit 2) with TS2307, because first-party dependency `dist/` output was missing. So the producer's first-party dependency closure was built in dependency order with `npm run build -w packages/<dir> --if-present`: `director designer writer advisor publisher producer` (`controller` had already been built). Every step exited 0 on both sides.
3. `node scripts/check-rules.mjs` and `node scripts/check-agents.mjs` were run from the worktree root.

Before diffing, two things were normalized out of the output: durations, and each worktree's absolute root path, which was replaced with `<ROOT>`.

## Exit codes

| check | base | head |
|---|---|---|
| `node scripts/check-rules.mjs` | 1 | 1 |
| `node scripts/check-agents.mjs` | 1 | 1 |

Output length matched on both sides: 96 lines for check-rules and 67 for check-agents.

Summary line from check-rules (identical on both sides): `29 rules, 21 enforced by a check that fails on its fixture; failing: R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER; 2 unmapped check(s); 16 finding(s)`.

## Lines failing at head but not at base

None. The normalized `diff` was empty for both checks.

## Lines failing at base but not at head

None.

## Verdict

SAME-AS-BASE

The head change, which adds `owner_agent` fields and the planner/developer/reviewer packages, adds no new failing item to either check in this environment. The existing failures on both sides are the same, line for line, including the `ledger.append-only` finding caused by the shallow clone.

model: claude-opus-5-5
