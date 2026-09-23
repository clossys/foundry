// Model guidance (#1219, Launcher side). Owner decision: packages declare
// WHAT a step demands (a reasoning tier), never model names. Three layers:
//   1. Step demands -- each package's own loop matrix (#1197, not built here).
//   2. Tier-to-model profile -- PER HOST, shipped by Launcher, dated and
//      re-verified, so a model change reaches clients in one launcher
//      release rather than a bump of every package.
//   3. User preference -- cost-conscious / balanced / max-quality, asked
//      once by Advisor, stored in clossys/preferences.json (Advisor's file
//      to write; this module only reads it to resolve a tier to a model).
//
// Floors are hard where the verdict depends on it (Customer's keep):
// resolveModelForTier never silently drops below a caller-supplied floor;
// it reports belowFloor so the composed skill can say so plainly.

import { join } from "node:path";

export type ReasoningTier = "light" | "standard" | "deep";
export type BudgetPreference = "cost-conscious" | "balanced" | "max-quality";
export type SupportedHost = "claude-code" | "codex" | "cursor";

export interface HostTierMapping {
  /** The model this host runs for this tier under a "balanced" preference. */
  readonly balanced: string;
  /** Cheaper substitute under "cost-conscious", when one exists for this tier. Absent means "balanced" is already the floor. */
  readonly costConscious?: string;
  /** Stronger substitute under "max-quality", when one exists for this tier. */
  readonly maxQuality?: string;
}

export interface HostModelProfile {
  readonly schemaVersion: 1;
  readonly host: SupportedHost;
  /** ISO date this mapping was last verified against that host's real current models. */
  readonly verifiedAt: string;
  readonly tiers: Readonly<Record<ReasoningTier, HostTierMapping>>;
}

export interface PreferencesDocument {
  readonly schemaVersion: 1;
  readonly budget: BudgetPreference;
}

export interface ModelResolution {
  readonly tier: ReasoningTier;
  readonly host: SupportedHost;
  readonly model: string;
  /** True when a hard floor tier was requested but this host/preference combination could not clear it -- reported, never silently substituted. */
  readonly belowFloor: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TIER_ORDER: readonly ReasoningTier[] = ["light", "standard", "deep"];

/** Parses clossys/preferences.json. Absent or malformed defaults to "balanced" -- a missing preference is not a floor violation. */
export function parsePreferences(raw: string | null): PreferencesDocument {
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        isRecord(parsed) &&
        parsed.schemaVersion === 1 &&
        (parsed.budget === "cost-conscious" || parsed.budget === "balanced" || parsed.budget === "max-quality")
      ) {
        return { schemaVersion: 1, budget: parsed.budget };
      }
    } catch {
      /* falls through to the default below */
    }
  }
  return { schemaVersion: 1, budget: "balanced" };
}

/**
 * Resolves a step's demanded tier to a real model name for one host, under
 * one budget preference, respecting an optional hard floor tier.
 */
export function resolveModelForTier(
  profile: HostModelProfile,
  tier: ReasoningTier,
  budget: BudgetPreference,
  floorTier?: ReasoningTier,
): ModelResolution {
  const mapping = profile.tiers[tier];
  const model =
    budget === "cost-conscious"
      ? (mapping.costConscious ?? mapping.balanced)
      : budget === "max-quality"
        ? (mapping.maxQuality ?? mapping.balanced)
        : mapping.balanced;
  const belowFloor = floorTier !== undefined && TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(floorTier);
  return { tier, host: profile.host, model, belowFloor };
}

function isTierMapping(value: unknown): value is HostTierMapping {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.balanced === "string" &&
    (record.costConscious === undefined || typeof record.costConscious === "string") &&
    (record.maxQuality === undefined || typeof record.maxQuality === "string")
  );
}

/**
 * Reads a packed `model-profiles/<host>.json` file from the launcher
 * package root. Returns undefined -- never throws, never guesses a
 * fallback profile -- when the file is absent or malformed, matching this
 * package's read-only, fail-closed pattern for every other packed
 * artifact (manifest.ts's parseSkillManifest is the sibling to model this
 * on).
 */
export function readHostModelProfile(
  readText: (path: string) => string | null,
  launcherPackageRoot: string,
  host: SupportedHost,
): HostModelProfile | undefined {
  const raw = readText(join(launcherPackageRoot, "model-profiles", `${host}.json`));
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    (parsed as Record<string, unknown>).host !== host ||
    typeof (parsed as Record<string, unknown>).verifiedAt !== "string"
  ) {
    return undefined;
  }
  const tiersRaw = (parsed as Record<string, unknown>).tiers;
  if (typeof tiersRaw !== "object" || tiersRaw === null || Array.isArray(tiersRaw)) return undefined;
  const tiers = tiersRaw as Record<string, unknown>;
  if (!isTierMapping(tiers.light) || !isTierMapping(tiers.standard) || !isTierMapping(tiers.deep)) return undefined;
  return {
    schemaVersion: 1,
    host,
    verifiedAt: (parsed as { verifiedAt: string }).verifiedAt,
    tiers: { light: tiers.light, standard: tiers.standard, deep: tiers.deep },
  };
}
