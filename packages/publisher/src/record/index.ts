/**
 * @vespeneventures/publisher/record — the return path.
 *
 * A prior 40-package attempt at this pipeline (strategy → brand →
 * contracts → vocabulary → renderers, plus a full measurement stack built
 * alongside it) never connected the two halves: its own `strategy`
 * package's README and `package.json` stated, as policy, "the arrow only
 * goes one way," and grepping its entire measurement stack for the string
 * `strategy` returned zero matches. The one-way rule is correct for
 * DERIVATION — brand must derive from strategy, never the reverse, or the
 * system launders opinion into fact — but treating the whole system as a
 * single arrow is why a return path was never built at all.
 *
 * This package is that return path, and its discipline is load-bearing
 * enough to restate here, not just in a README a consumer might skip:
 *
 *   IT RECORDS. IT DOES NOT JUDGE. NOTHING WRITES BACK AUTOMATICALLY.
 *
 * Concretely:
 *
 *   - This package does NOT import `@vespeneventures/strategy`. Every fact
 *     a `PublicationEntry` cites is a plain, opaque `factRef` string — the
 *     exact seam `@vespeneventures/writer/voice`'s `Claim.factRef` and
 *     `@vespeneventures/writer`'s `CopyEntry.factRef` already use one layer
 *     up. `strategy` never appears in this package's `dependencies`, and
 *     nothing in `src/` imports it — see `README.md`'s "Why this package
 *     never imports strategy" for the fuller argument.
 *   - There is no score, threshold, or verdict anywhere in this package's
 *     types or its checks. `checkLedgerDrift` (`drift.ts`) answers exactly
 *     one question — has a cited fact's value changed since publication? —
 *     and stops there. Whether that drift matters, and what to do about
 *     it, is a decision for whatever reads this package's output, human or
 *     agent, never a computation this package performs on its own.
 *   - `appendEntry` (`append.ts`) is the only way to grow a `Ledger` in
 *     process, and it has no counterpart named `updateEntry` or
 *     `removeEntry` anywhere in this file. `checkAppendOnly`
 *     (`append-only-gate.ts`) is the complementary at-rest check for
 *     whatever storage a ledger actually lives in.
 *
 * `@vespeneventures/controller/policy`'s `PolicyBinding`/`computeDigest`/
 * `validateBindingShape`/`verifyBinding` are reused directly throughout
 * this package (`FactCitation.valueBinding`, `PublicationEntry.contentBinding`,
 * `fact.ts`'s `citeFact`, `drift.ts`'s `checkLedgerDrift`) rather than
 * reimplemented — the same content-addressed binding mechanism `policy`
 * already built for a denylist document, applied here to a fact's value at
 * a moment in time.
 */

export type { DigestAlgorithm, Finding as PolicyFinding, PolicyBinding } from "@vespeneventures/controller/policy";

export type { FactCitation, Ledger, LedgerFinding, PublicationEntry } from "./types.js";

export { validateEntry, validateLedger } from "./schema.js";

export { canonicalizeValue, citeFact } from "./fact.js";

export { appendEntry } from "./append.js";

export { checkAppendOnly } from "./append-only-gate.js";

export { checkLedgerDrift } from "./drift.js";
export type { DriftReport } from "./drift.js";

export { checkJoinKeyCompleteness } from "./join-key.js";
export type { JoinKeyIdentity, JoinKeyReport } from "./join-key.js";
