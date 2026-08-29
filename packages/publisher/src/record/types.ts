/**
 * Entity shapes for `@clossys/publisher/record`. Pure data — no I/O, no
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

import type { PolicyBinding } from "@clossys/controller/policy";

/**
 * One fact a `PublicationEntry` cites, bound to that fact's value at the
 * moment of publication — never the value itself.
 *
 * `factRef` is a plain, opaque string identifying a fact — never a typed
 * import of `@example/strategy`'s `Fact`. This is the exact same
 * seam `@clossys/writer/voice`'s `Claim.factRef`,
 * `@clossys/writer`'s `CopyEntry.factRef`, and
 * `@example/strategy`'s own `Market.factRefs`/`Audience.factRefs`
 * already use: the coupling is a string convention two sides happen to
 * agree on, not a code dependency, so this package works whether or not
 * `strategy` is even installed, and resolving `factRef` against a real
 * fact registry is the caller's job (typically the same caller that already
 * has `strategy`'s `readStrategy` in scope) — this package deliberately
 * does not have that visibility.
 *
 * `valueBinding` is a `PolicyBinding` reused directly from
 * `@clossys/controller/policy`, not reimplemented: `policyId` is set to
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
   * **not** `@clossys/publisher/core`'s closed `Channel` vocabulary
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
   * `policyId`-style opaqueness `@clossys/controller/policy`'s own binding
   * uses. This package does not import `@example/strategy`, so it
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
   * bytes — reused directly from `@clossys/controller/policy`, the same as
   * `FactCitation.valueBinding`. Lets a caller later prove *this exact
   * entry* still describes the artifact that is actually live, the same
   * mechanism `factCitations` applies to individual facts, applied here to
   * the whole published thing.
   */
  contentBinding?: PolicyBinding;
  /**
   * A stable identity for the *thing that was published* — a page, a deck,
   * a release note — that survives revisions. Optional (see `schema.ts`'s
   * `"entry-content-id-shape"` for the shape check, and this package's
   * README/CHANGELOG for why this is optional rather than required at a
   * schema version): every existing `PublicationEntry` predates this field,
   * and `validateEntry`/`validateLedger` must keep accepting them exactly
   * as they are.
   *
   * This is the load-bearing field `checkJoinKeyCompleteness` (`join-key.ts`)
   * exists to police. `id` and `contentBinding` both identify a specific
   * *publish event* — `id` is opaque and unique per entry, `contentBinding`
   * commits to that event's exact bytes — and neither is reusable across a
   * redesign, since both are expected to change on every publish.
   * `contentId` is the opposite: a caller mints it once for a real-world
   * surface (e.g. `"page:pricing"`) and reuses the SAME string on every
   * later entry describing a revision of that same surface. Without a
   * field that is deliberately NOT freshly generated per publish, an
   * external signal (a click, a conversion) can be attributed to *a*
   * publication of *something*, but never compared across "the page before
   * the redesign" and "the page after" — the exact comparison a join key
   * exists to make possible. A caller that mints a fresh `contentId` on
   * every publish produces entries that individually look complete (every
   * field present) while remaining exactly as useless for that comparison
   * as if the field were absent — see `checkJoinKeyCompleteness`'s
   * `"join-key-identity-churn"` finding, the one check in this package that
   * can tell the two apart.
   */
  contentId?: string;
  /**
   * ISO 8601 instant (same format as `publishedAt`) marking when this
   * entry's live window closed — the moment a later revision of the same
   * `contentId` took over, or the moment this surface was retired outright.
   * Optional, and expected to often stay unset on the record that is
   * CURRENTLY live: this package is append-only (see `append.ts`'s doc
   * comment) with no `updateEntry`, so there is no way to go back and stamp
   * `supersededAt` onto an entry already appended once its successor
   * ships. A caller only sets this at append time — a rare case where the
   * end of an artifact's life is already known when it is recorded (a
   * time-boxed campaign page, or an honest historical backfill) — never as
   * a later edit. For the far more common case (record now, retire later,
   * date unknown), leave it unset: `checkJoinKeyCompleteness` derives which
   * entries are still "live" from `contentId` + `publishedAt` ordering
   * across the whole ledger, rather than requiring this field to be filled
   * in retroactively.
   */
  supersededAt?: string;
}

/** A ledger is nothing more than an ordered list of entries — see `schema.ts`'s `validateLedger` for what makes one well-formed, and `append.ts` for the one sanctioned way to grow one. */
export type Ledger = readonly PublicationEntry[];

/**
 * One thing this package's validation or checking logic found wrong (or, at
 * `"warning"`, worth surfacing without failing a check). Deliberately the
 * same shape as `@clossys/controller/policy`'s `Finding` — itself mirrored by
 * every other `Finding`-shaped type in this repository
 * (`@clossys/publisher/core`'s `ComposeFinding`, `@clossys/writer`'s
 * `CopyFinding`, `@clossys/writer/voice`'s `VoiceFinding`) — but defined
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
