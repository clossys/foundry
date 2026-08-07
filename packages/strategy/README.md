# @vespeneventures/strategy

Upstream strategy machinery: mission, positioning, markets, audiences, and
roadmap, plus `facts` — the single place every number and named claim a
product states publicly should trace back to. This package ships the
schema, a typed reader, and a facts-traceability gate. It does not ship
anyone's actual mission statement, market sizing, or numbers.

```bash
npm install @vespeneventures/strategy
```

## What this package is, and is not

The split here mirrors `@vespeneventures/tokens`' own README ("The
three-layer contract"): that package ships a greyscale token contract and
lets each consumer bind its own brand on top; this package ships an entity
schema and a checker, and lets each consumer author its own strategy
content. Four different products can depend on this package and state four
completely different missions, markets, and facts — nothing here decides
what any of them says.

**What ships here:** Zod schemas (`FactSchema`, `MissionSchema`,
`PositioningSchema`, `MarketSchema`, `AudienceSchema`, `RoadmapItemSchema`),
a typed reader (`readStrategy`) that loads and validates a consumer's own
strategy directory, and a facts-traceability gate (`checkFactsTraceability`)
that scans prose and copy for claims that don't trace back to a real fact.

**What does not ship here:** any real company's mission, vision, values,
positioning, market sizing, audience research, roadmap, or facts. Every
example in this README and in this package's own tests is a fictional
product ("Widgetronic") invented for illustration.

## Directory shape a consumer authors

`readStrategy` expects a directory shaped like this. Every file is optional
except `facts.json` — see "Why facts.json is the one required file" below.

```
strategy/
  facts.json         required — an array of Fact
  mission.json        optional — a Mission
  positioning.json     optional — a Positioning
  markets.json           optional — an array of Market
  audiences.json           optional — an array of Audience
  roadmap.json                optional — an array of RoadmapItem
```

```ts
import { readStrategy } from "@vespeneventures/strategy";

const bundle = readStrategy("./strategy");
if (!bundle.complete) {
  for (const issue of bundle.issues) {
    console.error(`[${issue.reason}] ${issue.file}: ${issue.detail}`);
  }
}
console.log(bundle.facts.length, "facts loaded");
```

`readStrategy` never throws. Anything that could not be turned into usable
data — a missing `facts.json`, invalid JSON, a schema violation — is
recorded into `bundle.issues` and reflected in `bundle.complete`, the same
discipline `@vespeneventures/catalog`'s `buildCatalog` holds to for its own
`Catalog.skipped`. `complete` is `true` only when `facts.json` itself
validated AND every other file that exists on disk also validated.

### Why `facts.json` is the one required file

Every other entity here is prose a human writes once and revises rarely.
`facts` is different: it is the thing `checkFactsTraceability` checks
prose *against*, so a missing or invalid `facts.json` doesn't mean "no
facts to worry about" — it means there is no trustworthy ground truth at
all, and the facts gate (below) is built to fail closed on exactly that
case rather than silently passing.

## The `Fact` entity

```ts
interface Fact {
  key: string; // kebab-case, stable across relabels — "active-customers"
  label: string; // "Active customers"
  value: string | number | boolean | Money; // Money = { amount: number; currency: string }
  unit?: string; // "customers", "%", "countries" — omit for Money values
  asOf?: string; // the period this value describes
  source: string; // where this value came from — required
  verifiedBy?: string;
  lastUpdatedAt: string; // ISO 8601 date
  aliases?: string[]; // every literal surface form this value may appear as in prose
}
```

`aliases` is what makes prose matching tractable without guessing at
number formatting: a fact's author writes down every literal string the
value is allowed to appear as — `"4,200"`, `"$4.2M"`, `"4.2 million"` —
rather than this package trying to derive a rendering from the raw number
and inevitably guessing wrong. See `buildFactIndex` below.

## Fact index and traceability

```ts
import { buildFactIndex, isTracedSurfaceForm } from "@vespeneventures/strategy";

const index = buildFactIndex(bundle.facts);
isTracedSurfaceForm(index, "4,200"); // true, if some fact's value or alias is exactly "4,200"
```

Pure, no I/O. `checkFactsTraceability` (below) builds and uses this index
internally — most consumers never call it directly.

## The facts-traceability gate

**The rule, in one sentence:** a currency amount, percentage, multiplier,
or large/labelled count, and a small closed set of absolute/superlative
phrases (`the only`, `the first`, `the largest`, `the fastest-growing`,
`the leading`, `world's first`, `industry-first`, `#1`), must either
literally match a registered fact's value or alias, or be annotated with a
`fact:<key>` citation naming a real `facts.json` entry on the same line —
anything else is reported as untraced.

