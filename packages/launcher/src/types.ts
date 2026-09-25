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
  /** Decodes a file as UTF-8 text. Missing or unreadable is null. Not for contract documents: invalid bytes are silently replaced. */
  readText(path: string): string | null;
  /**
   * A file's exact bytes, never decoded. Missing or unreadable is null. Every
   * inventory document is read this way and handed to the shared strict
   * reader, so bytes that are not valid UTF-8 are refused rather than
   * silently replaced with U+FFFD before anything checks them (#1179).
   */
  readBytes(path: string): Uint8Array | null;
  writeText(path: string, contents: string): void;
  /** Writes these exact bytes, so a copied document stays byte-identical. */
  writeBytes(path: string, contents: Uint8Array): void;
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

/** A package.json dependency bucket scanned for the hub engine pins. */
export type DependencyBucket = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";

/** Staleness verdict for one pinned engine version against the live registry version. */
export type PinGrade = "stale" | "current" | "indeterminate";

/** One graded hub engine pin (`@clossys/advisor` or `@clossys/integrator`) in one dependency bucket. */
export interface PinFinding {
  /** The engine package this finding grades. */
  readonly package: string;
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

/** Where one hub engine is pinned, by dependency bucket, and its live registry version when known. */
export interface HubEnginePin {
  readonly dependencies?: string;
  readonly devDependencies?: string;
  readonly optionalDependencies?: string;
  readonly peerDependencies?: string;
  readonly live?: string;
}

/** One change a run made to a hub engine pin in the hub's `package.json`. */
export interface EnginePinChange {
  /** The engine package: `@clossys/advisor` or `@clossys/integrator`. */
  readonly package: string;
  /** The version pinned before the run; absent when the engine was not pinned at all. */
  readonly from?: string;
  /** The version pinned in `devDependencies` after the run. */
  readonly to: string;
  /** The dependency bucket the pin was moved out of, when it was not in `devDependencies`. */
  readonly movedFrom?: DependencyBucket;
}

/**
 * The hub's lockfile does not resolve its engine pins yet (`kind`
 * `engine-pins-changed-install-needed`): the hub's package manager install
 * has to run, and `package.json` be committed together with the lockfile,
 * before a frozen install (`npm ci`, `pnpm install --frozen-lockfile`,
 * `yarn install --immutable`) accepts the hub again. Marks the report degraded.
 */
export interface EngineInstallFinding {
  readonly kind: "engine-pins-changed-install-needed";
  /** The lockfile found in the hub, e.g. `package-lock.json`. */
  readonly lockfile: string;
  /** The install command for that lockfile's package manager, e.g. `npm install`. */
  readonly command: string;
  /** The engines the lockfile does not resolve at their pinned version, or, for a lockfile Launcher does not read, the engines this run changed. */
  readonly packages: readonly string[];
  readonly note: string;
}

/** Read-only pin and inventory report after adopt or resume. Never uninstalls. */
export interface HubHealthReport {
  readonly marker: "present" | "missing";
  readonly inventory: InventoryObservation;
  readonly advisorPin: HubEnginePin;
  readonly integratorPin: HubEnginePin;
  /** True when either engine is pinned in more than one dependency bucket. */
  readonly dualPin: boolean;
  readonly extraClossys: readonly string[];
  readonly pinFindings: readonly PinFinding[];
  /** Present when this run changed a hub engine pin in `package.json`: what changed, and the one next step (install, then commit `package.json` with its lockfile). */
  readonly enginePins?: { readonly changed: readonly EnginePinChange[]; readonly nextStep: string };
  /** Present when a lockfile in the hub does not resolve the engine pins yet; marks the report degraded. */
  readonly installNeeded?: EngineInstallFinding;
  readonly degraded: boolean;
  /** Coding-agent hosts this apply found already linked for skill discovery here, recorded before compose ran (#1180). Always present after apply. */
  readonly linkedHosts?: readonly DiscoveredHost[];
  /** Present only when the hub marker declares an external inventory (#1216) and there is something to say about it (i.e. not "no-external-source"). */
  readonly inventoryDrift?: InventoryDriftReport;
  readonly skillComposition?: {
    readonly composed: readonly string[];
    readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
    /** The checkouts this run composed skills into: the hub. */
    readonly rosterTargets?: readonly string[];
    /**
     * Each inventoried repository other than the hub, with what this run found
     * for it (for example, a checkout beside the hub whose team arrives only
     * once it is staffed in an approved plan, with that plan's setup pull
     * request). Report-only: a hub run never writes into one,
     * and no entry marks the report degraded.
     */
    readonly siblings?: readonly { readonly inventoryId: string; readonly note: string }[];
    readonly retired?: readonly string[];
    /**
     * Composed skills in the hub left exactly as found because their on-disk
     * content is not provably what Launcher last wrote (#1473). Any entry
     * marks the report degraded.
     */
    readonly preserved?: readonly {
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
  /** The public `@clossys/integrator` registry version, read the same way as `advisorVersion`. */
  readonly integratorVersion?: string;
  readonly ghAvailable: boolean;
  readonly gitAvailable: boolean;
}

export interface WorkspacePlanCreate {
  readonly action: "create";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly advisorVersion: string;
  readonly integratorVersion: string;
}

/**
 * What `launcher --repositories` does to the hub inventory (#1179): write
 * the chosen repositories, or leave an inventory that already lists exactly
 * those repositories as it is. Decided by `resolveChosenInventory()`.
 */
export type ChosenInventory =
  | { readonly kind: "unchanged"; readonly count: number }
  | {
      readonly kind: "write";
      /** The exact document text to write to `clossys/.state/inventory.json` (a generated hub path, not shipped in this package), already validated against the inventory contract. */
      readonly document: string;
      /** Repositories in the written document. */
      readonly count: number;
      /** Repositories the inventory listed before; 0 when there was none, it was empty, or it failed its contract. */
      readonly previousCount: number;
      /** Chosen ids the previous inventory did not list. */
      readonly added: readonly string[];
      /** Previous ids the choice leaves out. */
      readonly removed: readonly string[];
      /** What the write replaces: nothing (no inventory, or an empty one), a differing valid inventory, or one that failed its contract. The last two happen only with an explicit replace approval. */
      readonly replaced: "nothing" | "differing" | "invalid";
    };

export interface WorkspacePlanResume {
  readonly action: "resume";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly clone: boolean;
  /** Live registry Advisor version, when observeWorkspace could read one. Apply pins it in the hub and grades health against it. */
  readonly advisorVersion?: string;
  /** Live registry Integrator version, when observeWorkspace could read one. Apply pins it in the hub and grades health against it. */
  readonly integratorVersion?: string;
  /** Set when the hub marker was found only at the legacy `.clossys/` path; apply migrates it. */
  readonly migrateFrom?: "legacy";
  /** Set by `--repositories`: the inventory apply writes before it composes skills, or confirms is unchanged. */
  readonly chosenInventory?: ChosenInventory;
}

export interface WorkspacePlanAdopt {
  readonly action: "adopt";
  readonly owner: string;
  readonly repository: string;
  readonly directory: string;
  readonly advisorVersion: string;
  readonly integratorVersion: string;
  /** Absolute path of a populated inventory document to copy. Absent when cwd already has one. */
  readonly inventorySource?: string;
  /** Merged repository ids (on-disk first, then new ids from --inventory) written when both sources are populated. */
  readonly mergedInventoryIds?: readonly string[];
  /**
   * The merged entries themselves (each entry's `packages` kept), in the same order as `mergedInventoryIds` (#1334).
   * Apply writes them when the plan carries no `mergedInventoryDocument`.
   */
  readonly mergedInventoryRepositories?: readonly { readonly id: string; readonly packages?: unknown }[];
  /**
   * The merged inventory document to write, when both sources are populated: every kept entry whole, its `packages`
   * included, each repository once by Launcher's one identity rule (#1179) -- `mergedInventoryRepositories`, rendered.
   * Preferred over `mergedInventoryRepositories` and `mergedInventoryIds`, which a hand-built plan may still carry
   * without it; with ids alone, each id is written without packages.
   */
  readonly mergedInventoryDocument?: string;
  /** Set when `inventorySource` is about to replace an on-disk inventory that failed schema validation, so the apply message can say it was replaced rather than merely written (#1334). */
  readonly replacesInvalidInventory?: boolean;
  /** Set by `--repositories`: the inventory apply writes, or confirms is unchanged (#1179). */
  readonly chosenInventory?: ChosenInventory;
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
