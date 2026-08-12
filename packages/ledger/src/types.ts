/**
 * Entity shapes for `@vespeneventures/ledger`. Pure data — no I/O, no
 * validation logic (see `schema.ts`), nothing about how a consumer actually
 * stores its ledger on disk.
 *
 * See `index.ts`'s top-level doc comment for the return-path argument this
 * whole package exists to make concrete. In shape terms: a `PublicationEntry`
 * answers *what was published, to which channel, when, derived from which
 * revision of strategy, citing which facts* — and nothing about whether any
 * of that was good. There is no `score`, `verdict`, or `status` field on
 * this entity, and there never should be one: judging an outcome is a human
 * or agent decision that reads a ledger, not a fact this package records.
 */

import type { PolicyBinding } from "@vespeneventures/policy";

/**
 * One fact a `PublicationEntry` cites, bound to that fact's value at the
 * moment of publication — never the value itself.
 *
 * `factRef` is a plain, opaque string identifying a fact — never a typed
 * import of `@vespeneventures/strategy`'s `Fact`. This is the exact same
 * seam `@vespeneventures/copy/voice`'s `Claim.factRef`,
 * `@vespeneventures/copy`'s `CopyEntry.factRef`, and
 * `@vespeneventures/strategy`'s own `Market.factRefs`/`Audience.factRefs`
 * already use: the coupling is a string convention two sides happen to
 * agree on, not a code dependency, so this package works whether or not
 * `strategy` is even installed, and resolving `factRef` against a real
 * fact registry is the caller's job (typically the same caller that already
 * has `strategy`'s `readStrategy` in scope) — this package deliberately
 * does not have that visibility.
 *
 * `valueBinding` is a `PolicyBinding` reused directly from
 * `@vespeneventures/policy`, not reimplemented: `policyId` is set to
 * `factRef` by construction (see `schema.ts`'s `"citation-policy-id-mismatch"`
 * rule), so a reader looking at one field never has to cross-reference the
 * other to know what the binding is about, and `digest` commits to the
 * fact's *value* — canonicalized via `canonicalizeValue` (`fact.ts`) — at
 * the moment this citation was recorded. See `fact.ts`'s `citeFact` for the
 * one sanctioned way to build one of these.
 */
export interface FactCitation {
  factRef: string;
  valueBinding: PolicyBinding;
}

/**
 * One append-only record: this document, on this channel, at this instant,
 * derived from this revision of strategy, citing these facts (each bound to
 * its value at that instant). See `append.ts`'s `appendEntry` for the one
 * sanctioned way to add one of these to a `Ledger`, and `README.md`'s
 * "Why append-only" section for why there is no corresponding "update" or
 * "remove" operation anywhere in this package.
 */
export interface PublicationEntry {
  /** Unique within a `Ledger`. Opaque to this package — a UUID, a ULID, a slug, whatever a caller's own system already generates. */
  id: string;
  /** ISO 8601 instant, e.g. `"2026-08-07T14:03:00.000Z"` — when this entry was recorded, not necessarily when the artifact went live (a caller backfilling a historical publication records both honestly; this package does not distinguish the two). */
  publishedAt: string;
  /**
   * Where this was published. A plain, non-empty string — deliberately
   * **not** `@vespeneventures/surface/core`'s closed `Channel` vocabulary
   * (`"web" | "email" | "print" | "slides" | "image"`). This package has no
   * dependency on `surface`, and a real publication channel is broader than
   * surface's five render targets — a press release, a single investor
   * update, a sales deck sent to one prospect are all channels a ledger
   * should be able to record without this package needing to know about
   * them in advance.
   */
  channel: string;
  /** Where the published artifact can be found, if it has one stable address. Optional — not every channel produces a URL (a PDF emailed to one person, a slide deck presented live). */
  url?: string;
  /**
   * Which revision of strategy this entry was derived from. A plain, opaque
   * string — a git SHA, a version tag, a content digest a caller computed
   * itself — never validated or interpreted by this package, the same
   * `policyId`-style opaqueness `@vespeneventures/policy`'s own binding
   * uses. This package does not import `@vespeneventures/strategy`, so it
   * has no way to check that this string names a revision that ever
   * existed; recording an honest value is the caller's responsibility.
   */
  strategyRevision: string;
  /**
   * Every fact the published artifact cited, each bound to its value at
   * publication time. May be empty: a publication can make zero fact-shaped
   * claims (a pure design refresh, say) and still be worth recording. An
   * empty array here is a fact about that specific entry, not a defect —
   * see `drift.ts`'s `checkLedgerDrift` for why a *ledger* where every
   * entry cites nothing still fails closed rather than reporting "clean".
   */
  factCitations: FactCitation[];
  /**
   * Optional content-addressed binding to the published artifact's own
   * bytes — reused directly from `@vespeneventures/policy`, the same as
   * `FactCitation.valueBinding`. Lets a caller later prove *this exact
   * entry* still describes the artifact that is actually live, the same
   * mechanism `factCitations` applies to individual facts, applied here to
   * the whole published thing.
   */
  contentBinding?: PolicyBinding;
}

/** A ledger is nothing more than an ordered list of entries — see `schema.ts`'s `validateLedger` for what makes one well-formed, and `append.ts` for the one sanctioned way to grow one. */
export type Ledger = readonly PublicationEntry[];

/**
 * One thing this package's validation or checking logic found wrong (or, at
 * `"warning"`, worth surfacing without failing a check). Deliberately the
 * same shape as `@vespeneventures/policy`'s `Finding` — itself mirrored by
 * every other `Finding`-shaped type in this repository
 * (`@vespeneventures/surface/core`'s `ComposeFinding`, `@vespeneventures/copy`'s
 * `CopyFinding`, `@vespeneventures/copy/voice`'s `VoiceFinding`) — but defined
 * locally rather than imported, following that same repository-wide
 * convention: a caller already handling one kind of finding here does not
 * need a second mental model for this package's, and this package's own
 * shape stays free to diverge later without reaching back into `policy`'s.
 */
export interface LedgerFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}