```ts
import { checkFactsTraceability, scanStrategyDirectory, readStrategy } from "@vespeneventures/strategy";

const bundle = readStrategy("./strategy");
const files = scanStrategyDirectory("./docs"); // .md, .mdx, .ts, .tsx, .js, .jsx by default
const result = checkFactsTraceability(files, bundle.facts);

for (const finding of result.findings) {
  console.error(`[${finding.rule}] ${finding.file}:${finding.line} — ${finding.message}`);
}
if (result.findings.length > 0) process.exitCode = 1;
```

`checkFactsTraceability` is pure — it takes already-read `ScannedFile[]`
and an already-loaded `Fact[]`, does no I/O, and never throws on any input
shape. `scanStrategyDirectory` is the I/O half that gathers files from a
real directory; the split exists so a test can call the gate directly with
fixture strings, with zero real filesystem involved.

### What it deliberately does not catch

- **Bare small numbers with no currency/percent/multiplier/grouping/unit
  word** — "Step 3", "React 18", a port number, a heading numeral. A gate
  that fires on every digit in every sentence gets disabled by the team it
  was meant to protect; this gate would rather miss an oddly-phrased claim
  than train its own consumers to ignore it.
- **Free-form named claims** that aren't shaped like one of the closed
  superlative phrases above ("our biggest customer is Acme Corp"). Open-
  ended named-entity recognition is a materially harder and noisier
  problem than this gate takes on. The superlative list instead targets
  the specific, high-risk pattern of an absolute claim made without
  necessarily naming a number at all.
- **Anything inside a fenced code block, an inline code span, or an
  `http(s)://` URL.** Numbers there are code or link contents, not claims
  about the product.

### The escape hatch

Two comment markers, checked on the SAME line as the claim (either an HTML
comment, a block comment, a JSX comment, or a line comment all work):

- `fact:<key>` — cites a real entry in `facts.json` by its `key`. Traces
  every claim on that line. Citing a key that does **not** exist in
  `facts.json` is itself a finding (`unknown-fact-citation`) — a rotted or
  misspelled key can't silently satisfy the gate.
- `facts-gate:ignore` — suppresses every claim on that line without
  requiring a citation. Recorded into `result.ignored`, never silently: a
  report always shows exactly what was explicitly overridden and where, so
  the escape hatch stays auditable rather than a quiet way to make the gate
  stop looking.

```md
Widgetronic is the only platform built for this. <!-- fact:only-platform-claim -->
Legacy copy still says 500 integrations. <!-- facts-gate:ignore -->
```

### The `strategy-facts-check` CLI

```bash
npx strategy-facts-check ./strategy ./docs
```

```
Usage: strategy-facts-check <strategy-dir> [scan-dir] [options]

  strategy-dir   Directory containing facts.json (and the rest of the strategy bundle). Required.
  scan-dir       Directory to scan for prose/copy claims. Defaults to the current working directory.

Options:
  --help         Print this message and exit 0.
```

Exit codes — the same three-state contract `@vespeneventures/gates`'
`foundry-check` uses:

| Code | Meaning |
| --- | --- |
| `0` | Ran cleanly, `facts.json` loaded, at least one file scanned, zero findings. |
| `1` | Ran cleanly, at least one finding (an untraced claim, or a citation to a fact key that does not exist). |
| `2` | **Could not run** — bad input, `facts.json` missing/unreadable/invalid, the scan matched zero files, or an unreadable directory during the walk. Never conflated with `0`: a gate that reports "clean" after failing to actually check anything is worse than no gate at all. |

Two specific situations are deliberately mapped to `2`, not a silent `0`,
because both are exactly the failure mode this package's gates are built
against: a missing or invalid `facts.json` (nothing trustworthy to check
prose against) and a scan that matched zero files (nothing was actually
scanned — "found nothing wrong" and "checked nothing" must never look the
same in a report).

## API

