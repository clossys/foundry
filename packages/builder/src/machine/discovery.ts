import { join } from "node:path";
import {
  MACHINE_DECLARATION_SCHEMA_VERSION,
  WORKSPACE_MARKER_FILENAME,
} from "./types.js";
import type {
  AccountWorkspaceDeclaration,
  AccountWorkspaceDiscoveryResult,
  DiscoveryPort,
  WorkspaceCandidate,
} from "./types.js";

/**
 * Finding account workspace checkouts without a hard-coded list.
 *
 * This is the single most important correctness property in this whole
 * module: a candidate that cannot be read — missing, unreadable, malformed —
 * is `indeterminate`, never silently dropped, and never a partial machine
 * reported as success. A half-composed skills path that silently omits one
 * account's tree is this program's signature defect; this module exists so
 * that defect cannot happen quietly.
 *
 * Discovery never hard-codes an account name or an absolute path to any
 * account repository. It takes a `root` (a directory the caller names, or
 * resolves from an environment variable via `resolveWorkspacesRoot`) and
 * looks at its own immediate children. A child directory is a CANDIDATE only
 * if it has already declared itself one, by placing a
 * `builder-machine-workspace.json` marker at its own root — the same
 * discovery-by-self-declaration shape `npm`'s own workspace globbing uses,
 * except explicit rather than glob-shaped, because a glob cannot express "and
 * refuse to skip one that failed to match."
 *
 * A directory with NO marker is not evidence of anything — most directories
 * under a caller's checkout root are not workspaces at all (an unrelated
 * repository, a stray file, `node_modules`). It is simply excluded, the same
 * way a directory without a `package.json` is excluded from an npm workspace
 * glob. A directory WITH a marker has declared intent to be counted, and from
 * that point on every failure — an unreadable marker, malformed JSON, a
 * schema mismatch, an unreadable declared skill tree, two workspaces
 * claiming the same account — becomes a named `indeterminate` candidate,
 * always present in the result, never missing from it.
 */

export const WORKSPACES_ROOT_ENV_VAR = "BUILDER_MACHINE_WORKSPACES_ROOT";

/**
 * Resolves the root discovery scans, preferring an explicit caller value
 * over the environment variable, and inventing neither: a caller that
 * supplies neither gets `undefined` back, never a guessed default. Guessing
 * a default would mean this package encoding a machine's own layout, which
 * is exactly the "no absolute path to any account repository in package
 * content" rule this module exists to keep.
 */
export function resolveWorkspacesRoot(options: {
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (options.root !== undefined && options.root !== "") return options.root;
  const fromEnv = options.env?.[WORKSPACES_ROOT_ENV_VAR];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
}

function parseWorkspaceDeclaration(raw: unknown): AccountWorkspaceDeclaration | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== MACHINE_DECLARATION_SCHEMA_VERSION) return undefined;
  if (typeof record.account !== "string" || record.account.trim() === "") return undefined;
  if (typeof record.skillsPath !== "string" || record.skillsPath.trim() === "") return undefined;
  return {
    schemaVersion: MACHINE_DECLARATION_SCHEMA_VERSION,
    account: record.account,
    skillsPath: record.skillsPath,
  };
}

