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
  readText(path: string): string | null;
  writeText(path: string, contents: string): void;
  mkdirp(path: string): void;
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

/** Read-only pin and inventory report after adopt or resume. Never uninstalls. */
export interface HubHealthReport {
  readonly marker: "present" | "missing";
  readonly inventory: InventoryObservation;
  readonly advisorPin: {
    readonly dependencies?: string;
    readonly devDependencies?: string;
    readonly live?: string;
  };
  readonly dualPin: boolean;
  readonly extraClossys: readonly string[];
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
