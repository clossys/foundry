# @clossys/strategist

**The strategist role — is it true, and is it us?** Dependency-free machinery for a consumer-owned strategy tree: versioned cells, grounded evidence, confirmation checks, briefs, citations and review requests. The consumer authors the choices and evidence in its own repository.

```bash
npm install @clossys/strategist
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installation needs no authentication. Hub placement is appointed by `@clossys/launcher`; this package declares no hub I/O.

## The cell model

The cell model is the strategy conversation format shipped in
[`skill/SKILL.md`](skill/SKILL.md). The package provides the cell APIs and commands described below. Use the skill for the interview and user confirmation workflow.

One strategy is an L0–L3 tree: 7 L1 groups, 28 L2 groups and 57 L3 cells.
The catalog fixes leaf ids and their questions, must-contain keys, function
tags and required links. L0, L1 and L2 are rendered views; each L3 cell is
one versioned Markdown file. The default archetype starts with 24 core
cells; product-saas, services and marketplace add their own core cells.

The consumer owns the content under its chosen root (default
`<repo root>/clossys/agents/strategist/`). Starting an interview creates the
tree and session log there, including when the working directory is nested
inside the repository. All writes stay inside the selected strategy root:

```text
tree.json                    archetype, grouping overrides, active pointers
cells/<cell-id>/v<N>.md       one file per cell version
sessions/<date>-<n>.md       append-only U/S conversation bullets
findings/<id>.md             sourced, dated observations
requests/REQ-<NNNN>.json     changes requested by any role
contracts/<id>.json          optional consumer-local brief contracts
briefs/                     generated briefs and their index
citations.json              generated citation index
```

A cell has flat frontmatter and exactly three bullet sections: Direction
(the choice), Because (resolving evidence refs) and Watch (testable
tripwires). See the [template and anonymous worked example](skill/templates/cell.md).
Strategist writes drafts. A user confirms a playback listing the exact
cell versions; only those versions activate. Active and retired bodies
are immutable. A new decision is a new draft, and only activation makes
old downstream citations stale.

The loop is set → cascade → measure → review → steer. Consuming roles
own brief contracts and receive ready, missing or stale briefs. A missing
brief blocks the role; a stale brief needs a visible stale flag. Surfaces
cite `strategy:<cell-id>@<N>` rather than duplicating the decision.

The [seven role prompts](skill/roles/strategist.md) divide conversation,
research, synthesis, checking, critique, compilation and review with
explicit write boundaries. No helper confirms for the user. Before MVS,
run the pre-mortem and confirm resulting changes. MVS is clean completion
over the archetype's core cells; Complete requires all 57 cells active and
fresh, all 28 L2 groups coherent and L0 clean. Report only what the files
and judgments establish; mechanical gate success alone is not keep.

## Reading cells and briefs

```ts
import { openStrategy, formatRef } from "@clossys/strategist";

