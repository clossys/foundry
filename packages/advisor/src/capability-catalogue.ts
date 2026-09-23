import { createHash } from "node:crypto";
import { CAPABILITY_CATALOGUE_DATA } from "./generated/offering.generated.js";

/** This repository's role-loop-archetype metric directions (issue #1176). */
export type MetricDirection = "increase" | "decrease" | "maintain" | "target-range";

/**
 * Where a `needs`/`feeds` edge came from. `manifest` is the real thing —
 * a package's own `foundry.needs`/`foundry.feeds` declaration (issue #1172).
 * The `fallback-*` sources are evidence already in this repository, used
 * only while a package declares neither field: first-party runtime
 * dependencies, and this repository's committed non-runtime closed-loop
 * order (issue #1176). A package that adopts real manifest edges is never
 * silently overridden by a stale fallback.
 */
export type CapabilityEdgeSource = "manifest" | "fallback-runtime-dependency" | "fallback-non-runtime-order";

export interface CapabilityArtifactRef {
  /** Stable slug for the handoff kind, e.g. "writer-package" or a nonRuntimeOrder sequence gate. */
  artifact: string;
  /** The other role's package directory (short name), when the source could name one. */
  role?: string;
  source: CapabilityEdgeSource;
  /** Human-readable grounding: a manifest description, or the fallback evidence's own reason text. */
  reason?: string;
}

export type CapabilityEvidence = "designed" | "qualified" | "proven";

/**
 * One `foundry.solves` claim (issue #1176): `problem` is a stable id from
 * this repository's client problem vocabulary, `metric` the role's own
 * metric it would move, `proofCase` how that would be shown, and
 * `evidence` how strongly it is currently backed. Every role's entries are
 * `designed` fallbacks today (a paraphrase of its own jobQuestion) until it
 * adopts issue #1172's real `foundry.solves` declaration.
 */
export interface CapabilitySolves {
  problem: string;
  metric: string;
  proofCase: string;
  evidence: CapabilityEvidence;
}

/** One role's generated capability entry: its charter plus its handoff graph. */
export interface RoleCapability {
  /** Package directory (short name), e.g. "publisher". */
  role: string;
  /** "@clossys/<role>". */
  scopeName: string;
  jobQuestion: string;
  primaryMode: string;
  metric: { name: string; direction: MetricDirection };
  boundary: { owns: string; excludes: readonly string[] };
  solves: readonly CapabilitySolves[];
  fit: readonly string[];
  needs: readonly CapabilityArtifactRef[];
  feeds: readonly CapabilityArtifactRef[];
}

export interface CapabilityCatalogue {
  schemaVersion: 1;
  roles: readonly RoleCapability[];
}

/**
 * The capability catalogue frozen at advisor's own build time by this
 * package's build-time packer (issue #1176). It is generated, never
 * hand-grouped: one entry per role in this repository's role-loop
 * archetypes, combined with each package's own `foundry` manifest fields
 * where present, and repository evidence (runtime dependencies, the
 * committed non-runtime closed-loop order) otherwise. No runtime file or
 * network I/O reads this data; it is a plain exported constant.
 */
export const CAPABILITY_CATALOGUE: CapabilityCatalogue = CAPABILITY_CATALOGUE_DATA;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministic sha256 over the frozen catalogue (stable key order, so it
 * does not depend on object insertion order). A connector may bind this
 * into `AssessmentBasis.catalogDigest` so a reassessment can detect that
 * the catalogue a plan was built against has since changed.
 */
export const kitCatalogueDigest: string = createHash("sha256").update(stableStringify(CAPABILITY_CATALOGUE)).digest("hex");
