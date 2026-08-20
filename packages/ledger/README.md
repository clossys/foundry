# @vespeneventures/ledger

The return path: an append-only record of what was published, to which
channel, when, derived from which revision of strategy, citing which facts —
and a drift checker that answers whether a cited fact still holds, without
ever depending on `@vespeneventures/strategy`.

```bash
npm install @vespeneventures/ledger
```

## Why this package exists

A prior, much larger attempt at this pipeline (strategy → brand → contracts
→ vocabulary → renderers, and a full measurement stack built alongside it)
never connected the two halves. That project's own `strategy` package
stated in its README and `package.json`, as policy: *"the arrow only goes
one way."* Grepping its entire measurement stack for the string `strategy`
returned **zero matches**. The rule itself is correct — brand must derive
from strategy, never the reverse, or the system launders opinion into fact
— but framing the *whole system* as a single arrow is why a return path was
never built at all. Nothing closed the loop from "we published this" back
to "does the thing we claimed still hold?"

`ledger` is that return path. Its discipline is the most important thing
about it, more than any function signature below:

> **It records what happened. It does not judge whether that was good.
> Nothing writes back automatically.**

Concretely:

- **This package does not depend on `@vespeneventures/strategy`.** Every fact
  a `PublicationEntry` cites is a plain, opaque `factRef` string — the same
  seam `@vespeneventures/copy/voice`'s `Claim.factRef`,
  `@vespeneventures/copy`'s `CopyEntry.factRef`, and
  `@vespeneventures/strategy`'s own `Market.factRefs`/`Audience.factRefs`
  already use one layer up. `strategy` is not in this package's
  `dependencies`, and nothing in `src/` imports it. Resolving a `factRef`
  against a real fact registry — reading `strategy`'s `readStrategy` bundle
  and reducing it to `{ [fact.key]: fact.value }` — is a caller's job,
  happening in code this package has no visibility into.
- **`ledger` has no opinion about whether an outcome is good.** There is no
  `score`, `threshold`, or `verdict` field on `PublicationEntry`, and no
  function here computes one. `checkLedgerDrift` answers exactly one
  question — has a cited fact's value changed since publication? — and
  stops there. Whether that drift matters, and what (if anything) to do
  about it, is a decision made by whatever reads this package's output,
  human or agent. This package supplies the evidence, never the verdict.
- **The loop closes through a decision, not an import.** Resist the pull
  toward "and then it could automatically…" — retract the page, alert
  strategy, open a ticket. That temptation is the exact failure this
  design exists to avoid: the moment `ledger` starts acting on drift
  instead of reporting it, it has quietly become a second, unaccountable
  strategy-setting mechanism.

## Usage

### Recording a publication

```ts
import { appendEntry, citeFact, type Ledger, type PublicationEntry } from "@vespeneventures/ledger";

let ledger: Ledger = [];

const entry: PublicationEntry = {
  id: "pricing-page-2026-08-07",
  publishedAt: new Date().toISOString(),
  channel: "web",
  url: "https://example.com/pricing",
  strategyRevision: "strategy@1.4.0",
  factCitations: [citeFact("active-customers", 4200)],
};

ledger = appendEntry(ledger, entry); // returns a NEW, deep-frozen ledger
```

### Checking for drift

```ts
import { checkLedgerDrift } from "@vespeneventures/ledger";
// readStrategy comes from @vespeneventures/strategy — the caller's job, not this package's

const currentValues = { "active-customers": 5000 }; // read from the caller's own facts.json, not from this package

const report = checkLedgerDrift(ledger, currentValues);
if (!report.ok) {
  console.error(`Checked ${report.entriesChecked} entries, ${report.citationsChecked} citations: ${report.citationsDrifted} drifted.`);
  for (const f of report.findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = report.citationsDrifted > 0 ? 1 : 2;
}
```

Or from the shell, once built:

```bash
npx ledger-check ./ledger.json ./current-values.json
```

### Guarding storage against a hand-edit

```ts
import { checkAppendOnly } from "@vespeneventures/ledger";

const findings = checkAppendOnly(previousLedgerJson, nextLedgerJson); // e.g. base ref vs. head ref in a CI job
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
```

