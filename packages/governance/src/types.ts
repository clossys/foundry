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

/**
 * Repository-owned details needed to turn a starter plan into a complete
 * package plan. Governance deliberately does not supply these values: package
 * conventions differ between workspaces.
 */
export interface NewPackagePlanProfile {
  /**
   * Package manifest fields in addition to the plan's name, version, and
   * description. A complete profile must include ownership, repository,
   * tooling, and publication metadata where applicable.
   */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** Complete file contents selected by the owning repository. */
  readonly files: {
    readonly tsconfig: string;
    readonly testConfig: PackageScaffoldFile;
    readonly sourceIndex: string;
    readonly sourceTest: string;
    readonly readme: string;
    readonly licenseText: string;
  };
  /** A real release date and the first changelog entry selected by the owner. */
  readonly changelog: {
    readonly date: string;
    readonly initialEntry: string;
  };
}

/** Input to the no-write package starter planner. */
export interface NewPackagePlanInput {
  readonly name: string;
  readonly description: string;
  /** Package version to place in the planned manifest. Defaults to `0.1.0`. */
  readonly version?: string;
  /** Relative directory to place the package in. Defaults to `packages/<unscoped-name>`. */
  readonly directory?: string;
  /**
   * Optional repository-owned profile. Without one, the result is explicitly
   * a private starter plan, not a publishable scaffold.
   */
  readonly profile?: NewPackagePlanProfile;
}

/** One UTF-8 file a caller may choose to write after reviewing it. */
export interface PackageScaffoldFile {
  readonly path: string;
  readonly content: string;
}

/** Whether the plan is an intentionally incomplete starter or profile-complete. */
export type NewPackagePlanReadiness = "starter" | "profiled";

/** The deterministic output of `planNewPackage`; no files have been written. */
export interface NewPackagePlan {
  readonly directory: string;
  readonly files: readonly PackageScaffoldFile[];
  /** A starter plan must not be represented as ready for publication. */
  readonly readiness: NewPackagePlanReadiness;
  /** Explicit owner actions still needed before a starter can be released. */
  readonly requiredActions: readonly string[];
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
