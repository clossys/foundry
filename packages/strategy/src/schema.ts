/**
 * Zod schemas for every entity this package knows about. Pure data shape —
 * no I/O, no filesystem knowledge, nothing about where a consumer's real
 * values live on disk (that is `reader.ts`'s job).
 *
 * These schemas ship as MACHINERY, not content: this package defines what a
 * `Fact` or a `Mission` document must look like, never what any real
 * product's mission statement says. A consumer repo authors its own values
 * against this shape — the same split `@vespeneventures/tokens` draws
 * between a greyscale contract and a brand binding (see that package's
 * README, "The three-layer contract").
 */

import { z } from "zod";

// ------------------------------------------------------------------- money

/**
 * A monetary amount is always `{ amount, currency }`, never a bare number —
 * a number alone has no unit, and a unit-less number is exactly the kind of
 * claim `checkFactsTraceability` (see `facts-gate.ts`) exists to catch
 * drifting from reality. `currency` is an ISO 4217 code.
 */
export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 code, e.g. \"USD\""),
});
export type Money = z.infer<typeof MoneySchema>;

// -------------------------------------------------------------------- fact

/** `key` identifies a fact stably across renames of its label — kebab-case, like a CSS custom property without the `--`. */
const FACT_KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * One tracked fact: a value plus who vouches for it and when it was last
 * checked. This is the entity the whole package exists to make checkable —
 * every number or named claim a product states publicly should trace back
 * to exactly one of these.
 *
 * `aliases` is the escape hatch that makes matching prose against a fact
 * tractable without free-form number parsing: the fact's author writes down
 * every literal surface form the value is allowed to appear as in prose
 * (`"$4.2M"`, `"4.2 million"`, `"4,200,000"` might all alias one fact whose
 * `value` is the bare number `4200000`). `buildFactIndex` (see
 * `fact-index.ts`) reads `aliases` verbatim; it does not attempt to derive
 * them from `value` by formatting, because a formatter can only ever
 * guess which of many equally-valid renderings a given piece of prose
 * chose to use.
 */
export const FactSchema = z.object({
  /** Stable identifier, kebab-case. Referenced from prose via the `<!-- fact:<key> -->` marker (see `facts-gate.ts`). */
  key: z.string().regex(FACT_KEY_RE, "fact key must be kebab-case, e.g. \"active-customers\""),
  /** Human-readable name for this fact, e.g. "Active customers". */
  label: z.string().min(1),
  /** The value itself. A bare number, string, boolean, or a `Money` object. */
  value: z.union([z.string(), z.number(), z.boolean(), MoneySchema]),
  /** Unit for a bare-number value, e.g. "customers", "%", "countries". Omit for `Money` values — `MoneySchema.currency` already carries the unit. */
  unit: z.string().optional(),
  /** The period or moment this value describes, e.g. "Q2 2026", "as of 2026-06-30". Distinct from `lastUpdatedAt`, which is when the value was last verified, not what period it describes. */
  asOf: z.string().optional(),
  /** Where this value came from — a filing, an attestation, a dashboard export. Free-form, but required: an unsourced fact is not a fact. */
  source: z.string().min(1),
  /** Who last verified this value (a handle or initials). */
  verifiedBy: z.string().optional(),
  /** ISO 8601 date this value was last checked against its source. */
  lastUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lastUpdatedAt must be an ISO 8601 date (YYYY-MM-DD)"),
  /**
   * Every literal string this fact is allowed to appear as in prose, in
   * addition to `value`'s own plain stringification. See this schema's
   * top-level doc comment for why aliases are declared, not derived.
   */
  aliases: z.array(z.string().min(1)).optional(),
});
export type Fact = z.infer<typeof FactSchema>;

/** The whole contents of a `facts.json` file: an array of `Fact`, each `key` unique. */
export const FactsFileSchema = z.array(FactSchema).superRefine((facts, ctx) => {
  const seen = new Map<string, number>();
  facts.forEach((fact, i) => {
    const firstIndex = seen.get(fact.key);
    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate fact key "${fact.key}" (first seen at index ${firstIndex})`,
        path: [i, "key"],
      });
    } else {
      seen.set(fact.key, i);
    }
  });
});

// ----------------------------------------------------------------- mission

export const OperatingValueSchema = z.object({
  name: z.string().min(1),
  /** The decision this value forces when two paths look equally good. Operational, not a slogan. */
  rule: z.string().min(10),
});
export type OperatingValue = z.infer<typeof OperatingValueSchema>;

export const MissionSchema = z.object({
  /** Why the product exists, one line, present tense. */
  statement: z.string().min(10),
  /** The world this product is betting comes true — one horizon out, distinct from the mission's present-tense "why we exist today". */
  vision: z.string().min(10),
  values: z.array(OperatingValueSchema).min(1),
});
export type Mission = z.infer<typeof MissionSchema>;

// ------------------------------------------------------------- positioning

/**
 * The classic positioning-statement madlib: "For `forWhom`, `productName`
 * is the `category` that `weAre` — unlike `unlike`, `because` `reasonToBelieve`."
 * Kept as discrete fields rather than one free-text paragraph so each part
 * can be reasoned about (and traced to `facts`) on its own.
 */
export const PositioningSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  forWhom: z.string().min(1),
  weAre: z.string().min(1),
  unlike: z.string().min(1),
  reasonToBelieve: z.string().min(1),
});
export type Positioning = z.infer<typeof PositioningSchema>;

// ------------------------------------------------------------------ market

export const MarketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** `Fact.key`s this market's sizing claims trace back to (e.g. a TAM figure). Not validated against a live facts set here — pure schema, no cross-entity lookups. `readStrategy` (see `reader.ts`) is where that cross-check could happen. */
  factRefs: z.array(z.string()).optional(),
});
export type Market = z.infer<typeof MarketSchema>;

// ---------------------------------------------------------------- audience

export const AudienceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  painPoints: z.array(z.string().min(1)).optional(),
  factRefs: z.array(z.string()).optional(),
});
export type Audience = z.infer<typeof AudienceSchema>;

// ----------------------------------------------------------------- roadmap

export const RoadmapStatusSchema = z.enum(["now", "next", "later", "shipped"]);
export type RoadmapStatus = z.infer<typeof RoadmapStatusSchema>;

/**
 * One roadmap item. `status` is a closed vocabulary on purpose: "now" /
 * "next" / "later" are forward-looking commitments, and "shipped" is the
 * one status that has crossed into being a fact-shaped claim itself (a
 * consumer describing a shipped item as available today should be able to
 * trace that claim the same way any other fact-shaped claim can be
 * traced — see `facts-gate.ts`).
 */
export const RoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: RoadmapStatusSchema,
  description: z.string().min(1),
  targetQuarter: z.string().optional(),
});
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export const RoadmapFileSchema = z.array(RoadmapItemSchema);
export const MarketsFileSchema = z.array(MarketSchema);
export const AudiencesFileSchema = z.array(AudienceSchema);
