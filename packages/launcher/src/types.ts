import type { DiscoveredHost } from "./hosts.js";
import type { ExternalInventoryDeclaration, InventoryDriftReport } from "./inventory-adoption.js";

/** Ternary retained by the installed CLI. */
export type WorkspaceState = "satisfied" | "violated" | "indeterminate";

/** Captured stdout/stderr from a host command. */
export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Filesystem and process ports. Tests inject these; the CLI supplies Node. */
export interface WorkspaceHost {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
  now(): string;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** True when path exists and is a symlink (lstat; does not follow). Missing path is false. */
  isSymlink(path: string): boolean;
  readText(path: string): string | null;
  writeText(path: string, contents: string): void;
  mkdirp(path: string): void;
  /** Creates a relative symlink at linkPath pointing at relativeTarget (directory link). */
  symlink(relativeTarget: string, linkPath: string): void;
  /** Recursively removes path. A missing path is a no-op, never a throw. */
  remove(path: string): void;
  readDir(path: string): string[];
  run(command: string, args: readonly string[], options?: { cwd?: string }): CommandResult;
  prompt(message: string, choices: readonly string[]): string | null;
}

/** On-disk hub marker generated on the consumer hub. Packed template: skeleton/clossys/.state/workspace.json. */
export interface HubDocument {
  readonly schemaVersion: 1;
  readonly kind: "account-hub";
  readonly owner: string;
  readonly repository: string;
  /** Declares an existing external repository inventory as the source of truth (#1216). Hand-edited by the client; launcher never writes this field. */
  readonly externalInventory?: ExternalInventoryDeclaration;
}

/**
 * Where the hub marker was found relative to the `.clossys/` -> `clossys/.state/`
 * migration (#1171): `clean` — only the current path. `legacy` — only the old
 * `.clossys/` path; resume migrates it. `indeterminate` — both paths carry a
 * parseable marker; launcher never merges them silently and refuses instead.
 */
export type HubMigrationState = "clean" | "legacy" | "indeterminate";

/** One skill recorded in `clossys/.state/skills.json` (#1183). */
export interface SkillManifestEntry {
  readonly name: string;
  readonly source: "installed" | "catalogue";
  readonly version?: string;
  readonly sha256: string;
}

/** The `clossys/.state/skills.json` document itself. */
export interface SkillManifestDocument {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly skills: readonly SkillManifestEntry[];
}

/** Read-only freshness summary derived from the skills manifest for the health report. */
export interface SkillsManifestSummary {
  readonly status: "present" | "missing";
  readonly total: number;
  readonly stale: number;
  readonly retired: number;
}

export interface InventoryObservation {
  /**
   * "invalid" means a document was found but does not conform to the
   * inventory schema (bad JSON, wrong shape, an unrecognized field, or a
   * duplicate repository id) -- distinct from "empty" (a well-formed,
   * zero-entry document) so a malformed document is reported, never
   * silently treated as if it were merely empty.
   */
  readonly status: "missing" | "empty" | "populated" | "invalid";
  readonly count: number;
  /** Present only when status is "invalid"; names the offending field. */
  readonly reason?: string;
}

/** A package.json dependency bucket scanned for the advisor pin. */
export type DependencyBucket = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";

/** Staleness verdict for one pinned advisor version against the live registry version. */
export type PinGrade = "stale" | "current" | "indeterminate";

/** One graded advisor pin in one dependency bucket. */
export interface PinFinding {
  readonly bucket: DependencyBucket;
  readonly pinned: string;
  readonly grade: PinGrade;
  readonly note?: string;
}

/** Verdict for one hub inventory repository id after a read-only existence check. */
export interface InventoryValidationEntry {
  readonly id: string;
  readonly known: boolean | null;
  readonly note?: string;
}

/** Read-only validation outcome for hub inventory ids. Never mutates the inventory. */
export interface InventoryValidationReport {
  readonly entries: readonly InventoryValidationEntry[];
  readonly skipped: boolean;
  readonly note?: string;
}

