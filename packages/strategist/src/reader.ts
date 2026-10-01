/**
 * `readStrategy` — loads one authored strategy directory. See package README
 * for the file layout. Gathers and validates; `complete` means every present
 * file is valid, not handoff-ready.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrandDerivation } from "./brand-derivation.js";
import { BRAND_FACTS_FILE, validateBrandFacts, type BrandFacts } from "./brand-facts.js";
import { readJsonFile } from "./json-file.js";
import {
  validateAudiences,
  validateBrand,
  validateFacts,
  validateMarkets,
  validateMission,
  validatePositioning,
  validateRoadmapItems,
  validateDirectionEntities,
  validateStrategistClaims,
  validateStrategyConstraints,
  type Audience,
  type BrandDocument,
  type DirectionEntity,
  type Fact,
  type Market,
  type Mission,
  type Positioning,
  type RoadmapItem,
  type StrategistClaim,
  type StrategyConstraint,
} from "./schema.js";
import type { Validator } from "./validation.js";

export type StrategyReadIssueReason = "unreadable" | "unparseable" | "invalid-schema" | "missing-required" | "retired-file";

export interface StrategyReadIssue {
  file: string;
  reason: StrategyReadIssueReason;
  detail: string;
}

export interface StrategyBundle {
  root: string;
  facts: Fact[];
  mission?: Mission;
  positioning?: Positioning;
  markets?: Market[];
  audiences?: Audience[];
  roadmap?: RoadmapItem[];
  claims?: StrategistClaim[];
  constraints?: StrategyConstraint[];
  brand?: BrandDocument;
  directions?: DirectionEntity[];
  /** `brand-facts.json` — the recorded legal entity, brand name, domains, contact, and tagline references (see `brand-facts.ts`). */
  brandFacts?: BrandFacts;
  issues: StrategyReadIssue[];
  complete: boolean;
}

const RETIRED_BRAND_FILES = ["brand-essence.json", "brand-attributes.json", "brand-derivations.json"] as const;

export function readStrategy(root: string): StrategyBundle {
  const issues: StrategyReadIssue[] = [];

  for (const fileName of RETIRED_BRAND_FILES) {
    if (existsSync(join(root, fileName))) {
      issues.push({
        file: fileName,
        reason: "retired-file",
        detail: "retired — use brand.json instead",
      });
    }
  }

  const factsPath = join(root, "facts.json");
  let facts: Fact[] = [];
  if (!existsSync(factsPath)) {
    issues.push({ file: "facts.json", reason: "missing-required", detail: "facts.json does not exist under the strategy root" });
  } else {
    const result = readJsonFile(factsPath, "facts.json", validateFacts);
    if (result.ok) {
      facts = result.value;
    } else {
      issues.push({ ...result.issue, file: "facts.json" });
    }
  }

  function readOptional<T>(fileName: string, validate: Validator<T>): T | undefined {
    const path = join(root, fileName);
    if (!existsSync(path)) return undefined;
    const result = readJsonFile(path, fileName, validate);
    if (result.ok) return result.value;
    issues.push(result.issue);
    return undefined;
  }

  const mission = readOptional("mission.json", validateMission);
  const positioning = readOptional("positioning.json", validatePositioning);
  const markets = readOptional("markets.json", validateMarkets);
  const audiences = readOptional("audiences.json", validateAudiences);
  const roadmap = readOptional("roadmap.json", validateRoadmapItems);
  const claims = readOptional("claims.json", validateStrategistClaims);
  const constraints = readOptional("constraints.json", validateStrategyConstraints);
  const brand = readOptional("brand.json", validateBrand);
  const directions = readOptional("direction.json", validateDirectionEntities);
  const brandFacts = readOptional(BRAND_FACTS_FILE, validateBrandFacts);

  return {
    root,
    facts,
    mission,
    positioning,
    markets,
    audiences,
    roadmap,
    claims,
    constraints,
    brand,
    directions,
    brandFacts,
    issues,
    complete: issues.length === 0,
  };
}

/** Brand derivations extracted for brand-coverage callers. */
export function brandDerivationsFromBundle(bundle: StrategyBundle): BrandDerivation[] {
  return bundle.brand?.derivations ?? [];
}
