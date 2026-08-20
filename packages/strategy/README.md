# @vespeneventures/strategy

Upstream strategy machinery: mission, positioning, markets, audiences,
roadmap, and brand, plus `facts` — the single place every number and named
claim a product states publicly should trace back to. This package ships
the schema, a typed reader, a facts-traceability gate, and a brand-coverage
checker. It does not ship anyone's actual mission statement, market
sizing, numbers, or brand attributes.

```bash
npm install @vespeneventures/strategy
```

## Scope: this package is strategy records AND brand derivation

Before anything else: `strategy` is not only mission/positioning/markets/
audiences/roadmap/facts. It also owns the brand layer —
`BrandEssence`, `BrandAttribute`, `BrandDerivation`, and
`checkBrandCoverage`. Someone scoping an adoption around the package name
alone can miss that second half and leave it stranded, expecting a separate
`brand` package that doesn't exist. It doesn't exist on purpose: strategy
and brand are one package because splitting them would either duplicate or
break a seam this package depends on to stay dependency-free.

The seam: `BrandDerivation` names token slots (`"--color-accent-primary"`)
and voice rules by **plain string only**, never by a typed import of
`@vespeneventures/ui/tokens` or `@vespeneventures/copy/voice` — the exact
discipline `Market.factRefs`/`Audience.factRefs` already use elsewhere in
this package (see `brand-derivation.ts`'s header comment). That name-only
seam is what lets this package ship with **zero runtime dependencies**:
importing `tokens` here to validate a slot name for real would mean every
consumer of `strategy` who has never touched brand tokens now resolves
`tokens`' own dependency tree too. A standalone `brand` package would have
had to either duplicate that same seam (and its zero-dependency
justification) or give it up and import `tokens`/`voice` directly. See "Why
brand lives here, not in its own package" below for the full account.

## What this package is, and is not

The split here mirrors `@vespeneventures/ui/tokens`' own README ("The
three-layer contract"): that package ships a greyscale token contract and
lets each consumer bind its own brand on top; this package ships an entity
schema and a checker, and lets each consumer author its own strategy
content. Four different products can depend on this package and state four
completely different missions, markets, and facts — nothing here decides
what any of them says.

**What ships here:** hand-rolled, dependency-free entity validators
(`validateFact`, `validateMission`, `validatePositioning`, `validateMarket`,
`validateAudience`, `validateRoadmapItem`, `validateBrandEssence`,
`validateBrandAttribute`, and their whole-file `*s`/`*Items`/`*Attributes`
counterparts), a typed reader (`readStrategy`) that loads and validates a
consumer's own strategy directory, a facts-traceability gate
(`checkFactsTraceability`) that scans prose and copy for claims that don't
trace back to a real fact, and a brand-coverage checker
(`checkBrandCoverage`) that verifies a brand's `BrandDerivation`s fully
account for a consumer's brandable token slots, in both directions.

Validation here is hand-rolled on purpose, not built on a schema library:
`@vespeneventures/catalog`, `@vespeneventures/policy`, and
`@vespeneventures/ui/tokens` all ship with **zero** runtime dependencies, and
this package's own pitch — "pure data + validation, safe to install" — is
only really true if installing it doesn't also mean resolving a schema
library's own major version into a consumer's tree. `validation.ts` follows
`@vespeneventures/policy`'s own `validate.ts` precedent: plain type guards
over `unknown`, an accumulated issue list, never throws.

## Governed strategy contract

`StrategyContract` is the stable handoff for a product's governed strategy.
It is intentionally distinct from the file-oriented reader below. The reader
validates a consumer's local authoring files; the contract is the normalized,
directory-independent payload handed to downstream systems. A consumer may
adapt one into the other, but they are not competing sources of truth and
neither API silently reads or writes the other.

Every record has a kebab-case `id`, semantic-version `revision`, and source
`provenance`. The contract covers `product`, `brand`, `audience`,
`positioning`, `claim`, `evidence`, and `constraint` records. Validation
checks duplicate ids, conflicting product/claim keys, invalid revisions,
and every cross-record reference.

```ts
import {
  createStrategyProvenance,
  getApprovedClaims,
  validateStrategyContract,
  type StrategyContract,
} from "@vespeneventures/strategy";

const contract: StrategyContract = {
  id: "example-strategy",
  revision: "1.0.0",
  provenance: { source: "research-register", recordedAt: "2026-08-11" },
  records: [
    {
      kind: "product", id: "example", revision: "1.0.0",
      provenance: { source: "research-register", recordedAt: "2026-08-11" },
      name: "Example", summary: "A fictional product used in documentation.",
    },
    {
      kind: "evidence", id: "interview-round-one", revision: "1.0.0",
      provenance: { source: "research-register", recordedAt: "2026-08-11" },
      productId: "example", evidenceKind: "research",
      statement: "Participants described the workflow as difficult to coordinate.",
    },
    {
      kind: "claim", id: "clearer-workflow", revision: "1.0.0",
      provenance: { source: "research-register", recordedAt: "2026-08-11" },
      productId: "example", claimKey: "clearer-workflow",
      assertion: "Example makes the workflow easier to understand.",
      status: "approved", evidenceIds: ["interview-round-one"],
      approval: { approvedBy: "strategy-review", approvedAt: "2026-08-11" },
    },
  ],
};

const result = validateStrategyContract(contract);
if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));

// Copy authors may use governed inputs; hypotheses are excluded here.
const approvedClaims = getApprovedClaims(result.value);
// An output manifest can carry this without importing consumer-specific files.
const provenance = createStrategyProvenance(result.value, approvedClaims.map((claim) => claim.id));
```

`EvidenceRecord` holds observed facts or research separately from an
audience-facing assertion. Only `ApprovedClaimRecord` has an approval and
requires at least one evidence id; `HypothesisClaimRecord` remains visibly
unapproved. `ConstraintRecord` may guide copy or a surface, but it contains
plain product-owned instruction text—not renderer configuration, token
names, or a dependency on `ui`, `copy`, or `surface`.

`serializeStrategyContract(contract)` canonicalizes record/reference order;
`createStrategyProvenance(contract)` derives its SHA-256 fingerprint from
that serialization. These are reproducibility aids, not signatures or a
mechanism for approving claims automatically.

The governed-contract API exports `STRATEGY_RECORD_KINDS`,
`validateStrategyContract`, `getApprovedClaims`,
`serializeStrategyContract`, and `createStrategyProvenance`. Its data types
are `StrategyContract`, `StrategyProvenance`, `StrategyRecord`,
`StrategyRecordKind`, `StrategyRecordBase`, `StrategyRecordReference`,
`RecordProvenance`, `ProductRecord`, `BrandRecord`, `AudienceRecord`,
`PositioningRecord`, `ClaimRecord`, `ClaimStatus`, `ApprovedClaimRecord`,
`ApprovedClaimApproval`, `HypothesisClaimRecord`, `EvidenceRecord`,
`EvidenceKind`, `ConstraintRecord`, `ConstraintKind`, and
`ConstraintTarget`.

**What does not ship here:** any real company's mission, vision, values,
positioning, market sizing, audience research, roadmap, facts, brand
essence, brand attributes, or brand derivations. Every example in this
README and in this package's own tests is a fictional product
("Widgetronic") invented for illustration.

### Why brand lives here, not in its own package

A standalone `brand` package was planned and cancelled. Once the content
this package already owns is set aside — `Mission`'s `values:
OperatingValue[]` is already brand values (its own doc comment: "the
decision this value forces when two paths look equally good. Operational,
not a slogan.") — a separate `brand` package would have been a thin record
with no reader: exactly the shape of this repository's own retired `icons`
package. `BrandEssence` and `BrandAttribute` (below) are siblings of
`OperatingValue` for the same reason `Mission`, `Positioning`, `Market`,
`Audience`, and `RoadmapItem` are: one small, hand-rolled, dependency-free
schema family, all validated the same way.

## Directory shape a consumer authors

`readStrategy` expects a directory shaped like this. Every file is optional
except `facts.json` — see "Why facts.json is the one required file" below.

```
strategy/
  facts.json                required — an array of Fact
  mission.json                optional — a Mission
  positioning.json             optional — a Positioning
  markets.json                    optional — an array of Market
  audiences.json                    optional — an array of Audience
  roadmap.json                        optional — an array of RoadmapItem
  brand-essence.json                     optional — a BrandEssence
  brand-attributes.json                     optional — an array of BrandAttribute
  brand-derivations.json                       optional — an array of BrandDerivation
```

The three `brand-*.json` names follow the same convention as everything
above them: a singular document gets a singular file name
(`brand-essence.json`, next to `mission.json`/`positioning.json`), and a
whole array of one entity gets that entity's own plural file name
(`brand-attributes.json`/`brand-derivations.json`, next to
`markets.json`/`audiences.json`/`roadmap.json`) — not one combined
`brand.json`, which would be a second, parallel convention invented for
just this entity family.

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
data — a missing `facts.json`, invalid JSON, a shape violation — is
recorded into `bundle.issues` and reflected in `bundle.complete`, the same
discipline `@vespeneventures/catalog`'s `buildCatalog` holds to for its own
`Catalog.skipped`. `complete` is `true` only when `facts.json` itself
validated AND every other file that exists on disk also validated — the
three brand files included: an absent `brand-essence.json`/
`brand-attributes.json`/`brand-derivations.json` costs nothing, but a
present-and-invalid one flips `complete` to `false` and lands in
`bundle.issues` exactly like a bad `mission.json` would.

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

### `strategy-facts-check brand-coverage` — the second subcommand

`checkBrandCoverage` (below) is a library function — it was reachable only
by writing TypeScript against this package, unlike the facts gate above,
which ships as an installable CLI. This subcommand closes that gap without
adding a second `bin` entry or importing `@vespeneventures/ui/tokens`:

```bash
npx strategy-facts-check brand-coverage ./brand-derivations.json ./brandable-slots.json
```

```
Usage: strategy-facts-check brand-coverage <derivations-file> <brandable-slots-file>

  derivations-file      Path to a JSON file containing an array of BrandDerivation objects. Required.
  brandable-slots-file  Path to a JSON file containing an array of brandable token-slot name strings. Required.

Options:
  --help                 Print this message and exit 0.
```

`derivations-file` is the JSON serialization of a `BrandDerivation[]` (see
"The brand layer" below) — the same shape `readStrategy` loads from a real
`brand-derivations.json`. `brandable-slots-file` is a plain JSON array of
non-empty strings: the caller-supplied `brandableSlots` list
`checkBrandCoverage` takes as its seam (this package still never imports
`@vespeneventures/ui/tokens` — a consumer collects that list itself, e.g.
`Object.values(TOKENS).filter(t => t.brandable).map(t => t.property)`, and
writes it to a file this subcommand reads).

Exit codes map `checkBrandCoverage`'s own three-state result directly —
note this is **not** the same 0/1/2 meaning as the facts-check exit codes
above, because `checkBrandCoverage`'s own ternary is different:

| Code | Meaning |
| --- | --- |
| `0` | Both directions hold on non-empty lists — every brandable slot has a derivation, and every derivation names a real slot. |
| `1` | A real coverage gap in either direction (`checkBrandCoverage`'s `reason: "coverage-gap"`). |
| `2` | **Indeterminate** — bad input, a file missing/unreadable/unparseable/schema-invalid, an empty `brandable-slots-file`, or empty `derivations-file`. Never `0` and never `1`: an empty list either way means nothing was actually compared, which `checkBrandCoverage` fails closed on rather than reporting as a vacuous pass — see its own "Fails closed" doc comment (`src/brand-derivation.ts`). |

## The brand layer

Two entities, plus a derivation, plus a checker — the same shape the facts
gate above uses (schema, then something that makes the schema worth
having).

```ts
interface BrandEssence {
  statement: string; // one line, present tense — what the brand IS
}

interface BrandAttribute {
  name: string;
  description: string;
  evidence: {
    basis: string;     // REQUIRED — the actual reason this is true, not a vibe
    factRef?: string;  // OPTIONAL — a Fact.key, when the basis is fact-shaped
  };
}
```

### Why `evidence` has two fields, not one

`evidence.basis` is required prose: a decision, a build choice, an observed
pattern, a founder's stated rule — whatever actually makes the attribute
true. It's required because an attribute with no basis at all is exactly a
vibe: a word chosen because it sounds good. `evidence.factRef` is an
optional, opaque string naming a `Fact.key` — the same seam
`@vespeneventures/copy/voice`'s `Claim.factRef` and this package's own
`Market.factRefs`/`Audience.factRefs` already use: a plain string, never
validated against a real `facts.json` here, never a typed import.

A `factRef`-only design would force every brand attribute to be backed by
a registered fact, corrupting the facts registry with entries invented
only to satisfy this schema. A `basis`-only design would accept a
well-written vibe with nothing checkable behind it — the exact failure
this entity exists to rule out. Requiring `basis` always, and allowing
`factRef` as an additional pointer into the one registry this package can
actually check something against, gets real evidence every time and
traceable evidence whenever that's honestly possible.

### `BrandDerivation` — turning an attribute into an obligation

A `BrandAttribute` is a record. `BrandDerivation` is what makes it earn its
keep: what a given attribute implies for named visual token slots and
named voice rules.

```ts
interface BrandDerivation {
  attribute: string;     // a BrandAttribute.name, by plain string
  tokenSlots: string[];  // CSS custom property names, e.g. "--color-accent-primary"
  voiceRules: string[];  // a consumer's own voice rule ids
  rationale: string;     // what about the attribute forces these slots/rules
}
```

`tokenSlots` and `voiceRules` are named by **plain string only** — this
package never depends on the tokens or voice packages of this
scope. That mirrors the `factRef` seam above and keeps all three packages
decoupled: a consumer that has never touched brand tokens can still
install `strategy` without resolving the tokens package's own dependency
tree. A derivation must name at least one `tokenSlots` or `voiceRules`
entry — one naming neither implies nothing, and isn't a derivation.

### `checkBrandCoverage` — the seam, and both directions

```ts
import { checkBrandCoverage } from "@vespeneventures/strategy";

// TOKENS comes from the consumer's own tokens dependency — NOT imported by
// this package. See the paragraph below for why.
const brandableSlots = Object.values(TOKENS)
  .filter((def) => def.brandable)
  .map((def) => def.property);

const result = checkBrandCoverage(brandableSlots, derivations);
if (!result.ok) {
  console.error(result.reason, result.slotsMissingDerivation, result.unknownSlotsInDerivations);
}
```

Because this package cannot import `tokens` to look up which slots are
brandable, `checkBrandCoverage` takes that list as its first argument. This
is a deliberate seam, not a missing feature: the caller — a consumer
repository that depends on both `strategy` and `tokens`, or a later
cross-package gate with visibility into both — is the one place that can
close it for real.

The check itself runs in **both directions**, exactly like
`@vespeneventures/ui/tokens`' own `brand-coverage.test.ts`:

1. Every slot in `brandableSlots` is named by at least one derivation's
   `tokenSlots` (`result.slotsMissingDerivation` otherwise).
2. Every slot named by some derivation's `tokenSlots` is actually in
   `brandableSlots` (`result.unknownSlotsInDerivations` otherwise — a
   stale or typo'd reference).

**Fails closed on both degenerate inputs**, never a vacuous pass: an empty
`brandableSlots` (`reason: "no-slots-provided"`) or an empty `derivations`
(`reason: "no-derivations-provided"`) is `ok: false`, and `slotsChecked` /
`derivationsChecked` are always present in the result — specifically so
"zero things were checked" can never be mistaken for "everything checked
out clean" by a caller that only glances at `ok`.

## API

### Entities (`schema.ts`)

Every `validate*` function has the same shape: `(value: unknown) =>
{ ok: true; value: T } | { ok: false; issues: ValidationIssue[] }` (see
`ValidationResult`/`Validator` in "Validation primitives" below). None of
them throw.

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateFact(value)` | function | One `Fact`: `key`, `label`, `value`, optional `unit`/`asOf`/`verifiedBy`/`aliases`, required `source` and `lastUpdatedAt`. |
| `validateFacts(value)` | function | The whole contents of a `facts.json` file — `Fact[]`, additionally rejecting a duplicate `key`. |
| `validateMoney(value)` | function | `{ amount: number; currency: string }` — an ISO 4217 code. A monetary `Fact.value` is always this shape, never a bare number. |
| `validateMission(value)` | function | `{ statement, vision, values: OperatingValue[] }`. |
| `validatePositioning(value)` | function | The classic positioning-statement fields: `productName`, `category`, `forWhom`, `weAre`, `unlike`, `reasonToBelieve`. |
| `validateMarket(value)` / `validateMarkets(value)` | function | One market / an array of markets. `factRefs?: string[]` names `Fact.key`s this market's sizing claims trace to (not cross-checked against a live facts set here). |
| `validateAudience(value)` / `validateAudiences(value)` | function | One audience / an array of audiences. `painPoints?: string[]`, `factRefs?: string[]`. |
| `validateRoadmapItem(value)` / `validateRoadmapItems(value)` | function | One roadmap item / an array of them. `status` is the closed vocabulary in `ROADMAP_STATUSES`. |
| `ROADMAP_STATUSES` | const | `readonly RoadmapStatus[]` — `["now", "next", "later", "shipped"]`, in the order a new status would be added. Mirrors `@vespeneventures/policy`'s own `DIGEST_ALGORITHMS`. |
| `validateBrandEssence(value)` | function | `{ statement }` — the irreducible one-line statement of what the brand is. |
| `validateBrandAttribute(value)` / `validateBrandAttributes(value)` | function | One brand attribute / an array of them. `evidence: { basis: string; factRef?: string }` — see "The brand layer" above for why both fields exist. |
| `Fact`, `Money`, `Mission`, `OperatingValue`, `Positioning`, `Market`, `Audience`, `RoadmapItem`, `RoadmapStatus`, `BrandEssence`, `BrandAttribute`, `BrandEvidence` | types | Plain TypeScript interfaces/unions — the shape each `validate*` function above checks and returns on success. |

### Validation primitives (`validation.ts`)

The shared, dependency-free primitives every validator above is built
from — most consumers never need these directly, but they're exported for
anyone extending this package with their own entity.

| Export | Kind | Purpose |
| --- | --- | --- |
| `ValidationIssue` | type | `{ path: string; message: string }` — one thing a validator found wrong. `path` is absolute, e.g. `"values[0].rule"`, or `"(root)"` for a whole-value shape problem. |
| `ValidationResult<T>` | type | `{ ok: true; value: T } \| { ok: false; issues: ValidationIssue[] }`. |
| `Validator<T>` | type | `(value: unknown) => ValidationResult<T>` — the shape every exported `validate*` function above satisfies, and the type `reader.ts` accepts internally. |

### Reader (`reader.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `readStrategy(root)` | function | Reads and validates a strategy directory (see "Directory shape" above). The package's one deliberate I/O surface. Never throws — see `StrategyBundle.issues`/`complete`. |
| `StrategyBundle` | type | `{ root, facts, mission?, positioning?, markets?, audiences?, roadmap?, brandEssence?, brandAttributes?, brandDerivations?, issues, complete }`. |
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

### Brand derivation and coverage (`brand-derivation.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateBrandDerivation(value)` / `validateBrandDerivations(value)` | function | One `BrandDerivation` / an array of them. Rejects a derivation naming neither a `tokenSlots` nor a `voiceRules` entry. |
| `checkBrandCoverage(brandableSlots, derivations)` | function | Pure. Checks, in both directions, whether `derivations` fully accounts for `brandableSlots`. Fails closed (`ok: false`) on either input being empty — see "The brand layer" above. Never throws. |
| `BrandDerivation` | type | `{ attribute, tokenSlots: string[], voiceRules: string[], rationale }`. |
| `BrandCoverageResult` | type | `{ ok, slotsChecked, derivationsChecked, slotsMissingDerivation: string[], unknownSlotsInDerivations: string[], reason? }`. |
| `BrandCoverageFailureReason` | type | `"no-slots-provided" \| "no-derivations-provided" \| "coverage-gap"`. |

## Non-goal: what this package never derives

This package answers "does this fact exist and does this claim trace to
it" — nothing about how a fact should be rendered, translated, or
formatted for any particular surface (a homepage, a pitch deck, a press
kit). That is a presentation concern for whatever a consumer builds on top;
`checkFactsTraceability` deliberately stops at "traced or not", the same
way `@vespeneventures/policy`'s `verifyBinding` stops at "matches or not"
without ever deciding what should happen next.

`checkBrandCoverage` draws the identical line: it answers "does a
derivation exist for this slot, and does every named slot actually exist"
— nothing about whether a `tokenSlots` name is spelled correctly against a
REAL `@vespeneventures/ui/tokens` release, whether a `voiceRules` id resolves
to a real `@vespeneventures/copy/voice` glossary entry, or what value either
should actually be bound to. Resolving those names against the real
packages they name is a later, cross-package gate's job — one with
visibility into `tokens` and/or `voice` that this package deliberately does
not have. See "The brand layer" above for the seam.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