// Run from the repository root; the API uses the supplied folder.
const strategy = openStrategy("clossys/agents/strategist");
const cell = strategy.getActive("focus.segment.core");
if (cell) console.log(formatRef({ kind: "cell", ref: { cell: cell.id, version: cell.version } }));
const brief = strategy.getBrief("writer.messaging");
if (brief.state === "missing") console.error(brief.missing);
if (brief.state === "stale") console.warn(brief.stale);
```

`openStrategy` exposes `getCell`, `getActive`, `getBrief`, `isStale` and `status`. `getCell` without a version returns the latest version; `getActive` follows the active pointer. A new draft makes nothing stale. Consumer-owned contracts determine required and optional cells; `validateBriefContract` checks a contract and `discoverBriefContracts` finds installed and consumer-local contracts. `compileBrief` builds a brief from a model and contract. Briefs report ready, missing or stale; callers refuse missing input and expose stale state.

## CLI

```bash
# Explicit relative roots in these examples are run from the repository root.
strategist-check status --root clossys/agents/strategist --json
strategist-check check --root clossys/agents/strategist
strategist-check cohere --root clossys/agents/strategist
strategist-check complete --level mvs --root clossys/agents/strategist
strategist-check handoff writer.messaging --root clossys/agents/strategist
strategist-check brief writer.messaging --write --request --root clossys/agents/strategist
strategist-check index --check --root clossys/agents/strategist --scan src
strategist-check review --root clossys/agents/strategist
strategist-check ground --root clossys/agents/strategist src --json
strategist-check wont-claim --root clossys/agents/strategist src --json
```

The default root is `<repo root>/clossys/agents/strategist`, even from a nested working directory. Outside a repository, it is `clossys/agents/strategist` under the working directory. `--root` selects the exact supplied folder; relative explicit roots resolve from the working directory, without appending the default layout. The bare positional form `strategist-check <root> <scan-dir>` is ground mode and also preserves the supplied root. There is no legacy root fallback or automatic migration. Exit codes are 0 clean or ready, 1 findings or not ready, and 2 could not run. The `cell <id> --verb create|cohere|unlock|normalize` command exposes the corresponding quality or completion checks.

`propose <id> [--from N] [--option A]` creates a draft. `activate <cell-ref>[,<cell-ref>...] --confirm <user-message-ref>` requires the exact listed user confirmation. `request new|list|resolve` manages requests. The write API exposes `propose`, `activate`, `createRequest`, `listRequests` and `resolveRequest`. Activation preserves active and retired bodies and checks the entire confirmation batch before mutation. There is no force flag.

`brief <contract> --write` saves `briefs/<contract>.json` and updates `briefs/index.json` with each written contract's state, refs and fingerprint. `--request` opens a missing-input request attributed to the contract owner; repeating it reuses an open or drafted request for the same contract and missing cells. The flags work separately or together. Without them, `brief` and `handoff` only read. A valid missing or stale brief exits 1; invalid arguments, unknown contracts and unreadable inputs exit 2. After compiling installed contracts, run `index` to write `citations.json`.

`buildCitationIndex` indexes cell markers, structured JSON references and compiled briefs. `review` evaluates active Watch rules, dated findings and citation drift, creating deduplicated requests through the request writer. It never activates a choice. A malformed or unreadable root remains an error.

## Grounding and prohibited claims

`readFindings` parses a caller-supplied Markdown finding registry; `readStrategyRoot` reads the consumer tree and records path-specific issues. `parseFinding` and `validateFinding` enforce sourced and dated findings. `buildFactIndex` indexes each finding by id and registers its scalar value, value with unit and explicit aliases. `isTracedSurfaceForm` checks exact registered forms; it never invents formatted numbers.

```ts
import { checkGrounding, buildFactIndex, isTracedSurfaceForm } from "@clossys/strategist";
import type { Finding } from "@clossys/strategist";

