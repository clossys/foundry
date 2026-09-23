import { createHash } from "node:crypto";
import { CAPABILITY_CATALOGUE_DATA } from "./generated/offering.generated.js";

/** This repository's role-loop-archetype metric directions (issue #1176). */
export type MetricDirection = "increase" | "decrease" | "maintain" | "target-range";

/**
 * Where a `needs`/`feeds` edge came from. `manifest` is the real thing —
 * a package's own `foundry.needs`/`foundry.feeds` declaration, in
 * this repository's package-framework contract shape. The `fallback-*`
 * sources are evidence already in this repository, used only while a
 * package declares no `needs`: first-party runtime dependencies, and this
 * repository's committed non-runtime closed-loop order (issue #1176). A
 * package that adopts real manifest edges is never silently overridden by
 * a stale fallback.
 */
export type CapabilityEdgeSource = "manifest" | "fallback-runtime-dependency" | "fallback-non-runtime-order";

export interface CapabilityArtifactRef {
  /** Stable slug for the handoff kind: a manifest artifact name, "<role>-package", or a nonRuntimeOrder sequence gate. */
  artifact: string;
  /**
   * The other role's package directory (short name): the producer on a
   * `needs` edge, the consumer on a `feeds` edge. Absent when a `needs`
   * edge's `producerRole` is not a package in this repository's scope, or
   * on a declared `feeds` entry no role needs.
   */
  role?: string;
  /** On a manifest `needs` edge: the declared `producerRole`, the producer's scoped package name, verbatim. */
  producerRole?: string;
  /** On a `feeds` edge: the producer's declared `foundry.feeds` path for this artifact, when it declares one. */
  path?: string;
  source: CapabilityEdgeSource;
  /** Human-readable grounding: the fallback evidence's own reason text. */
  reason?: string;
}

export type CapabilityEvidence = "designed" | "qualified" | "proven";

/**
 * One `foundry.solves` claim, in the package-framework contract's shape:
 * `problem` is a stable id from this repository's client problem
 * vocabulary, `statement` the role's own one-sentence wording of it in the
 * client's words, `metric` the role's own owned metric it would move,
 * `proofCase` a case id from the role's own qualification adapter, and
 * `evidence` how strongly it is currently backed. `capability`, when
 * present, names the role's own capability that backs the claim. A role
 * that declares no `foundry.solves` gets one `designed` fallback entry
 * restating its own job question.
 */
export interface CapabilitySolves {
  problem: string;
  statement: string;
  metric: string;
  proofCase: string;
  evidence: CapabilityEvidence;
  capability?: string;
}

/** One `{ producerRole, artifact }` input of a declared capability; `producerRole` is a scoped package name. */
export interface CapabilityInput {
  producerRole: string;
  artifact: string;
}

/**
 * One entry of a role's own `foundry.capabilities` map, reduced to what
 * the per-capability needs-cycle judgement reads (issue #1382): its id,
 * the artifacts it waits on, and the paths it writes.
 */
export interface DeclaredCapability {
  id: string;
  inputs: readonly CapabilityInput[];
  outputs: readonly string[];
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
  /** Signal ids from the role's declared `foundry.fit` file; empty when it declares none. */
  fit: readonly string[];
  needs: readonly CapabilityArtifactRef[];
  feeds: readonly CapabilityArtifactRef[];
  /** The role's declared capability map; empty for a role that declares none. */
  capabilities: readonly DeclaredCapability[];
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
