import type { BuildOrderResult, CatalogFinding, FoundationReport } from "./gates/index.js";
import type { PreflightPackageOptions, PreflightReport } from "./release/index.js";

/** The only lifecycle-document format supported by this version. */
export const PACKAGE_LIFECYCLE_VERSION = 1 as const;

/**
 * A package's declared lifecycle maturity.
 *
 * `active` is retained as the schema-v1 compatibility value. It only means
 * that the package remains current; new entries should use an explicit
 * maturity value instead.
 */
export type PackageLifecycleStatus =
  | "active"
  | "incubating"
  | "published"
  | "qualified"
  | "adopted"
  | "deprecated"
  | "retired";

/**
 * A durable, checkable citation for a maturity claim. `reference` is a URL
 * or a repo-relative path to something a reader can actually open; `date`
 * is when it was true, in calendar-date form (`YYYY-MM-DD`). Never a
 * self-attested completion boolean, matching the evidence discipline this
 * registry already uses for `decision`/`migration`.
 */
export interface PackageLifecyclePromotionEvidence {
  readonly reference: string;
  readonly date: string;
}

/** One package's maturity or terminal lifecycle record. */
export interface PackageLifecycleEntry {
  readonly name: string;
  readonly status: PackageLifecycleStatus;
  /** Required for a terminal status unless `noReplacementReason` is supplied. */
  readonly replacement?: {
    readonly name: string;
    /** The semver range consumers should use for the successor. */
    readonly range: string;
  };
  /** Required for a terminal package with no successor; mutually exclusive with replacement. */
  readonly noReplacementReason?: string;
  /** Required for deprecated packages, in calendar-date form (`YYYY-MM-DD`). */
  readonly deprecatedOn?: string;
  /** Required for retired packages, in calendar-date form (`YYYY-MM-DD`). */
  readonly retiredOn?: string;
  /** Required for deprecated or retired packages: durable decision record or URL. */
  readonly decision?: string;
  /** Required for deprecated or retired packages: durable migration record or URL. */
  readonly migration?: string;
  /**
   * Required once status is `qualified` or `adopted`: durable proof of the
   * owner-defined integration or release check the package passed. May also
   * be present on an earlier-maturity or terminal entry as a historical
   * record.
   */
  readonly qualifiedEvidence?: PackageLifecyclePromotionEvidence;
  /**
   * Required once status is `adopted`: durable proof of confirmed consumer
   * use, in addition to (not instead of) `qualifiedEvidence`, since adopted
   * means qualified plus in confirmed use. May also be present on an
   * earlier-maturity or terminal entry as a historical record.
   */
  readonly adoptedEvidence?: PackageLifecyclePromotionEvidence;
  /**
   * Required for a deprecated package: `true` when the old import path is a
   * working compatibility shim that still resolves to real code, `false`
   * when it is a hard break with no compatibility re-export. Optional for a
   * retired package, where it is implied `false` if present at all.
   */
  readonly forwardsToReplacement?: boolean;
}

/** A consumer-owned, complete declaration of every package in one workspace. */
export interface PackageLifecycleDocument {
  readonly schemaVersion: typeof PACKAGE_LIFECYCLE_VERSION;
  readonly packages: readonly PackageLifecycleEntry[];
}

export type LifecycleFindingRule =
  | "document-shape"
  | "unknown-field"
  | "schema-version"
  | "packages-shape"
  | "entry-shape"
  | "field-accessor"
  | "package-name"
  | "duplicate-package"
  | "status"
  | "replacement"
  | "replacement-range"
  | "replacement-reason"
  | "deprecated-on"
  | "retired-on"
  | "evidence"
  | "qualified-evidence"
  | "adopted-evidence"
  | "forwards-to-replacement"
  | "replacement-missing"
  | "replacement-not-active"
  | "replacement-self"
  | "dependency-not-installable"
  | "replacement-range-stale"
  | "catalog-package-missing"
  | "lifecycle-entry-missing";

/** One stable, deterministic lifecycle-registry finding. */
export interface LifecycleFinding {
  readonly rule: LifecycleFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

/** A read-only report composed from existing workspace checks and lifecycle validation. */
export interface GovernanceReport {
  readonly foundation: FoundationReport;
  readonly buildOrder: BuildOrderResult;
  readonly lifecycleFindings: readonly LifecycleFinding[];
  /** `true` only for complete catalog coverage, clean foundation checks, a valid complete lifecycle document, and a usable build order. */
  readonly ok: boolean;
}

/** Options for package preflight. `scope` is forwarded to both composed checks. */
export interface GovernedPreflightOptions {
  readonly scope?: string;
  readonly release?: PreflightPackageOptions;
}

/** A package preflight augmented with the workspace's lifecycle governance report. */
export interface GovernedPreflightReport {
  readonly preflight: PreflightReport;
  readonly governance: GovernanceReport;
  readonly ok: boolean;
}

/** Type-only convenience exports for consumers handling the composed reports. */
export type { BuildOrderResult, CatalogFinding, FoundationReport, PreflightPackageOptions, PreflightReport };

/** Exact three-state vocabulary used by the rule-conformance assessment. */
export type RuleConformanceState = "satisfied" | "violated" | "indeterminate";

/** One deterministic finding from computing `rule conformance rate`. */
export interface RuleConformanceFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

/** One consumer-declared operating rule identity. */
export interface DeclaredRule {
  readonly id: string;
}

/** A value-free pointer to evidence held by the consumer. */
export interface RuleConformanceEvidence {
  readonly id: string;
  readonly description: string;
}

/**
 * One independent observation of a declared rule. Controller does not invent
 * these; a consumer supplies them. `independent` must be boolean `true` for
 * the observation to count as an evaluation.
 */
export interface RuleConformanceObservation {
  readonly ruleId: string;
  readonly independent: boolean;
  readonly wellFormed: boolean;
  readonly followed: boolean;
  readonly observerRef: string;
  readonly evidence: readonly RuleConformanceEvidence[];
}

/** Consumer-owned input from which `rule conformance rate` is computed. */
export interface RuleConformanceInput {
  readonly asOf: string;
  readonly declaredRules: readonly DeclaredRule[];
  readonly observations: readonly RuleConformanceObservation[];
}

/**
 * Report for the charter metric `rule conformance rate`.
 * `proposedPositions` is always the empty array: this metric does not
 * propose install positions or invent ledger rows.
 */
export interface RuleConformanceAssessment {
  readonly metric: "rule conformance rate";
  readonly state: RuleConformanceState;
  readonly rate: number | null;
  readonly evaluatedRules: number;
  readonly conformingRules: number;
  readonly findings: readonly RuleConformanceFinding[];
  readonly proposedPositions: readonly unknown[];
}