const findings: Finding[] = [{ id: "active-customers", source: "evidence/count.csv", observed: "2026-10-29", by: "researcher", value: 4200, aliases: ["4,200"], bullets: [], path: "findings/active-customers.md" }];
const index = buildFactIndex(findings);
console.log(isTracedSurfaceForm(index, "4,200"));
const report = checkGrounding([{ path: "about.md", content: "We serve 9,999 customers." }], findings);
console.log(report.findings);
```

`checkGrounding` reports untraced numeric and closed-list superlative claims, plus unknown `fact:<id>` citations. It preserves token matching, comment ignores, code-fence handling and CSS percentage masking. Bare small numbers and arbitrary named claims are outside its heuristic coverage. A `facts-gate:ignore` comment is recorded in `ignored`. `scanStrategyDirectory` provides the filesystem half. Repeatable `--extensions`, `--skip-dirs` and `--exclude` keep their existing scan meanings. The CLI refuses missing or invalid evidence, empty scans and scans containing only the strategy root.

`checkWontClaimDrift` checks literal quoted phrases from `Never-claim:` bullets in the active Proof and `Never:` bullets in the active Voice. Drafts do not govern surfaces. Matching is case-insensitive with word boundaries; regex punctuation is literal. A comment with `wont-claim:ignore` is recorded. Unquoted bullets are explicitly unchecked. Invalid active sources, zero files and overlong lines are indeterminate, which wins over hits. The CLI excludes strategy evidence from surfaces and saves its report under the root.

## API reference

The root runtime exports are:

`ENGAGEMENT_CONTEXT_FIELD_IDS`, `audienceContextValue`, `engagementContextFieldById`, `readEngagementContext`, `readEngagementContextFromBriefData`, `assessStrategyTraceabilityRate`, `scanStrategyDirectory`, `buildFactIndex`, `isTracedSurfaceForm`, `readFindings`, `checkGrounding`, `checkWontClaimDrift`, `loadCatalog`, `validateCatalog`, `openStrategy`, `compileBrief`, `validateBriefContract`, `discoverBriefContracts`, `parseCell`, `serializeCell`, `parseRef`, `formatRef`, `parseSession`, `parseFinding`, `validateFinding`, `validateRequest`, `validateTree`, `readStrategyRoot`, `checkCell`, `checkCoherence`, `completion`, `strategyStatus`, `validWatch`, `blocks`, `cellJudgeId`, `buildCitationIndex`, `propose`, `activate`, `createRequest`, `listRequests`, `resolveRequest`, `review`.

The public types are:

`ValidationIssue`, `ValidationResult`, `Validator`, `EngagementContextField`, `EngagementContextFieldId`, `EngagementContextRead`, `EngagementContextSnapshot`, `StrategyTraceabilityRateAssessment`, `StrategyTraceabilityRateFinding`, `StrategyTraceabilityRateState`, `ScanOptions`, `ScannedFile`, `FactIndex`, `FactsGateFinding`, `FactsGateIgnored`, `FactsGateOptions`, `FactsGateResult`, `FactsGateRule`, `WontClaimFinding`, `WontClaimResult`, `WontClaimState`, `CatalogCell`, `CatalogNode`, `StrategyCatalog`, `CatalogRule`, `CatalogIssue`, `CatalogValidationResult`, `Strategy`, `StrategyInventoryReport`, `Brief`, `BriefCell`, `BriefContract`, `BriefContractDiscovery`, `CellId`, `CellRef`, `Ref`, `Bullet`, `Cell`, `FormatIssue`, `FormatResult`, `StrategyTreeNode`, `StrategyTree`, `SessionLine`, `Session`, `Finding`, `StrategyRequest`, `StrategyRootIssue`, `StrategyModel`, `Scope`, `JudgeVerdict`, `CheckOptions`, `CheckContext`, `CheckFinding`, `CellFinding`, `CoherenceFinding`, `CellCompletion`, `StorylineReport`, `StatusReport`, `CompletionReport`, `CitationEntry`, `CitationIndex`, `ScanInput`, `ProposeOptions`, `ActivateOptions`, `NewRequest`, `ReviewReport`, `ReviewRequest`.

`loadCatalog` and `validateCatalog` are also available from `@clossys/strategist/catalog`. Format functions parse or serialize cells and refs and validate sessions, findings, requests and trees. `checkCell`, `checkCoherence`, `completion` and `strategyStatus` report checks and earned levels; `validWatch`, `blocks` and `cellJudgeId` are the existing public check helpers. Judge findings remain data for the operator's checker; no model is called by the package.

## Strategy traceability rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is `strategy
traceability rate`, computed by `assessStrategyTraceabilityRate()`. An
empty evaluated set is `indeterminate`, never a perfect rate of 1.
`checkGrounding` checks surface claims; the traceability rate is a separate assessment. This package does not measure consumer evidence and does not close
the loop. A green run of this package's tests is not a close.

```ts
import { assessStrategyTraceabilityRate } from "@clossys/strategist";