### Entities (`schema.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `FactSchema` | Zod schema | One `Fact`: `key`, `label`, `value`, optional `unit`/`asOf`/`verifiedBy`/`aliases`, required `source` and `lastUpdatedAt`. |
| `FactsFileSchema` | Zod schema | The whole contents of a `facts.json` file — `Fact[]`, additionally rejecting a duplicate `key`. |
| `MoneySchema` | Zod schema | `{ amount: number; currency: string }` — an ISO 4217 code. A monetary `Fact.value` is always this shape, never a bare number. |
| `MissionSchema` | Zod schema | `{ statement, vision, values: OperatingValue[] }`. |
| `OperatingValueSchema` | Zod schema | `{ name, rule }` — one operating value; `rule` is the decision it forces when two paths look equally good. |
| `PositioningSchema` | Zod schema | The classic positioning-statement fields: `productName`, `category`, `forWhom`, `weAre`, `unlike`, `reasonToBelieve`. |
| `MarketSchema` / `MarketsFileSchema` | Zod schema | One market / an array of markets. `factRefs?: string[]` names `Fact.key`s this market's sizing claims trace to (not cross-validated by the schema itself). |
| `AudienceSchema` / `AudiencesFileSchema` | Zod schema | One audience / an array of audiences. `painPoints?: string[]`, `factRefs?: string[]`. |
| `RoadmapItemSchema` / `RoadmapFileSchema` | Zod schema | One roadmap item / an array of them. `status` is the closed vocabulary `RoadmapStatusSchema`. |
| `RoadmapStatusSchema` | Zod schema | `"now" \| "next" \| "later" \| "shipped"`. |
| `Fact`, `Money`, `Mission`, `OperatingValue`, `Positioning`, `Market`, `Audience`, `RoadmapItem`, `RoadmapStatus` | types | `z.infer` of the schemas above. |

### Reader (`reader.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `readStrategy(root)` | function | Reads and validates a strategy directory (see "Directory shape" above). The package's one deliberate I/O surface. Never throws — see `StrategyBundle.issues`/`complete`. |
| `StrategyBundle` | type | `{ root, facts, mission?, positioning?, markets?, audiences?, roadmap?, issues, complete }`. |
| `StrategyReadIssue` | type | `{ file, reason: StrategyReadIssueReason, detail }` — one file that did not become usable data. |
| `StrategyReadIssueReason` | type | `"unreadable" \| "unparseable" \| "invalid-schema" \| "missing-required"`. |

### Fact index (`fact-index.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `buildFactIndex(facts)` | function | Pure. Builds the lookup structure `checkFactsTraceability` matches prose against — every fact's own stringified `value` plus its declared `aliases`, verbatim. Never derives a formatted variant nobody wrote down. |
| `isTracedSurfaceForm(index, literal)` | function | `true` when `literal` matches some fact's registered value or alias, exactly. |
| `FactIndex` | type | `{ byKey: Map<string, Fact>; bySurfaceForm: Map<string, string[]> }`. |

### Facts gate (`facts-gate.ts`, `scan.ts`, `cli.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkFactsTraceability(files, facts)` | function | Pure. Scans `files` for claim-shaped prose and evaluates each against `facts`. Never throws. Returns a `FactsGateResult`. |
| `scanStrategyDirectory(root, options?)` | function | The I/O half: walks `root` and reads every file matching `options.extensions` (default `.md`, `.mdx`, `.ts`, `.tsx`, `.js`, `.jsx`) into `ScannedFile[]`. **Fails closed** — throws rather than silently skipping an unreadable directory. |
| `ScannedFile` | type | `{ path: string; content: string }` — one file handed to the gate. |
| `ScanOptions` | type | `{ extensions?: string[]; skipDirs?: string[] }` — `skipDirs` defaults to `node_modules`, `.git`, `dist`, `build`, `coverage`. |
| `FactsGateResult` | type | `{ findings: FactsGateFinding[]; ignored: FactsGateIgnored[]; filesScanned: number; claimsScanned: number }`. |
| `FactsGateFinding` | type | `{ rule: FactsGateRule; severity: "error"; file; line; message; snippet }`. |
| `FactsGateRule` | type | `"untraced-numeric-claim" \| "untraced-superlative-claim" \| "unknown-fact-citation"`. |
| `FactsGateIgnored` | type | `{ file; line; snippet }` — one claim suppressed via `facts-gate:ignore`. |

The `strategy-facts-check` CLI (`bin`, built from `cli.ts`) is documented in
its own section above.

## Non-goal: what this package never derives

This package answers "does this fact exist and does this claim trace to
it" — nothing about how a fact should be rendered, translated, or
formatted for any particular surface (a homepage, a pitch deck, a press
kit). That is a presentation concern for whatever a consumer builds on top;
`checkFactsTraceability` deliberately stops at "traced or not", the same
way `@vespeneventures/policy`'s `verifyBinding` stops at "matches or not"
without ever deciding what should happen next.

## Requirements

Node 20+. ESM only. Runtime dependency: `zod` (schema definition and
validation — the entity contract this package exists to ship).

## Licence

MIT
