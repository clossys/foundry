/**
 * `readStrategy` — the one place in this package that touches a filesystem.
 * Everything in `schema.ts` is pure shape; this function is what turns a
 * consumer's real `strategy/` directory into validated data, in the same
 * gather-don't-judge spirit `@example/catalog`'s `buildCatalog`
 * uses for a `packages/` directory: read what's there, validate it, and
 * record — never throw on — anything that could not be turned into usable
 * data. Judgement about what to DO with an incomplete bundle (fail a build,
 * warn, block a release) belongs to the caller, not to this function.
 *
 * Expected directory shape, every file optional except `facts.json`:
 *
 *   strategy/
 *     facts.json               required — validateFacts (array of Fact)
 *     mission.json              optional — validateMission
 *     positioning.json           optional — validatePositioning
 *     markets.json                 optional — validateMarkets (array of Market)
 *     audiences.json                 optional — validateAudiences (array of Audience)
 *     roadmap.json                     optional — validateRoadmapItems (array of RoadmapItem)
 *     brand-essence.json                 optional — validateBrandEssence
 *     brand-attributes.json                optional — validateBrandAttributes (array of BrandAttribute)
 *     brand-derivations.json                 optional — validateBrandDerivations (array of BrandDerivation)
 *
 * The three `brand-*.json` files follow the exact convention the other six
 * already set: a singular document gets a singular file name
 * (`brand-essence.json`, alongside `mission.json`/`positioning.json`), and
 * a whole array of one entity gets the entity's own plural file name
 * (`brand-attributes.json`/`brand-derivations.json`, alongside
 * `markets.json`/`audiences.json`/`roadmap.json`) — not a single combined
 * `brand.json` bundling all three, which would be a new, parallel
 * convention invented for one entity family instead of the one this reader
 * already uses everywhere else. The three names themselves are not new
 * either: `validateBrandAttributes`'/`validateBrandDerivations`' own doc
 * comments in `schema.ts`/`brand-derivation.ts` already name
 * `brand-attributes.json`/`brand-derivations.json` as the file each
 * validates the whole contents of.
 *
 * `facts.json` is singled out as required because it is this package's
 * whole reason to exist: `checkFactsTraceability` (see `facts-gate.ts`) has
 * nothing to check prose against without it. A missing or invalid
 * `facts.json` is recorded as an issue exactly like any other — this
 * function still never throws — but `StrategyBundle.complete` is `false`
 * whenever it happens, and a caller building a gate on top of this reader
 * should treat that as fail-closed input, not as "no facts to worry about".
 * The three brand files are optional in exactly the same sense
 * `mission.json`/`positioning.json` already are: absent is not an issue,
 * present-but-invalid is — see `StrategyBundle.complete`'s own doc comment,
 * which the brand fields participate in identically to every sibling file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateAudiences,
  validateBrandAttributes,
  validateBrandEssence,
  validateFacts,
  validateMarkets,
  validateMission,
  validatePositioning,
  validateRoadmapItems,
  type Audience,
  type BrandAttribute,
  type BrandEssence,
  type Fact,
  type Market,
  type Mission,
  type Positioning,
  type RoadmapItem,
} from "./schema.js";
import { validateBrandDerivations, type BrandDerivation } from "./brand-derivation.js";
import { summarizeIssues, type Validator } from "./validation.js";

/**
 * Why one file did not become usable data. `"unreadable"` is a real I/O
 * failure (permissions, or the file vanished mid-read) — unknown content
 * could be hiding behind it. `"unparseable"` means the bytes were read but
 * are not valid JSON. `"invalid-schema"` means the JSON parsed but does not
 * satisfy the entity's schema (a missing required field, a wrong type, a
 * duplicate fact key). `"missing-required"` is reserved for `facts.json`
 * specifically — every other file is optional and its absence is not an
 * issue at all.
 */
export type StrategyReadIssueReason = "unreadable" | "unparseable" | "invalid-schema" | "missing-required";

export interface StrategyReadIssue {
  /** Which file this issue is about, relative to the strategy root, e.g. "facts.json". */
  file: string;
  reason: StrategyReadIssueReason;
  /** Human-readable detail: the I/O error message, the JSON parse error, or the validator's issue summary. */
  detail: string;
}