const report = assessStrategyTraceabilityRate(input);
```

```bash
strategist-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "strategist-rate-check", "invocation": "single-json-input" } }
```

Onboarding discovers that declaration from the installed manifest and never
infers a surface. `strategist-check` remains the multi-mode CLI and is not
the assessment surface. Strategist is not a required first-day role;
Advisor remains the only required first-day assessment.

This package also ships the `clossys-strategist` Agent Skill at
`skill/SKILL.md`. In Cursor, mention `@clossys-strategist` to talk to that
voice next to the gate bins below. The skill is a chat voice, not a second
engine, and it does not replace `strategist-check` or `strategist-rate-check`.

## Reading the engagement context before asking (issue #1173)

A founder answers Advisor's engagement-context questions once — what kind
of business this is, what it offers, who it's for, what stage it's at,
what they want right now, and any constraints (`business`, `product`,
`audience`, `stage`, `intent`, `constraints`). Every staffed repository
carries a snapshot of that answer set in its own `clossys/brief.json`
(`docs/contracts/engagement-brief.json`'s `context` property,
`docs/DECISIONS.md` decision 28). `readEngagementContext` reads it against
the one shared brief contract (issue #1475: `docs/contracts/engagement-brief.json`
with `engagement-context.json`) — the same definition `@clossys/advisor`
and `@clossys/launcher` validate against. This package's own build
(`scripts/pack-brief-contract.mjs`) packs a generated copy of those two
contract files, and of their one checker implementation
(`packages/advisor/src/contract-schema.ts`), into `src/generated/` (gitignored)
at build time — this package still has no `dependencies` entry in
`package.json`, so it stays dependency-free of `@clossys/advisor` at
runtime even though it validates against the exact contract Advisor owns.
Every path named in this paragraph is in the public repository, not shipped in this package:

```ts
import { readEngagementContext, audienceContextValue } from "@clossys/strategist";

const { context, note } = readEngagementContext(repositoryRoot); // default path: clossys/brief.json
if (note) console.warn(note); // brief present but unreadable or invalid — asking everything, same as no brief
audienceContextValue(context); // "consumers" | "businesses" | undefined
```

**All-or-nothing.** A missing `clossys/brief.json`, and a brief with no
`context` property yet, both read as every field `unknown` with no `note`
— neither is an error. Anything else is validated against the shared
contract as a whole; a brief that does not fully validate reads as every
field `unknown` too, with a fixed `note`, even when only one field is at
fault — for example a duplicate context field id (the contract's own
`contains`/`maxItems` rule refuses that outright, so this reader has no
separate duplicate-id rule of its own to drift from it), an unknown
top-level key, or a field object carrying any key beyond `{id, state,
value}`. Only a brief that fully validates seeds anything; nothing is
ever read from a field that happened to look fine inside an otherwise
invalid document. The `note` itself never carries file text or founder
text — only a fixed reason, an OS error code (`readEngagementContext`'s
own file read), or a JSON syntax position (`readContractDocument`'s
own strict-JSON check, which also refuses invalid UTF-8 and a
repeated object key at any depth).

## Migration from the 0.6 record model

The old schema, brand coverage, direction, strategy bundle, separate claim/constraint contract, audience intake and brand-facts APIs have been removed. Cells replace those strategy records; findings replace flat facts and JSON facts directories. The old grounding function name is removed in favor of `checkGrounding`. Use brief readiness and citation checks for handoff and drift. Site identity records are owned by Publisher. The package version remains frozen; the minor changeset records the breaking 0.x API retirement.

Content stays in the consuming repository. The package supplies catalog data, validators, readers and checks; it ships no real business strategy. A clean package test is machinery evidence, never evidence that a consumer's strategy is complete or adopted.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/strategist.md), kept in the public repository rather than in the installed package.