/** Read-only pin and inventory report after adopt or resume. Never uninstalls. */
export interface HubHealthReport {
  readonly marker: "present" | "missing";
  readonly inventory: InventoryObservation;
  readonly advisorPin: {
    readonly dependencies?: string;
    readonly devDependencies?: string;
    readonly optionalDependencies?: string;
    readonly peerDependencies?: string;
    readonly live?: string;
  };
  readonly dualPin: boolean;
  readonly extraClossys: readonly string[];
  readonly pinFindings: readonly PinFinding[];
  readonly degraded: boolean;
  /** Coding-agent hosts this apply found already linked for skill discovery here, recorded before compose ran (#1180). Always present after apply. */
  readonly linkedHosts?: readonly DiscoveredHost[];
  /** Present only when the hub marker declares an external inventory (#1216) and there is something to say about it (i.e. not "no-external-source"). */
  readonly inventoryDrift?: InventoryDriftReport;
  readonly skillComposition?: {
    readonly composed: readonly string[];
    readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
    readonly rosterTargets?: readonly string[];
    readonly rosterSkipped?: readonly { readonly inventoryId: string; readonly note: string }[];
    readonly retired?: readonly string[];
    /**
     * Composed skills left exactly as found because their on-disk content is not
     * provably what Launcher last wrote (#1473) -- in the hub, or (with `target`
     * naming the inventory id) in a sibling clone. Any entry marks the report degraded.
     */
    readonly preserved?: readonly {
      readonly target?: string;
      readonly packageDir: string;
      readonly action: "rewrite" | "retire";
      readonly path: string;
      readonly note: string;
    }[];
  };
  /** Present only on the run that performed the `.clossys/` -> `clossys/.state/` migration. */
  readonly migration?: { readonly status: "migrated"; readonly from: string; readonly to: string };
  /** Freshness summary derived from `clossys/.state/skills.json`, when present. */
  readonly skillsManifest?: SkillsManifestSummary;
}

/** Optional paths for skill composition during apply. */
export interface ApplyWorkspaceOptions {
  readonly skillCatalogueRoot?: string;
  readonly launcherPackageRoot?: string;
  /** Overrides where the packed conversation contract is read from (tests). */
  readonly contractPath?: string;
  /** Live registry `@clossys/launcher` version, used only to grade catalogue-sourced skill staleness. */
  readonly liveLauncherVersion?: string;
}

export interface CwdObservation {
  readonly absolutePath: string;
  readonly empty: boolean;
  readonly git: boolean;
  readonly githubOwner?: string;
  readonly githubRepository?: string;
  readonly hub?: HubDocument;
  readonly looksLikeFoundry: boolean;
  readonly inventory?: InventoryObservation;
  /** Present only when a hub marker was found; absent means neither path has one. */
  readonly hubMigration?: HubMigrationState;
}

export interface WorkspaceObservation {
  readonly cwd: CwdObservation;
  readonly ownerCandidates: readonly string[];
  readonly envOwner?: string;
  readonly remoteDefaultHub?: { readonly owner: string; readonly repository: string };
  readonly advisorVersion?: string;
  readonly ghAvailable: boolean;
  readonly gitAvailable: boolean;
}

export interface WorkspacePlanCreate {
  readonly action: "create";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly advisorVersion: string;
}

export interface WorkspacePlanResume {
  readonly action: "resume";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly clone: boolean;
  /** Live registry Advisor version, when observeWorkspace could read one. Used only to grade health. */
  readonly advisorVersion?: string;
  /** Set when the hub marker was found only at the legacy `.clossys/` path; apply migrates it. */
  readonly migrateFrom?: "legacy";
}

export interface WorkspacePlanAdopt {
  readonly action: "adopt";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly advisorVersion: string;
  /** Absolute path of a populated inventory document to copy. Absent when cwd already has one. */
  readonly inventorySource?: string;
  /** Merged repository ids (on-disk first, then new ids from --inventory) written when both sources are populated. */
  readonly mergedInventoryIds?: readonly string[];
  /** The merged entries themselves (each entry's `packages` kept), in the same order as `mergedInventoryIds`; what apply writes (#1334). */
  readonly mergedInventoryRepositories?: readonly { readonly id: string; readonly packages?: unknown }[];
  /** Set when `inventorySource` is about to replace an on-disk inventory that failed schema validation, so the apply message can say it was replaced rather than merely written (#1334). */
  readonly replacesInvalidInventory?: boolean;
}

export type WorkspacePlan = WorkspacePlanCreate | WorkspacePlanResume | WorkspacePlanAdopt;

export interface WorkspaceRefusal {
  readonly action: "refuse";
  readonly state: WorkspaceState;
  readonly message: string;
}

export type WorkspaceDecision = WorkspacePlan | WorkspaceRefusal;

export interface WorkspaceApplyResult {
  readonly state: "satisfied";
  readonly message: string;
  readonly health: HubHealthReport;
}
