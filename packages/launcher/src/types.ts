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
  readDir(path: string): string[];
  run(command: string, args: readonly string[], options?: { cwd?: string }): CommandResult;
  prompt(message: string, choices: readonly string[]): string | null;
}

/** On-disk hub marker generated on the consumer hub. Packed template: skeleton/.clossys/workspace.json. */
export interface HubDocument {
  readonly schemaVersion: 1;
  readonly kind: "account-hub";
  readonly owner: string;
  readonly repository: string;
}

export interface InventoryObservation {
  readonly status: "missing" | "empty" | "populated";
  readonly count: number;
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
  readonly skillComposition?: {
    readonly composed: readonly string[];
    readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
    readonly rosterTargets?: readonly string[];
    readonly rosterSkipped?: readonly { readonly inventoryId: string; readonly note: string }[];
  };
}

/** Optional paths for skill composition during apply. */
export interface ApplyWorkspaceOptions {
  readonly skillCatalogueRoot?: string;
  readonly launcherPackageRoot?: string;
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
