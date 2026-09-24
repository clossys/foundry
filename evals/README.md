# Foundry evals (#1185)

A deterministic regression gate for Advisor's composition engine, plus
static conversation-contract checks over every role skill — and, separately,
an optional manual model-in-the-loop script for owners. Design: the #1187
convergence comment that raised evals to p1 (composition accuracy and
repeatability scoring, plus conversation-contract checks, as the regression
gate for later catalogue changes) and #1176's own scope addition ("Scope
addition: kit composition scenarios", 2026-09-22).

## What runs in CI (deterministic, no model calls)

```bash
node --test evals/lib/*.test.mjs scripts/check-evals.test.mjs   # unit tests for the harness itself
node scripts/check-evals.mjs                                     # the gate
```

Both are wired into `.github/workflows/ci.yml` (the same dependency-free,
pre-build job as `check:conversation-contract` and its neighbors) and into
`npm run check` as `check:evals`. Neither needs a build: `check-evals.mjs`
imports `scripts/lib/capability-catalogue.mjs` — this repository's own
dependency-free mirror of `packages/advisor/src/composition.ts`, already
used by `scripts/check-offering-kits.mjs` — to build the real, generated
capability catalogue from the current tree's `packages/*/package.json`
`foundry` manifests, and reads `packages/*/skill/SKILL.md` as plain text.
Composition scenario findings always fail the gate; conversation-contract
static findings are report-mode only (see below) unless
`--enforce-contract-statics` is passed.

### Composition scenarios (`evals/scenarios/*.json`)

Each fixture is a generic, synthetic client — no real companies — with:

- `confirmedProblems`: ids from `docs/contracts/client-problems.json`, one
  marked `primary: true`, exactly as a client would confirm them through
  Advisor's problem-cards flow (#1176).
- `expect`: the composed state (`composed`, `over-cap`, or `indeterminate`),
  the roles that must and must not appear, an optional exact `sequence`, and
  an optional `maxRoles`/`cap`/`roleCount`/`reasonIncludes`.

`evals/lib/scenario-runner.mjs` runs each fixture's `confirmedProblems`
through the real `composeKitFromProblems`, and scores it two ways
(`evals/lib/accuracy.mjs`, `evals/lib/repeatability.mjs`):

- **Accuracy** — precision/recall of the composed roles against
  `mustIncludeRoles`, plus hard checks on `mustExcludeRoles`, `maxRoles`,
  the exact `sequence` when given, and the guardrail states (`over-cap`,
  `indeterminate`) the engine itself defines.
