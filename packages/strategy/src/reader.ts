/**
 * `readStrategy` — the one place in this package that touches a filesystem.
 * Everything in `schema.ts` is pure shape; this function is what turns a
 * consumer's real `strategy/` directory into validated data, in the same
 * gather-don't-judge spirit `@vespeneventures/catalog`'s `buildCatalog`
 * uses for a `packages/` directory: read what's there, validate it, and
 * record — never throw on — anything that could not be turned into usable
 * data. Judgement about what to DO with an incomplete bundle (fail a build,
 * warn, block a release) belongs to the caller, not to this function.
 *
 * Expected directory shape, every file optional except `facts.json`:
 *
 *   strategy/
 *     facts.json        required — FactsFileSchema (array of Fact)
 *     mission.json       optional — MissionSchema
 *     positioning.json   optional — PositioningSchema
 *     markets.json        optional — MarketsFileSchema (array of Market)
 *     audiences.json       optional — AudiencesFileSchema (array of Audience)
 *     roadmap.json          optional — RoadmapFileSchema (array of RoadmapItem)
 *
 * `facts.json` is singled out as required because it is this package's
 * whole reason to exist: `checkFactsTraceability` (see `facts-gate.ts`) has
 * nothing to check prose against without it. A missing or invalid
 * `facts.json` is recorded as an issue exactly like any other — this
 * function still never throws — but `StrategyBundle.complete` is `false`
 * whenever it happens, and a caller building a gate on top of this reader
 * should treat that as fail-closed input, not as "no facts to worry about".
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodError, ZodSchema } from "zod";
import {
  AudiencesFileSchema,
  FactsFileSchema,
  MarketsFileSchema,
  MissionSchema,
  PositioningSchema,
  RoadmapFileSchema,
  type Audience,
  type Fact,
  type Market,
  type Mission,
  type Positioning,
  type RoadmapItem,
} from "./schema.js";

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
  /** Human-readable detail: the I/O error message, the JSON parse error, or the Zod issue summary. */
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
  /** Every file that could not be turned into usable data, and why. Empty means every present file validated cleanly. */
  issues: StrategyReadIssue[];
  /**
   * `true` exactly when `facts.json` was present and valid AND every OTHER
   * file that exists on disk also validated. `false` covers two different
   * situations a caller must not conflate: `facts.json` itself is
   * missing/invalid (nothing here can be trusted as ground truth), or some
   * other file is present but invalid (a narrower problem, but still a
   * bundle this function cannot vouch for in full). See `issues` for which
   * case applies.
   */
  complete: boolean;
}

function readJsonFile<T>(
  path: string,
  schema: ZodSchema<T>,
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
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issue: { file: relLabel, reason: "invalid-schema", detail: summarizeZodError(result.error) } };
  }
  return { ok: true, value: result.data };
}

function summarizeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
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
    const result = readJsonFile(factsPath, FactsFileSchema);
    if (result.ok) {
      facts = result.value;
    } else {
      issues.push({ ...result.issue, file: "facts.json" });
    }
  }

  function readOptional<T>(fileName: string, schema: ZodSchema<T>): T | undefined {
    const path = join(root, fileName);
    if (!existsSync(path)) return undefined;
    const result = readJsonFile(path, schema);
    if (result.ok) return result.value;
    issues.push({ ...result.issue, file: fileName });
    return undefined;
  }

  const mission = readOptional("mission.json", MissionSchema);
  const positioning = readOptional("positioning.json", PositioningSchema);
  const markets = readOptional("markets.json", MarketsFileSchema);
  const audiences = readOptional("audiences.json", AudiencesFileSchema);
  const roadmap = readOptional("roadmap.json", RoadmapFileSchema);

  return {
    root,
    facts,
    mission,
    positioning,
    markets,
    audiences,
    roadmap,
    issues,
    complete: issues.length === 0,
  };
}