Or from the shell, once built — the same `ledger-check` bin `checkLedgerDrift` uses, via its `append-only` subcommand:

```bash
npx ledger-check append-only ./previous-ledger.json ./next-ledger.json
```

## Why append-only

A ledger that can be silently edited after the fact is not evidence — it is
just another opinion with better formatting. This package enforces
append-only two ways, deliberately not one, because it owns no storage of
its own (see "Non-goals" below) and therefore cannot guarantee every write
goes through its own API:

1. **Structurally prevented, in process.** `appendEntry` is the only
   exported way to grow a `Ledger`. There is no `updateEntry` and no
   `removeEntry` anywhere in this package — not stubbed out, not marked
   deprecated, simply never written. `appendEntry` itself refuses (throws)
   to append an entry whose `id` already exists, so the one way this
   package's own API could be asked to "replace" an entry is refused
   outright. Every `Ledger` it returns, and every entry inside it, is
   deep-frozen — because this package ships ESM only (always strict mode),
   an attempt to mutate a returned entry throws a real `TypeError` rather
   than failing silently.
2. **Loudly rejected, at rest.** Nothing stops a ledger stored as, say, a
   JSON file checked into git from being hand-edited directly, bypassing
   `appendEntry` entirely. `checkAppendOnly` is built for exactly that gap:
   given two serialized snapshots of a ledger (a CI job's natural inputs
   are a base ref's copy and a head ref's copy), it fails loudly — a
   `LedgerFinding` per entry removed, reordered, or mutated — the moment
   `next` fails to be a pure, order-preserving superset of `previous`.

Chose **prevent** for in-memory use and **loudly reject** for at-rest use
because this package cannot own storage (see below) — there is no lock it
could hold on a consumer's git repository or database, only a check it can
run against whatever that storage produced.

## Why the drift checker fails closed

The whole point of `checkLedgerDrift` is answering "is this still true?"
honestly — and an honest answer requires being just as clear about *what
was not checked* as about what was. A checker that quietly narrows its own
coverage and reports the narrowed result as a clean pass is a check that
passes while asserting nothing, and this repository has hit that exact
failure mode before. `checkLedgerDrift`'s `DriftReport` always carries
`entriesChecked`/`citationsChecked`/`citationsUnchecked`/`citationsDrifted`
— never just a boolean — and `ok` is `false`, with an explicit finding, for
every one of these:

- The ledger itself does not validate (`"ledger-invalid"`).
- The ledger has zero entries (`"empty-ledger"`) — the literal "nothing to
  check" case.
- The ledger has entries, but zero of their citations end up compared to a
  current value — either every citation lacked a supplied current value,
  or no entry cited any fact at all (`"no-citations-checked"`). This is the
  harder case: a *non-empty* ledger that still verified nothing, and the
  one a naive `ok: citationsDrifted === 0` implementation would silently
  report as clean.

A citation with no current value supplied is still reported
(`"fact-unchecked"`, `"warning"`) but does not by itself flip `ok` to
`false` — a caller with partial `currentValues` coverage gets an honest
partial result, visible in the counts, not an all-or-nothing gate.

## Non-goals