export interface StrategyBundle {
  /** Absolute path this bundle was read from. */
  root: string;
  /** Every fact found, or `[]` if `facts.json` was missing/invalid — see `issues` and `complete` to tell those apart from "genuinely zero facts". */
  facts: Fact[];
  mission?: Mission;
  positioning?: Positioning;
  markets?: Market[];
  audiences?: Audience[];
  roadmap?: RoadmapItem[];
  /** From `brand-essence.json` — see this file's top doc comment for the file-layout convention. */
  brandEssence?: BrandEssence;
  /** From `brand-attributes.json`. */
  brandAttributes?: BrandAttribute[];
  /** From `brand-derivations.json`. */
  brandDerivations?: BrandDerivation[];
  /** Every file that could not be turned into usable data, and why. Empty means every present file validated cleanly. */
  issues: StrategyReadIssue[];
  /**
   * `true` exactly when `facts.json` was present and valid AND every OTHER
   * file that exists on disk also validated. `false` covers two different
   * situations a caller must not conflate: `facts.json` itself is
   * missing/invalid (nothing here can be trusted as ground truth), or some
   * other file is present but invalid (a narrower problem, but still a
   * bundle this function cannot vouch for in full). See `issues` for which
   * case applies. The three brand fields participate in this rule exactly
   * like every other optional file: absent costs nothing, present-but-
   * invalid flips this to `false` the same as a bad `mission.json` would.
   */
  complete: boolean;
}

function readJsonFile<T>(
  path: string,
  validate: Validator<T>,
): { ok: true; value: T } | { ok: false; issue: StrategyReadIssue } {
  const relLabel = path; // caller passes an already-relative label for messages
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      issue: { file: relLabel, reason: "unreadable", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      issue: { file: relLabel, reason: "unparseable", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  const result = validate(parsed);
  if (!result.ok) {
    return { ok: false, issue: { file: relLabel, reason: "invalid-schema", detail: summarizeIssues(result.issues) } };
  }
  return { ok: true, value: result.value };
}

/**
 * Reads `root`'s strategy directory (see this file's top doc comment for the
 * expected shape). Never throws: every failure — missing file, unreadable
 * file, bad JSON, schema violation — is recorded into `StrategyBundle.issues`
 * and reflected in `StrategyBundle.complete`, the same discipline
 * `buildCatalog` holds to for `Catalog.skipped`.
 */
export function readStrategy(root: string): StrategyBundle {
  const issues: StrategyReadIssue[] = [];

  const factsPath = join(root, "facts.json");
  let facts: Fact[] = [];
  if (!existsSync(factsPath)) {
    issues.push({ file: "facts.json", reason: "missing-required", detail: "facts.json does not exist under the strategy root" });
  } else {
    const result = readJsonFile(factsPath, validateFacts);
    if (result.ok) {
      facts = result.value;
    } else {
      issues.push({ ...result.issue, file: "facts.json" });
    }
  }

  function readOptional<T>(fileName: string, validate: Validator<T>): T | undefined {
    const path = join(root, fileName);
    if (!existsSync(path)) return undefined;
    const result = readJsonFile(path, validate);
    if (result.ok) return result.value;
    issues.push({ ...result.issue, file: fileName });
    return undefined;
  }

  const mission = readOptional("mission.json", validateMission);
  const positioning = readOptional("positioning.json", validatePositioning);
  const markets = readOptional("markets.json", validateMarkets);
  const audiences = readOptional("audiences.json", validateAudiences);
  const roadmap = readOptional("roadmap.json", validateRoadmapItems);
  const brandEssence = readOptional("brand-essence.json", validateBrandEssence);
  const brandAttributes = readOptional("brand-attributes.json", validateBrandAttributes);
  const brandDerivations = readOptional("brand-derivations.json", validateBrandDerivations);

  return {
    root,
    facts,
    mission,
    positioning,
    markets,
    audiences,
    roadmap,
    brandEssence,
    brandAttributes,
    brandDerivations,
    issues,
    complete: issues.length === 0,
  };
}