function resolveCandidate(port: DiscoveryPort, candidatePath: string): WorkspaceCandidate {
  const markerPath = join(candidatePath, WORKSPACE_MARKER_FILENAME);
  const raw = port.readTextFile(markerPath);
  if (raw === undefined) {
    return {
      verdict: "indeterminate",
      path: candidatePath,
      reason: "marker-unreadable",
      detail: `${markerPath}: present in a directory listing but could not be read as text`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      verdict: "indeterminate",
      path: candidatePath,
      reason: "marker-malformed",
      detail: `${markerPath}: ${(error as Error).message}`,
    };
  }

  const declaration = parseWorkspaceDeclaration(parsed);
  if (declaration === undefined) {
    return {
      verdict: "indeterminate",
      path: candidatePath,
      reason: "marker-invalid-schema",
      detail: `${markerPath}: must declare schemaVersion ${MACHINE_DECLARATION_SCHEMA_VERSION}, a non-empty account, and a non-empty skillsPath`,
    };
  }

  const skillsPath = join(candidatePath, declaration.skillsPath);
  const skillNames = port.readdir(skillsPath);
  if (skillNames === undefined) {
    return {
      verdict: "indeterminate",
      path: candidatePath,
      account: declaration.account,
      reason: "skills-path-unreadable",
      detail: `${skillsPath}: declared as this workspace's skillsPath but could not be listed`,
    };
  }

  return {
    verdict: "found",
    path: candidatePath,
    account: declaration.account,
    skillsPath,
    skillNames: [...skillNames].sort(),
  };
}

/**
 * Discover every account workspace declared under `root`. Pure with respect
 * to everything except `port`: no environment reads (see
 * `resolveWorkspacesRoot` for that half), no defaults invented.
 */
export function discoverAccountWorkspaces(
  port: DiscoveryPort,
  options: { readonly root: string | undefined },
): AccountWorkspaceDiscoveryResult {
  if (options.root === undefined) {
    return {
      verdict: "indeterminate",
      root: undefined,
      rootReason: "root-not-declared",
      rootDetail: `No discovery root was supplied and ${WORKSPACES_ROOT_ENV_VAR} is not set. Discovery cannot report a machine as composed when it was never told where to look — that would be indistinguishable from a successful scan of zero workspaces.`,
      candidates: [],
    };
  }

  const entries = port.readdir(options.root);
  if (entries === undefined) {
    return {
      verdict: "indeterminate",
      root: options.root,
      rootReason: "root-unreadable",
      rootDetail: `${options.root}: could not be listed`,
      candidates: [],
    };
  }

  const candidates: WorkspaceCandidate[] = [];
  for (const name of [...entries].sort()) {
    const candidatePath = join(options.root, name);
    const candidateEntries = port.readdir(candidatePath);
    // Not a readable directory at all -- could be a plain file, a broken
    // symlink, or something this operator has no read access to. It never
    // declared itself a workspace (we could not even see whether a marker is
    // there), so it is excluded rather than reported -- exactly like a
    // directory that IS readable but has no marker, just below.
    if (candidateEntries === undefined) continue;
    if (!candidateEntries.includes(WORKSPACE_MARKER_FILENAME)) continue;
    candidates.push(resolveCandidate(port, candidatePath));
  }

  // Two candidates claiming the same account cannot both compose under that
  // identity -- `composeInstallationPlans` keys a NamedSourcePlan's identity
  // on exactly this string, so a duplicate here would either throw a
  // confusing "duplicate source identifier" later or, worse, silently let
  // one candidate's `account` collide with another's by accident. Caught
  // here, with both offending candidates named, rather than downstream.
  const accountOwners = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (candidate.account === undefined) continue;
    const owners = accountOwners.get(candidate.account) ?? [];
    owners.push(candidate.path);
    accountOwners.set(candidate.account, owners);
  }
  const duplicated = new Set(
    [...accountOwners.entries()].filter(([, owners]) => owners.length > 1).map(([account]) => account),
  );

  const resolved: WorkspaceCandidate[] = candidates.map((candidate) => {
    if (candidate.account === undefined || !duplicated.has(candidate.account)) return candidate;
    const owners = accountOwners.get(candidate.account) ?? [];
    return {
      verdict: "indeterminate",
      path: candidate.path,
      account: candidate.account,
      reason: "duplicate-account",
      detail: `account "${candidate.account}" is also declared by: ${owners.filter((p) => p !== candidate.path).join(", ")}`,
    };
  });

  const verdict = resolved.some((candidate) => candidate.verdict === "indeterminate")
    ? "indeterminate"
    : "satisfied";

  return { verdict, root: options.root, candidates: resolved };
}