- **No I/O.** Every function in this package — `validateEntry`,
  `validateLedger`, `canonicalizeValue`, `citeFact`, `appendEntry`,
  `checkAppendOnly`, `checkLedgerDrift` — is pure. This package does not
  read a file, does not know what a real ledger's storage looks like (a
  JSON file, a database row, a git-committed document), and does not
  decide where a `Ledger` lives long-term. Only `cli.ts` (not part of the
  library's exported surface — see the API table) does any filesystem
  work, and only to read the two JSON files `ledger-check` is pointed at.
- **No fact registry.** This package never resolves a `factRef` against
  anything. It does not know what a real fact is, does not validate that a
  `factRef` names one that exists, and does not import
  `@vespeneventures/strategy` to find out. See "Why this package exists"
  above.
- **No judgement.** `checkLedgerDrift` reports drift; it does not decide
  whether drift matters, does not retract anything, does not notify
  anyone, and does not write anything back to a ledger or to strategy. Any
  of those is a decision for the human or agent reading this package's
  output to make deliberately, not something this package should do on
  its own initiative.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `PublicationEntry` | type | One append-only record: `id`, `publishedAt` (ISO 8601 instant), `channel` (a plain string — not `@vespeneventures/surface/core`'s closed `Channel` vocabulary; a real publication channel is broader than surface's five render targets), optional `url`, `strategyRevision` (an opaque string naming the revision of strategy this was derived from), `factCitations: FactCitation[]`, and an optional `contentBinding: PolicyBinding` committing to the published artifact's own bytes. No score, threshold, or verdict field — see "Why this package exists". |
| `FactCitation` | type | `{ factRef: string; valueBinding: PolicyBinding }` — one fact a `PublicationEntry` cites, bound to that fact's value at publication time. `factRef` is opaque, the same seam `@vespeneventures/copy/voice`'s `Claim.factRef` uses. `valueBinding.policyId` always equals `factRef`, enforced by `validateEntry`'s `"citation-policy-id-mismatch"` rule and by construction in `citeFact`. |
| `Ledger` | type | `readonly PublicationEntry[]` — nothing more than an ordered, append-only list. |
| `LedgerFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — this package's own finding shape, deliberately the same shape as `@vespeneventures/controller/policy`'s `Finding` (kept as a separate local type, never pulled in from there) and every sibling `*Finding` type across this foundation. |
| `DriftReport` | type | What `checkLedgerDrift` returns: `ok`, `entriesChecked`, `citationsChecked`, `citationsUnchecked`, `citationsDrifted`, `findings: LedgerFinding[]`. See "Why the drift checker fails closed". |
| `PolicyBinding` | type | Re-exported directly from `@vespeneventures/controller/policy`, unchanged, so a consumer never needs its own dependency on `policy` just to read the type `FactCitation.valueBinding`/`PublicationEntry.contentBinding` return. |
| `DigestAlgorithm` | type | Re-exported from `@vespeneventures/controller/policy` — currently just `"sha256"`. |
| `PolicyFinding` | type | `@vespeneventures/controller/policy`'s own `Finding` type, re-exported under a name that does not collide with this package's own `LedgerFinding` when both are named in one statement. |
| `validateEntry(value, path?)` | function | Structural validation of a single `PublicationEntry`: is `id`/`channel`/`strategyRevision` a non-empty string, is `publishedAt` a full ISO 8601 UTC instant, is `url` (when present) a parseable URL, is every `factCitations[i]` a well-formed `FactCitation` (delegating the `valueBinding` shape check to `@vespeneventures/controller/policy`'s own `validateBindingShape`), is `contentBinding` (when present) a well-formed `PolicyBinding`. Returns `LedgerFinding[]`; empty means valid. Never throws. |
| `validateLedger(value)` | function | Validates a whole `Ledger`: must be an array, every element must pass `validateEntry`, every `id` must be unique across the array (`"duplicate-entry-id"` — what an attempted overwrite looks like when it bypasses `appendEntry`). An empty array is a valid *shape* — `validateLedger([])` returns `[]`; `checkLedgerDrift` is what treats an empty ledger as a failure, since "is this ledger well-formed" and "did this check verify anything" are different questions. |
| `canonicalizeValue(value)` | function | Deterministically stringifies a JSON-serializable `value` (string, finite number, boolean, `null`, plain object, array — recursively) so that structurally equal values always canonicalize identically regardless of object-key order. Used by `citeFact` (to digest a fact's value) and `checkAppendOnly` (to compare two entries for real content equality, not just reference equality). Throws on a non-finite number, a function, or a `Symbol` — a producer-side error, the same precedent `@vespeneventures/controller/policy`'s `computeDigest` sets for an unsupported algorithm. |
| `citeFact(factRef, value, algorithm?)` | function | Builds a `FactCitation`: computes `canonicalizeValue(value)`'s digest under `algorithm` (default `"sha256"`) via `@vespeneventures/controller/policy`'s own `computeDigest`, and returns `{ factRef, valueBinding: { policyId: factRef, digestAlgorithm, digest } }`. This package's first real use of `@vespeneventures/controller/policy` outside `policy` itself. Throws on an empty `factRef` or a `value` `canonicalizeValue` cannot handle. |
| `appendEntry(ledger, entry)` | function | The one sanctioned way to grow a `Ledger`. Throws (never returns a `LedgerFinding[]`) on a malformed `entry` or an `entry.id` that already exists in `ledger` — both are caller programming errors at the point of the call, the same distinction `computeDigest` draws. Returns a **new**, deep-frozen `Ledger`; `ledger` itself, and every entry already in it, is left completely untouched. |
| `checkAppendOnly(previous, next)` | function | The at-rest complement to `appendEntry`. Pure diff between two `unknown` values, each validated with `validateLedger` first. Reports `"entry-removed"`, `"entry-reordered"`, or `"entry-mutated"` (compared via `canonicalizeValue`, so a harmless JSON-key-order round-trip is never mistaken for a real change) for anything in `previous` that `next` fails to preserve exactly, in the same position; `"entries-removed"` once, up front, if `next` has fewer entries than `previous`. An empty return means `next` is a valid append-only evolution of `previous`. |
| `checkLedgerDrift(ledger, currentValues)` | function | The drift checker: for each `FactCitation` in `ledger`, compares its recorded `valueBinding` against `currentValues[citation.factRef]` (canonicalized, then run through `@vespeneventures/controller/policy`'s own `verifyBinding` — no digest-comparison logic reimplemented here) and reports a `"fact-drift"` finding on mismatch. `currentValues` is a plain `factRef -> value` map — this function never reads a real fact registry or depends on `@vespeneventures/strategy`. Fails closed on an invalid ledger, an empty ledger, or a non-empty ledger where nothing ends up checked — see "Why the drift checker fails closed". |

`ledger-check` (the CLI, installed as a `bin` when this package is
installed — its argv-handling `cli.ts` is deliberately not part of the
exports above, the same convention `@vespeneventures/strategy`'s
`strategy-facts-check` and `@vespeneventures/copy`'s `copy-check` already
set) has two invocations, dispatched on the literal first `argv` token —
never on the invoked binary's path or filename, since this repository
always invokes a gate by its compiled path (`node .../dist/cli.js`), and a
filename-keyed dispatch would always see `cli.js`:

The default (no subcommand) invocation reads a ledger JSON file and a
current-values JSON file, runs `checkLedgerDrift`, and prints a report:

```bash
npx ledger-check ./ledger.json ./current-values.json
```

Exit codes: `0` clean (something was checked, nothing drifted), `1` at
least one cited fact has drifted, `2` could not run — bad arguments, a file
missing/unreadable/not valid JSON, an invalid or empty ledger, or a ledger
whose citations could not be compared against any current value. `1` and
`2` are kept strictly distinct on purpose: "found a real problem" and
"could not check" must never look like the same failure to a CI job
branching on the exit code.

The **`append-only` subcommand** reads two ledger JSON files — a
`previous` and a `next`, e.g. a base ref's copy and a head ref's copy in a
CI job — and runs `checkAppendOnly`:

```bash
npx ledger-check append-only ./previous-ledger.json ./next-ledger.json
```

Exit codes follow the same three-state shape: `0` — `next` verified as a
valid, order-preserving append-only evolution of `previous`, over at least
one entry in `previous`; `1` — a real violation (an entry in `previous` was
removed, reordered, or mutated in `next`); `2` — could not evaluate — bad
arguments, a file missing/unreadable/not valid JSON, either ledger failing
its own shape validation, or `previous` having zero entries. Zero entries
is deliberately its own `2`, not folded into `0`: `checkAppendOnly` reports
no findings at all for an empty `previous` (there is nothing in it that
could have been altered), so the CLI checks `previous`'s entry count itself
rather than treating "no findings" alone as proof anything was verified —
"checked nothing" and "checked everything and it held" must stay
distinguishable, the same discipline `checkLedgerDrift`'s empty-ledger case
already holds this CLI to above.

## Requirements

Node 20+. ESM only. Runtime dependency: `@vespeneventures/controller` (pinned
`~0.7.0` — a tilde range, deliberately not a caret; a caret range on a
`0.x` package is patch-only under semver and has broken this repository's
CI before), of which this package only imports the `./policy` subpath —
`@vespeneventures/controller/policy` — never the package's other exports.
No other runtime dependencies.

## Licence

MIT