- **Repeatability** — the same `confirmedProblems` composed five times
  unchanged, and again over four fixed reorderings of the array (original,
  reversed, rotated, sorted by id) — never a random shuffle, so the harness
  itself stays deterministic. Composition is defined to be order-independent
  once problems are confirmed (#1176); any variance is a defect, not a flake.

**What the 1.00 precision/recall scores are, and are not.** Every current
scenario's `mustIncludeRoles` is exhaustive by construction, so a passing
run always scores precision and recall at 1.00 — that is tautological, not
independent evidence of accuracy (review #1413, reviewer B's N3). What the
scores actually rest on: `mustIncludeRoles` is hand-authored, anchored to
`docs/contracts/kit-presets.json` for the four preset scenarios and to
reasoned `needs` dependency pull-ins for the rest (for example, Designer
alone must pull in Strategist) — chosen independently of what the code
under test happens to output. `sequence`, by contrast, is NOT independent:
each fixture's `sequence` array is a snapshot of the engine's own output at
authoring time, so a sequence check only proves the order hasn't drifted,
never that the order is correct. Treat a scenario pass as "the composed
role set still matches what a human decided it should be, and the order
hasn't silently changed" — real regression coverage, but not a substitute
for someone reviewing a new scenario's `mustIncludeRoles`/`sequence` against
`docs/contracts/kit-presets.json` and the package manifests when it is
added.

Because the catalogue is built from the real tree rather than a synthetic
fixture, a change to any package's `foundry.solves`/`needs`/`feeds`, to
`docs/contracts/client-problems.json`, or to `docs/contracts/kit-presets.json`
that changes real composition output will regress one of these scenarios —
which is the point: this is the regression gate for catalogue changes that
#1187's design comment asks for.

Add a scenario by adding one `evals/scenarios/<id>.json` file whose `id`
field matches its file name; every scenario is picked up automatically at
the next run — never a hand-maintained list.

### Mirror parity (`evals/manual/mirror-parity.test.mjs`)

The scenarios above test `scripts/lib/capability-catalogue.mjs` — this
repository's own dependency-free mirror of
`packages/advisor/src/composition.ts` — not the shipped, published Advisor
package. `evals/manual/mirror-parity.test.mjs` asserts `composeKitFromProblems`
gives identical results in both copies, over every `evals/scenarios/*.json`
fixture. It lives in `evals/manual/`, next to the model-in-the-loop script,
and is **not** wired into `check:evals` or any workflow, because unlike the
rest of this harness it needs `packages/advisor` built first (gitignored
`dist/` output; no `packages/advisor` source file is touched):

```bash
npm run build --workspace=packages/advisor
node --test evals/manual/mirror-parity.test.mjs
```

Run without that build, every test in the file reports skipped, not failed,
naming the exact command above.

### Conversation-contract statics (`evals/lib/conversation-contract-checks.mjs`)

`scripts/check-conversation-contract.mjs` already gates that every composed
skill carries the shared `docs/contracts/conversation-contract.md` block
exactly once. This module checks something different: does each package's
OWN role-specific skill content (the rest of `skill/SKILL.md`, everything
outside that shared block) instruct the agent to do something the contract
forbids? Three narrow, mechanical rules:

- `client-facing-jargon-request` — an instruction to ask the client for an
  id, slug, path, version, sha, command, or tool. Word-bounded and
  plural-tolerant (`\bids?\b`, `\bpaths?\b`, `\bversions?\b`, `\btools?\b`,
  ...), so "which version", "the repository path", and "which tool" are all
  caught, without matching "idea" or "ideal" (review #1413, B2 — the
  earlier version of this regex was missing `version` and bare `path`/`tool`
  entirely, and matched inside "idea"/"ideal" for lack of a trailing `\b`;
  see `evals/lib/conversation-contract-checks.test.mjs` for the regression
  cases both blind reviewers found).
- `multi-question-per-turn` — an instruction to ask the client more than one
  question in a single turn.
- `bare-loop-directive` — the word `loop`, quoted or backticked, presented
  as something to type or say, with no `/clossys-<role>` or
  `@clossys-<role>` prefix anywhere in the same sentence, and no rule-
  explaining language (`never`, `without`, `no bare`) in it either (#1194).

These are heuristic text scans, not a parser. Expect false negatives — this
cannot prove a skill never violates the contract. False positives on
unusual phrasing are possible too; this module's tests demonstrate that the
specific misses review #1413 found are now caught, and that one non-ask
control sentence and the "idea"/"ideal" case are not flagged, not an
absence of every possible false positive. On the current tree, all 21
packed skills score zero findings; because these rules are new and their
false-positive rate is not proven over time beyond what the tests cover,
they stay in **report mode** by default (findings are printed and counted,
never fail the gate — the same posture as `check:package-framework`'s own
`--enforce` convention) until `--enforce-contract-statics` is passed.

If a run of this check ever surfaces a real defect inside a role skill, the
fix belongs to that skill's own package, not to this gate.

## What never runs in CI: the manual, model-in-the-loop half

```bash
node evals/manual/model-in-the-loop-eval.mjs <role> [--host claude-code|cursor]
```

Prints a scripted, non-technical-founder transcript and a grading checklist
against `docs/contracts/conversation-contract.md` for an owner to run by
hand, in their own already-authenticated agent session, and grade by eye.
It makes no model call itself — it holds no credential and calls out to
nothing — which is also why it can never be accidentally wired into an
automated job. It is not, and cannot be, a CI gate: model output is not
reproducible run to run, so scoring it with an assertion would just be a
flaky gate wearing a deterministic one's clothes. It is not wired into
`check:evals`, `npm run check`, or any workflow, and it never will be.

## Out of scope (#1185's charter)

- Live-model grading in CI.
- Proving client outcomes — a passing scenario is evidence of correct
  mechanism, never a claim about what happened for a real client.
- Fixing the skills or packages these checks read. A finding here is
  reported, not repaired, by this harness.
