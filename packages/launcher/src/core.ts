import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApplyWorkspaceOptions,
  CommandResult,
  CwdObservation,
  DependencyBucket,
  HubDocument,
  HubHealthReport,
  InventoryObservation,
  InventoryValidationEntry,
  InventoryValidationReport,
  PinFinding,
  WorkspaceApplyResult,
  WorkspaceDecision,
  WorkspaceHost,
  WorkspaceObservation,
  WorkspacePlan,
  WorkspacePlanCreate,
  WorkspaceRefusal,
} from "./types.js";
import { composeSkills, SKILLS_MANIFEST_REL, type SkillCompositionResult } from "./skills.js";
import { parseSkillManifest, summarizeSkillsManifest } from "./manifest.js";

export const DEFAULT_REPOSITORY_NAME = "workspace";
/** The one visible, per-repository Clossys folder (#1171). Every role's output lives under it. */
export const CLOSSYS_DIR_REL = "clossys";
/** Machine files only: hub marker, inventory, skills manifest. Visible (not dot-hidden) so it is easy to find, but not a place a person edits by hand. */
export const STATE_DIR_REL = join(CLOSSYS_DIR_REL, ".state");
export const WORKSPACE_MARKER_REL = join(STATE_DIR_REL, "workspace.json");
export const WORKSPACE_INVENTORY_REL = join(STATE_DIR_REL, "inventory.json");
export const CLOSSYS_README_REL = join(CLOSSYS_DIR_REL, "README.md");
/** Pre-#1171 machine-state directory. Resume migrates it automatically; see `locateHub`. */
export const LEGACY_STATE_DIR_REL = ".clossys";
export const LEGACY_WORKSPACE_MARKER_REL = join(LEGACY_STATE_DIR_REL, "workspace.json");
export const LEGACY_WORKSPACE_INVENTORY_REL = join(LEGACY_STATE_DIR_REL, "inventory.json");
export const ADVISOR_PACKAGE = "@clossys/advisor";
export const LAUNCHER_PACKAGE = "@clossys/launcher";

const DEPENDENCY_BUCKETS: readonly DependencyBucket[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]+$/;
const SKELETON_FILES = [
  "README.md",
  "package.json",
  ".gitignore",
  WORKSPACE_MARKER_REL,
  WORKSPACE_INVENTORY_REL,
];

/** Written at generate time so this package never ships a nested AGENTS.md. */
export const CONSUMER_AGENTS_MD = `# Account workspace

This folder is the account hub for Foundry packages.

After \`npx @clossys/launcher\`, the same \`@clossys-*\` team is composed in
every inventoried checkout beside this hub. Talk with \`@clossys-advisor\` and
\`@clossys-<package>\` here or in a product repository. A missing \`@\` mention
is not how we signal incompatibility — \`@clossys-advisor\` is the hiring check.

Run \`npx @clossys/launcher\` again for hub health and to refresh voices on
clones next to the hub, not as how you talk to packages.

The person in this folder is a founder, not an engineer. Speak like a
person. Do not dump machine identifiers, JSON, hashes, or grant fields
unless they ask.

Advisor is read-only until the sponsor approves a next action.
`;

/** Canned guidance for inventoried product checkouts (not the hub). */
export const SISTER_CONSUMER_AGENTS_MD = `# Product repository

This repository is part of the same account engagement. The same
\`@clossys-<package>\` team is here for intro and questions;
\`@clossys-advisor\` decides hiring and compatibility. This folder is not the
hub — engines are hired per repository, not dumped here.
`;

/** Previous generate-time guidance; used to refresh stale hub AGENTS.md on resume. */
export const LEGACY_CONSUMER_AGENTS_MD = `# Account workspace

This repository is the account hub for Foundry packages. It inventories
where packages are installed and coordinates engagement. It is not a
product application and does not need the whole catalogue installed here.

The person in this folder is a founder, not an engineer. Speak like a
person. Do not dump machine identifiers, JSON, hashes, or grant fields
unless they ask.

When there is a next step, say only:

1. Where we are (one sentence).
2. What you should do next (one sentence).
3. What we will not do until you say yes.
4. Whether anything will be saved to git (usually no).

Wait for a plain yes before changing files. "Approved" in chat is
permission for that one step only. It is not a lasting grant and it
does not become a commit unless someone later saves a file.

Open this folder in your coding agent. Advisor is read-only until you
approve a next action.

Run \`npx @clossys/launcher\` again to resume. Public npm reads
need no token.
`;

export const CONSUMER_CLAUDE_MD = `@AGENTS.md
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function refuse(state: WorkspaceRefusal["state"], message: string): WorkspaceRefusal {
  return { action: "refuse", state, message };
}

function repoNameFromSlug(slug: string, fallback: string): string {
  const parts = slug.split("/");
  const name = parts.length === 2 ? parts[1] : slug;
  return name && REPO.test(name) ? name : fallback;
}

/** Parses a GitHub git remote. Any other host is rejected. */
export function parseGitHubRemote(url: string): { owner: string; repository: string } | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh?.[1] && ssh[2]) {
    const owner = ssh[1];
    const repository = ssh[2].replace(/\.git$/i, "");
    if (OWNER.test(owner) && REPO.test(repository)) return { owner, repository };
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/i, "").split("/").filter(Boolean);
    const owner = parts[0];
    const repository = parts[1];
    if (!owner || !repository || !OWNER.test(owner) || !REPO.test(repository)) return null;
    return { owner, repository };
  } catch {
    return null;
  }
}

function readJson(host: WorkspaceHost, path: string): unknown {
  const raw = host.readText(path);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Tiny semver-ish compare of `a` versus `b`: -1 older, 0 equal, 1 newer. Unparseable versions are indeterminate (null). */
function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (version: string): readonly number[] | null => {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

/** True when the marker is a v1 account-hub document. */
export function isHubDocument(value: unknown): value is HubDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== "account-hub") return false;
  if (!isText(value.owner) || !OWNER.test(value.owner)) return false;
  if (!isText(value.repository)) return false;
  const parsed = value.repository.includes("/")
    ? { owner: value.repository.split("/")[0], repository: value.repository.split("/")[1] }
    : null;
  if (!parsed?.owner || !parsed.repository || parsed.owner !== value.owner || !REPO.test(parsed.repository)) return false;
  return true;
}

function readHubAt(host: WorkspaceHost, path: string): HubDocument | undefined {
  const raw = host.readText(path);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isHubDocument(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Locates the hub marker across the `.clossys/` -> `clossys/.state/`
 * migration (#1171). `clean`: only the current path has a marker. `legacy`:
 * only the old path does; resume migrates it (see `migrateLegacyHubState`).
 * `indeterminate`: both paths carry a parseable marker; launcher never
 * merges them silently, so `planWorkspace` refuses instead. `none`: neither
 * path has one.
 */
function locateHub(
  host: WorkspaceHost,
  directory: string,
): { document?: HubDocument; migration: "clean" | "legacy" | "indeterminate" | "none" } {
  const current = readHubAt(host, join(directory, WORKSPACE_MARKER_REL));
  const legacy = readHubAt(host, join(directory, LEGACY_WORKSPACE_MARKER_REL));
  if (current !== undefined && legacy !== undefined) return { migration: "indeterminate" };
  if (current !== undefined) return { document: current, migration: "clean" };
  if (legacy !== undefined) return { document: legacy, migration: "legacy" };
  return { migration: "none" };
}

function readHub(host: WorkspaceHost, directory: string): HubDocument | undefined {
  return locateHub(host, directory).document;
}

/** Classifies a generated hub inventory (packed template skeleton/clossys/.state/inventory.json; the generated path does not ship) without inventing repositories. */
export function inspectInventory(raw: string | null): InventoryObservation {
  if (raw === null) return { status: "missing", count: 0 };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) {
      return { status: "empty", count: 0 };
    }
    const count = parsed.repositories.length;
    return { status: count > 0 ? "populated" : "empty", count };
  } catch {
    return { status: "empty", count: 0 };
  }
}

function looksLikeFoundry(host: WorkspaceHost, directory: string): boolean {
  const manifestRaw = host.readText(join(directory, "package.json"));
  if (manifestRaw !== null) {
    try {
      const manifest: unknown = JSON.parse(manifestRaw);
      if (isRecord(manifest) && manifest.name === "foundry-packages") return true;
    } catch {
      /* not a manifest */
    }
  }
  return host.exists(join(directory, "packages", "advisor", "package.json")) && host.exists(join(directory, "docs", "LIFECYCLE.md"));
}

function directoryEntries(host: WorkspaceHost, directory: string): string[] {
  if (!host.isDirectory(directory)) return [];
  return host.readDir(directory).filter((name) => name !== "." && name !== "..");
}

function isEffectivelyEmpty(entries: readonly string[]): boolean {
  return entries.every((name) => name === ".git" || name === ".DS_Store");
}

function stdoutLines(result: CommandResult): string[] {
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function commandAvailable(host: WorkspaceHost, command: string): boolean {
  const result = host.run(command, ["--version"]);
  return result.status === 0;
}

/** True when the tree already pins Advisor in some bucket, so adopt would not need a new version. */
export function hasAdvisorPin(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  return DEPENDENCY_BUCKETS.some((bucket) => clossysNames(manifest[bucket], new Set()) !== undefined);
}

/** Collects GitHub owner, cwd shape, default-hub presence, and the public Advisor pin. */
/**
 * Reads the public `@clossys/launcher` registry version, used only to grade
 * catalogue-sourced skill staleness in the health report (#1183). A missing
 * or unparseable read leaves staleness ungraded rather than refusing.
 */
export function readLiveLauncherVersion(host: WorkspaceHost): string | undefined {
  const viewed = host.run("npm", ["view", LAUNCHER_PACKAGE, "version"]);
  const version = viewed.stdout.trim();
  return viewed.status === 0 && /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
}

export function observeWorkspace(host: WorkspaceHost): WorkspaceObservation {
  const cwd = host.cwd;
  const ghAvailable = commandAvailable(host, "gh");
  const gitAvailable = commandAvailable(host, "git");
  const entries = directoryEntries(host, cwd);
  const git = host.isDirectory(join(cwd, ".git"));
  let githubOwner: string | undefined;
  let githubRepository: string | undefined;
  if (git && gitAvailable) {
    const remote = host.run("git", ["remote", "get-url", "origin"], { cwd });
    const parsed = parseGitHubRemote(remote.stdout.trim());
    if (parsed) {
      githubOwner = parsed.owner;
      githubRepository = parsed.repository;
    }
  }
  const candidates = new Set<string>();
  const envOwnerRaw = host.env.CLOSSYS_OWNER?.trim();
  const envOwner = envOwnerRaw && OWNER.test(envOwnerRaw) ? envOwnerRaw : undefined;
  if (ghAvailable) {
    const user = host.run("gh", ["api", "user", "--jq", ".login"]);
    const login = user.stdout.trim();
    if (user.status === 0 && OWNER.test(login)) candidates.add(login);
    for (const org of stdoutLines(host.run("gh", ["org", "list"]))) {
      if (OWNER.test(org)) candidates.add(org);
    }
  }
  if (githubOwner) candidates.add(githubOwner);

  let remoteDefaultHub: WorkspaceObservation["remoteDefaultHub"];
  let advisorVersion: string | undefined;
  const ownerGuess = envOwner ?? (candidates.size === 1 ? [...candidates][0] : githubOwner);
  if (ghAvailable && ownerGuess) {
    const viewed = host.run("gh", ["repo", "view", `${ownerGuess}/${DEFAULT_REPOSITORY_NAME}`, "--json", "name"]);
    if (viewed.status === 0) remoteDefaultHub = { owner: ownerGuess, repository: DEFAULT_REPOSITORY_NAME };
  }
  const viewedAdvisor = host.run("npm", ["view", ADVISOR_PACKAGE, "version"]);
  const version = viewedAdvisor.stdout.trim();
  if (viewedAdvisor.status === 0 && /^\d+\.\d+\.\d+$/.test(version)) advisorVersion = version;

  const hubLocation = locateHub(host, cwd);
  // While only the legacy `.clossys/` marker exists, its sibling inventory is
  // the one resume will migrate; read from there so planning sees it too.
  const inventoryRaw =
    hubLocation.migration === "legacy"
      ? host.readText(join(cwd, LEGACY_WORKSPACE_INVENTORY_REL))
      : host.readText(join(cwd, WORKSPACE_INVENTORY_REL));

  const cwdObservation: CwdObservation = {
    absolutePath: cwd,
    empty: isEffectivelyEmpty(entries),
    git,
    ...(githubOwner === undefined ? {} : { githubOwner }),
    ...(githubRepository === undefined ? {} : { githubRepository }),
    ...(hubLocation.document === undefined ? {} : { hub: hubLocation.document }),
    ...(hubLocation.migration === "none" ? {} : { hubMigration: hubLocation.migration }),
    looksLikeFoundry: looksLikeFoundry(host, cwd),
    inventory: inspectInventory(inventoryRaw),
  };

  return {
    cwd: cwdObservation,
    ownerCandidates: [...candidates].sort(),
    ...(envOwner === undefined ? {} : { envOwner }),
    ...(remoteDefaultHub === undefined ? {} : { remoteDefaultHub }),
    ...(advisorVersion === undefined ? {} : { advisorVersion }),
    ghAvailable,
    gitAvailable,
  };
}

function resolveOwner(observation: WorkspaceObservation, host: WorkspaceHost): { owner: string } | WorkspaceRefusal {
  if (observation.envOwner) return { owner: observation.envOwner };
  if (observation.ownerCandidates.length === 1) {
    const owner = observation.ownerCandidates[0];
    if (owner) return { owner };
  }
  if (observation.ownerCandidates.length > 1) {
    const picked = host.isTTY
      ? host.prompt("Which GitHub owner should hold the account workspace hub?", observation.ownerCandidates)
      : null;
    if (picked && observation.ownerCandidates.includes(picked)) return { owner: picked };
    return refuse(
      "indeterminate",
      `multiple GitHub owners are visible (${observation.ownerCandidates.join(", ")}); re-run from a terminal to pick one`,
    );
  }
  return refuse("indeterminate", "cannot infer a GitHub owner; authenticate `gh` or set CLOSSYS_OWNER");
}

/**
 * Decides create, resume, or adopt from a cwd observation.
 * Appointing means: run this from the GitHub repository that should own the hub.
 */
export function readInventoryRepositories(host: WorkspaceHost, source: string, label: string): readonly string[] {
  const raw = host.readText(source);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.repositories)) return [];
    return parsed.repositories.map((entry) => {
      if (isRecord(entry) && isText(entry.id)) return entry.id.trim();
      return "";
    });
  } catch {
    throw new Error(`${label} is not readable inventory JSON (schemaVersion 1, repositories array)`);
  }
}

/**
 * Resolves which repositories the adopt plan inventories. When the on-disk hub
 * inventory is populated AND --inventory is supplied, the two are merged by id:
 * on-disk entries keep their order, ids not already on disk are appended in
 * supplied-file order, and the first occurrence of an id wins; the plan carries
 * the merged ids for applyWorkspacePlan to write. When both are empty or
 * missing, adopt refuses rather than appointing an inventory-less hub.
 */
function resolveAdoptInventory(
  host: WorkspaceHost,
  cwd: CwdObservation,
  inventoryPath: string | undefined,
): { inventorySource?: string; mergedInventoryIds?: readonly string[] } | WorkspaceRefusal {
  const trimmed = inventoryPath?.trim();
  const onDiskPopulated = cwd.inventory?.status === "populated";
  if (!onDiskPopulated && !trimmed) {
    return refuse(
      "violated",
      "appointing requires a populated generated hub inventory (packed template skeleton/clossys/.state/inventory.json; the generated path does not ship), or --inventory <path> to a populated inventory document",
    );
  }
  if (!trimmed) return {};
  const resolved = resolve(cwd.absolutePath, trimmed);
  const imported = inspectInventory(host.readText(resolved));
  if (imported.status !== "populated") {
    return refuse(
      "violated",
      "--inventory must point at a populated inventory document (schemaVersion 1, nonempty repositories)",
    );
  }
  if (!onDiskPopulated) return { inventorySource: resolved };
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of readInventoryRepositories(host, join(cwd.absolutePath, WORKSPACE_INVENTORY_REL), "the on-disk hub inventory")) {
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  for (const id of readInventoryRepositories(host, resolved, "--inventory")) {
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  return { mergedInventoryIds: merged };
}

export function planWorkspace(
  observation: WorkspaceObservation,
  host: WorkspaceHost,
  options: { inventoryPath?: string } = {},
): WorkspaceDecision {
  const { cwd } = observation;
  if (cwd.hubMigration === "indeterminate") {
    return refuse(
      "indeterminate",
      `both ${WORKSPACE_MARKER_REL} and the legacy ${LEGACY_WORKSPACE_MARKER_REL} are present; launcher never merges them silently -- remove one before resuming`,
    );
  }
  const envOwner = observation.envOwner ?? (host.env.CLOSSYS_OWNER?.trim() || undefined);
  if (
    envOwner !== undefined &&
    !cwd.looksLikeFoundry &&
    cwd.hub === undefined &&
    cwd.git &&
    cwd.githubOwner !== undefined &&
    cwd.githubOwner !== envOwner
  ) {
    return refuse(
      "violated",
      `CLOSSYS_OWNER is "${envOwner}" but the github.com origin here is owned by "${cwd.githubOwner}"; refusing to appoint a marker for the wrong account`,
    );
  }
  if (cwd.looksLikeFoundry) {
    return refuse(
      "violated",
      "refusing to scaffold a hub inside the Foundry supplier tree; run from the GitHub repository you want to appoint, or from an empty directory",
    );
  }
  if (cwd.hub) {
    return {
      action: "resume",
      owner: cwd.hub.owner,
      repository: repoNameFromSlug(cwd.hub.repository, DEFAULT_REPOSITORY_NAME),
      directory: cwd.absolutePath,
      clone: false,
      ...(observation.advisorVersion === undefined ? {} : { advisorVersion: observation.advisorVersion }),
      ...(cwd.hubMigration === "legacy" ? { migrateFrom: "legacy" as const } : {}),
    };
  }
  if (cwd.git && cwd.githubOwner && cwd.githubRepository) {
    if (!observation.advisorVersion) {
      return refuse("indeterminate", `cannot read a public ${ADVISOR_PACKAGE} version from the npm registry`);
    }
    const imported = resolveAdoptInventory(host, cwd, options.inventoryPath);
    if ("action" in imported) return imported;
    return {
      action: "adopt",
      owner: cwd.githubOwner,
      repository: cwd.githubRepository,
      directory: cwd.absolutePath,
      advisorVersion: observation.advisorVersion,
      ...(imported.inventorySource === undefined ? {} : { inventorySource: imported.inventorySource }),
      ...(imported.mergedInventoryIds === undefined ? {} : { mergedInventoryIds: imported.mergedInventoryIds }),
    };
  }
  if (cwd.git) {
    return refuse("violated", "GitHub-only: the current repository has no github.com origin remote to appoint");
  }
  if (!cwd.empty) {
    return refuse(
      "violated",
      "the current directory is not empty and is not a GitHub repository; run from the repo you want to appoint, or from an empty directory",
    );
  }
  const ownerResult = resolveOwner(observation, host);
  if ("action" in ownerResult) return ownerResult;
  if (observation.remoteDefaultHub && observation.remoteDefaultHub.owner === ownerResult.owner) {
    return {
      action: "resume",
      owner: observation.remoteDefaultHub.owner,
      repository: observation.remoteDefaultHub.repository,
      directory: cwd.absolutePath,
      clone: true,
      ...(observation.advisorVersion === undefined ? {} : { advisorVersion: observation.advisorVersion }),
    };
  }
  if (!observation.ghAvailable) {
    return refuse("indeterminate", "`gh` is required to create a GitHub repository for a new hub");
  }
  if (!observation.advisorVersion) {
    return refuse("indeterminate", `cannot read a public ${ADVISOR_PACKAGE} version from the npm registry`);
  }
  return {
    action: "create",
    owner: ownerResult.owner,
    repository: DEFAULT_REPOSITORY_NAME,
    directory: cwd.absolutePath,
    advisorVersion: observation.advisorVersion,
  };
}

function containedPath(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`refusing to write outside the workspace directory: ${relativePath}`);
  }
  return resolved;
}

function substitute(contents: string, plan: { owner: string; repository: string; advisorVersion?: string }): string {
  return contents
    .replaceAll("__OWNER__", plan.owner)
    .replaceAll("__REPOSITORY_NAME__", plan.repository)
    .replaceAll("__ADVISOR_VERSION__", plan.advisorVersion ?? "0.0.0");
}

function writeSkeletonFile(host: WorkspaceHost, directory: string, relativePath: string, contents: string): void {
  const target = containedPath(directory, relativePath);
  host.mkdirp(dirname(target));
  host.writeText(target, contents);
}

function pinString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function clossysNames(bucket: unknown, extra: Set<string>): string | undefined {
  if (!isRecord(bucket)) return undefined;
  let advisor: string | undefined;
  for (const [name, version] of Object.entries(bucket)) {
    if (name === ADVISOR_PACKAGE) {
      advisor = pinString(version);
      continue;
    }
    if (name.startsWith("@clossys/")) extra.add(name);
  }
  return advisor;
}

/**
 * Pins live Advisor in `devDependencies` only. Relocates a pin left in any
 * other bucket and overwrites a frozen version. Does not touch other
 * `@clossys/*` names. A dedicated `{owner}/workspace` hub is named
 * `@owner/workspace`.
 */
function mergeAdvisorPin(
  host: WorkspaceHost,
  directory: string,
  skeletonRoot: string,
  advisorVersion: string,
  owner: string,
  repository: string,
): void {
  const path = join(directory, "package.json");
  const raw = host.readText(path);
  if (raw === null) {
    const skeleton = host.readText(join(skeletonRoot, "package.json"));
    if (skeleton === null) throw new Error("missing skeleton package.json");
    writeSkeletonFile(host, directory, "package.json", substitute(skeleton, { owner, repository, advisorVersion }));
    return;
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("package.json is not an object");
    manifest = parsed;
  } catch {
    throw new Error("existing package.json is unreadable JSON");
  }
  for (const bucket of DEPENDENCY_BUCKETS) {
    if (bucket === "devDependencies") continue;
    const current = manifest[bucket];
    if (!isRecord(current) || !(ADVISOR_PACKAGE in current)) continue;
    const next = { ...current };
    delete next[ADVISOR_PACKAGE];
    if (Object.keys(next).length === 0) delete manifest[bucket];
    else manifest[bucket] = next;
  }
  const devDependencies = isRecord(manifest.devDependencies) ? { ...manifest.devDependencies } : {};
  devDependencies[ADVISOR_PACKAGE] = advisorVersion;
  manifest.devDependencies = devDependencies;
  if (repository === DEFAULT_REPOSITORY_NAME) {
    manifest.name = `@${owner}/${repository}`;
  }
  host.writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function copySkeleton(host: WorkspaceHost, skeletonRoot: string, plan: WorkspacePlanCreate): void {
  for (const relativePath of SKELETON_FILES) {
    const source = host.readText(join(skeletonRoot, relativePath));
    if (source === null) throw new Error(`missing skeleton file ${relativePath}`);
    writeSkeletonFile(host, plan.directory, relativePath, substitute(source, plan));
  }
  writeSkeletonFile(host, plan.directory, "AGENTS.md", CONSUMER_AGENTS_MD);
  writeSkeletonFile(host, plan.directory, "CLAUDE.md", CONSUMER_CLAUDE_MD);
}

/** Refuses adopt when the working tree has uncommitted changes; names a non-github.com remote host. */
function assertCleanTree(host: WorkspaceHost, directory: string): void {
  const status = host.run("git", ["status", "--porcelain"], { cwd: directory });
  if (status.status === 0 && status.stdout.trim() !== "") {
    const origin = host.run("git", ["remote", "get-url", "origin"], { cwd: directory }).stdout.trim();
    let where = "this checkout";
    if (origin !== "") {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === "ssh:" || parsed.protocol === "https:" || parsed.protocol === "http:") {
          where = `the repository on ${parsed.hostname}`;
        }
      } catch {
        /* ssh form or unparsable; keep the generic host */
      }
    }
    throw new Error(
      `${where} has uncommitted changes (git status --porcelain is nonempty); commit or stash them before appointing it as the account hub`,
    );
  }
}

function adoptHubFiles(host: WorkspaceHost, skeletonRoot: string, plan: WorkspacePlan & { advisorVersion: string }): void {
  assertCleanTree(host, plan.directory);
  const marker = {
    schemaVersion: 1,
    kind: "account-hub",
    owner: plan.owner,
    repository: `${plan.owner}/${plan.repository}`,
  };
  writeSkeletonFile(host, plan.directory, WORKSPACE_MARKER_REL, `${JSON.stringify(marker, null, 2)}\n`);
  if ("mergedInventoryIds" in plan && Array.isArray(plan.mergedInventoryIds)) {
    const document = { schemaVersion: 1, repositories: plan.mergedInventoryIds.map((id) => ({ id })) };
    writeSkeletonFile(
      host,
      plan.directory,
      WORKSPACE_INVENTORY_REL,
      `${JSON.stringify(document, null, 2)}\n`,
    );
  } else if ("inventorySource" in plan && typeof plan.inventorySource === "string") {
    const raw = host.readText(plan.inventorySource);
    if (raw === null || inspectInventory(raw).status !== "populated") {
      throw new Error("inventory source is not a populated inventory document");
    }
    writeSkeletonFile(host, plan.directory, WORKSPACE_INVENTORY_REL, raw.endsWith("\n") ? raw : `${raw}\n`);
  }
  if (host.readText(join(plan.directory, "AGENTS.md")) === null) {
    writeSkeletonFile(host, plan.directory, "AGENTS.md", CONSUMER_AGENTS_MD);
  } else {
    writeConsumerAgentsIfNeeded(host, plan.directory);
  }
  if (host.readText(join(plan.directory, "CLAUDE.md")) === null) {
    writeSkeletonFile(host, plan.directory, "CLAUDE.md", CONSUMER_CLAUDE_MD);
  }
  if (host.readText(join(plan.directory, "README.md")) === null) {
    const readme = host.readText(join(skeletonRoot, "README.md"));
    if (readme !== null) writeSkeletonFile(host, plan.directory, "README.md", substitute(readme, plan));
  }
  if (host.readText(join(plan.directory, ".gitignore")) === null) {
    const ignore = host.readText(join(skeletonRoot, ".gitignore"));
    if (ignore !== null) writeSkeletonFile(host, plan.directory, ".gitignore", ignore);
  }
  mergeAdvisorPin(host, plan.directory, skeletonRoot, plan.advisorVersion, plan.owner, plan.repository);
}

function requireZero(result: CommandResult, label: string): void {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`);
  }
}

/**
 * Read-only pin and inventory report. Does not install or uninstall. Scans all
 * four dependency buckets; grades each pinned advisor version against the live
 * registry version, marking a pin older than live as a stale-pin finding and a
 * degraded report.
 */
export function reportHubHealth(
  host: WorkspaceHost,
  directory: string,
  liveAdvisorVersion?: string,
  liveLauncherVersion?: string,
  retiredThisRun: readonly string[] = [],
  migration?: HubHealthReport["migration"],
): HubHealthReport {
  const extra = new Set<string>();
  const pins: Partial<Record<DependencyBucket, string>> = {};
  const manifestRaw = host.readText(join(directory, "package.json"));
  if (manifestRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(manifestRaw);
      if (isRecord(parsed)) {
        for (const bucket of DEPENDENCY_BUCKETS) {
          const pin = clossysNames(parsed[bucket], extra);
          if (pin !== undefined) pins[bucket] = pin;
        }
      }
    } catch {
      /* unreadable manifest is reported as missing pins */
    }
  }
  const pinFindings: PinFinding[] = Object.entries(pins).flatMap(([bucket, pinned]): PinFinding[] => {
    if (liveAdvisorVersion === undefined) return [];
    const comparison = compareVersions(pinned, liveAdvisorVersion);
    if (comparison === null) {
      return [{ bucket: bucket as DependencyBucket, pinned, grade: "indeterminate", note: `cannot compare ${pinned} with live ${liveAdvisorVersion}` }];
    }
    return comparison < 0
      ? [{ bucket: bucket as DependencyBucket, pinned, grade: "stale", note: `pinned ${pinned} is older than live ${liveAdvisorVersion}` }]
      : [];
  });
  const skillsManifest = summarizeSkillsManifest(
    parseSkillManifest(host.readText(join(directory, SKILLS_MANIFEST_REL))),
    liveLauncherVersion,
    retiredThisRun,
  );
  return {
    marker: readHub(host, directory) === undefined ? "missing" : "present",
    inventory: inspectInventory(host.readText(join(directory, WORKSPACE_INVENTORY_REL))),
    advisorPin: {
      ...(pins.dependencies === undefined ? {} : { dependencies: pins.dependencies }),
      ...(pins.devDependencies === undefined ? {} : { devDependencies: pins.devDependencies }),
      ...(pins.optionalDependencies === undefined ? {} : { optionalDependencies: pins.optionalDependencies }),
      ...(pins.peerDependencies === undefined ? {} : { peerDependencies: pins.peerDependencies }),
      ...(liveAdvisorVersion === undefined ? {} : { live: liveAdvisorVersion }),
    },
    dualPin: Object.values(pins).filter((value) => value !== undefined).length > 1,
    extraClossys: [...extra].sort(),
    pinFindings,
    degraded:
      pinFindings.some((finding) => finding.grade === "stale") ||
      Object.values(pins).filter((value) => value !== undefined).length > 1 ||
      pins.devDependencies === undefined ||
      pins.dependencies !== undefined ||
      pins.optionalDependencies !== undefined ||
      pins.peerDependencies !== undefined,
    ...(migration === undefined ? {} : { migration }),
    skillsManifest,
  };
}

export function formatHubHealth(report: HubHealthReport): string {
  const pinParts: string[] = [];
  for (const bucket of DEPENDENCY_BUCKETS) {
    const pinned = report.advisorPin[bucket];
    if (pinned !== undefined) pinParts.push(`${bucket} ${pinned}`);
  }
  const pin = pinParts.length === 0 ? "missing" : pinParts.join(" and ");
  const live = report.advisorPin.live === undefined ? "" : `; live ${report.advisorPin.live}`;
  const extra = report.extraClossys.length === 0 ? "none" : report.extraClossys.join(", ");
  const inventory =
    report.inventory.status === "populated" ? `populated (${report.inventory.count})` : report.inventory.status;
  const findings = report.pinFindings.map((finding) =>
    finding.note !== undefined ? `${finding.bucket} ${finding.note}` : `${finding.bucket} ${finding.grade}`,
  );
  const findingLine = findings.length === 0 ? "none" : findings.join("; ");
  const skillParts: string[] = [];
  if (report.skillComposition !== undefined) {
    skillParts.push(
      report.skillComposition.composed.length === 0
        ? "skills composed: none"
        : `skills composed: ${report.skillComposition.composed.map((name) => `clossys-${name}`).join(", ")}`,
    );
    for (const skip of report.skillComposition.skipped) {
      skillParts.push(`skill skipped (${skip.packageDir}): ${skip.note}`);
    }
    if (report.skillComposition.rosterTargets !== undefined && report.skillComposition.rosterTargets.length > 0) {
      skillParts.push(`skill roster written: ${report.skillComposition.rosterTargets.join(", ")}`);
    }
    for (const skip of report.skillComposition.rosterSkipped ?? []) {
      skillParts.push(`skill roster skipped (${skip.inventoryId}): ${skip.note}`);
    }
    if (report.skillComposition.retired !== undefined && report.skillComposition.retired.length > 0) {
      skillParts.push(`skills retired: ${report.skillComposition.retired.map((name) => `clossys-${name}`).join(", ")}`);
    }
  }
  const skillsManifestLine =
    report.skillsManifest === undefined
      ? undefined
      : report.skillsManifest.status === "missing"
        ? "skills manifest: missing"
        : `skills: ${report.skillsManifest.stale} out of date, ${report.skillsManifest.retired} retired (${report.skillsManifest.total} composed)`;
  const migrationLine =
    report.migration === undefined ? undefined : `migration: moved hub state from ${report.migration.from} to ${report.migration.to}`;
  return [
    `hub marker: ${report.marker}`,
    `inventory: ${inventory}`,
    `advisor pin: ${pin}${live}`,
    `dual pin: ${report.dualPin ? "yes" : "no"}`,
    `extra @clossys/*: ${extra}`,
    `pin findings: ${findingLine}`,
    `degraded: ${report.degraded ? "yes" : "no"}`,
    ...(migrationLine === undefined ? [] : [migrationLine]),
    ...(skillsManifestLine === undefined ? [] : [skillsManifestLine]),
    ...(skillParts.length === 0 ? [] : skillParts),
    `health: ${JSON.stringify(report)}`,
  ].join("\n");
}

function withHealth(
  host: WorkspaceHost,
  directory: string,
  headline: string,
  liveAdvisorVersion?: string,
  skillComposition?: SkillCompositionResult,
  liveLauncherVersion?: string,
  migration?: HubHealthReport["migration"],
): WorkspaceApplyResult {
  const base = reportHubHealth(host, directory, liveAdvisorVersion, liveLauncherVersion, skillComposition?.retired ?? [], migration);
  const rosterSkipped = skillComposition?.rosterSkipped ?? [];
  const health: HubHealthReport = {
    ...base,
    ...(skillComposition === undefined ? {} : { skillComposition }),
    degraded: base.degraded || rosterSkipped.length > 0,
  };
  return {
    state: "satisfied",
    message: `${headline}\n${formatHubHealth(health)}`,
    health,
  };
}

/**
 * Read-only inventory validation: runs `gh repo view --json name` for each
 * repository id, batched. Tolerates a missing or failing `gh` by skipping with
 * a note; marks ids whose check fails as unknown. Never mutates the inventory.
 */
export function checkInventoryEntries(host: WorkspaceHost, directory: string): InventoryValidationReport {
  const raw = host.readText(join(directory, WORKSPACE_INVENTORY_REL));
  const observation = inspectInventory(raw);
  if (observation.status !== "populated") {
    return { entries: [], skipped: true, note: `inventory is ${observation.status}; nothing to validate` };
  }
  const available = commandAvailable(host, "gh");
  if (!available) {
    return { entries: [], skipped: true, note: "`gh` is unavailable; inventory ids were not validated" };
  }
  const ids = readInventoryRepositories(host, join(directory, WORKSPACE_INVENTORY_REL), "the hub inventory").filter(
    (id) => id !== "",
  );
  const batch = 20;
  const entries: InventoryValidationEntry[] = [];
  for (let index = 0; index < ids.length; index += batch) {
    for (const id of ids.slice(index, index + batch)) {
      const viewed = host.run("gh", ["repo", "view", id, "--json", "name"]);
      if (viewed.status === 0) {
        entries.push({ id, known: true });
      } else if (viewed.status === 127 || (viewed.status === null && viewed.stderr.includes("ENOENT"))) {
        entries.push({ id, known: null, note: "`gh` unavailable; not checked" });
      } else {
        entries.push({ id, known: false, note: "`gh repo view` failed; the repository may not exist" });
      }
    }
  }
  return { entries, skipped: false };
}

function shouldRefreshConsumerAgents(existing: string | null): boolean {
  if (existing === null) return true;
  if (existing === CONSUMER_AGENTS_MD) return false;
  if (existing === LEGACY_CONSUMER_AGENTS_MD) return true;
  if (existing.includes("Run `npx @clossys/launcher` again to resume")) return true;
  return false;
}

function writeConsumerAgentsIfNeeded(host: WorkspaceHost, directory: string): void {
  const existing = host.readText(join(directory, "AGENTS.md"));
  if (!shouldRefreshConsumerAgents(existing)) return;
  writeSkeletonFile(host, directory, "AGENTS.md", CONSUMER_AGENTS_MD);
}

function writeSisterConsumerAgentsIfNeeded(host: WorkspaceHost, directory: string): void {
  const existing = host.readText(join(directory, "AGENTS.md"));
  if (existing !== null && existing.trim() !== "" && existing !== SISTER_CONSUMER_AGENTS_MD) return;
  writeSkeletonFile(host, directory, "AGENTS.md", SISTER_CONSUMER_AGENTS_MD);
}

const CLONE_NOT_BESIDE_HUB_NOTE =
  "clone not next to the hub; voices appear here after this repository is cloned beside the hub and launcher resumes";

function parseInventoryRepositoryId(id: string, hubOwner: string): { owner: string; repository: string } | null {
  const trimmed = id.trim();
  if (trimmed === "") return null;
  if (trimmed.includes("/")) {
    const slash = trimmed.indexOf("/");
    const owner = trimmed.slice(0, slash);
    const repository = trimmed.slice(slash + 1);
    if (!OWNER.test(owner) || !REPO.test(repository)) return null;
    return { owner, repository };
  }
  if (!REPO.test(trimmed)) return null;
  return { owner: hubOwner, repository: trimmed };
}

function resolveSisterCloneTargets(
  host: WorkspaceHost,
  hubDirectory: string,
  hubOwner: string,
): {
  readonly targets: readonly { readonly inventoryId: string; readonly directory: string }[];
  readonly skipped: readonly { readonly inventoryId: string; readonly note: string }[];
} {
  const parent = dirname(resolve(hubDirectory));
  const hubResolved = resolve(hubDirectory);
  const skipped: { inventoryId: string; note: string }[] = [];
  const targets: { inventoryId: string; directory: string }[] = [];
  const inventoryPath = join(hubDirectory, WORKSPACE_INVENTORY_REL);
  let inventoryIds: readonly string[];
  try {
    inventoryIds = readInventoryRepositories(host, inventoryPath, "the hub inventory");
  } catch {
    return { targets: [], skipped: [] };
  }
  for (const id of inventoryIds) {
    if (id === "") continue;
    const parsed = parseInventoryRepositoryId(id, hubOwner);
    if (parsed === null) {
      skipped.push({ inventoryId: id, note: "inventory id is not a valid repository slug" });
      continue;
    }
    if (parsed.owner !== hubOwner) {
      skipped.push({ inventoryId: id, note: "other account; not this roster" });
      continue;
    }
    const candidate = join(parent, parsed.repository);
    const candidateResolved = resolve(candidate);
    if (candidateResolved === hubResolved) continue;
    if (!host.exists(candidate) || !host.isDirectory(candidate)) {
      skipped.push({ inventoryId: id, note: CLONE_NOT_BESIDE_HUB_NOTE });
      continue;
    }
    if (looksLikeFoundry(host, candidate)) {
      skipped.push({ inventoryId: id, note: "foundry supplier tree; skills are not written here" });
      continue;
    }
    const originResult = host.run("git", ["remote", "get-url", "origin"], { cwd: candidate });
    const originUrl = originResult.status === 0 ? originResult.stdout.trim() : "";
    const remote = originUrl === "" ? null : parseGitHubRemote(originUrl);
    if (remote === null || remote.owner !== parsed.owner || remote.repository !== parsed.repository) {
      skipped.push({ inventoryId: id, note: "git origin does not match inventory id" });
      continue;
    }
    targets.push({ inventoryId: id, directory: candidate });
  }
  return { targets, skipped };
}

function hubRosterId(host: WorkspaceHost, hubDirectory: string, hubOwner: string, hubRepository: string): string {
  const document = readHub(host, hubDirectory);
  if (document !== undefined) return document.repository;
  return `${hubOwner}/${hubRepository}`;
}

/**
 * Regenerates the generated `README.md` at the root of `clossys/`: an index of which `clossys/<role>/`
 * folders are active here, and what `.state/` holds. Written on every apply
 * so it never drifts from what is actually on disk (#1171).
 */
function writeClossysReadme(host: WorkspaceHost, directory: string): void {
  const root = join(directory, CLOSSYS_DIR_REL);
  const roles = host
    .isDirectory(root)
    ? host
        .readDir(root)
        .filter((name) => name !== ".state" && name !== "README.md" && host.isDirectory(join(root, name)))
        .sort((a, b) => a.localeCompare(b))
    : [];
  const hasBrief = host.exists(join(root, "brief.json"));
  const lines = [
    "# clossys/",
    "",
    "Generated by `@clossys/launcher`. This file is rewritten on every launcher",
    `run to reflect what is active here; do not edit it by hand. Last generated: ${host.now()}.`,
    "",
    "## Engagement brief",
    "",
    ...(hasBrief
      ? ["`clossys/brief.json` — why each role is staffed here, its goals, handoffs, and sequence (owner: @clossys/advisor)."]
      : ["No engagement brief yet. `@clossys-advisor` writes `clossys/brief.json` once a plan is approved."]),
    "",
    "## Active roles",
    "",
    ...(roles.length === 0
      ? ["No role folder is active here yet."]
      : roles.map((role) => `- \`clossys/${role}/\` — @clossys-${role}`)),
    "",
    "## Machine state",
    "",
    "`clossys/.state/` holds machine files only: the hub marker, the inventory,",
    "and the skills manifest. It is visible so it is easy to find, but it is not",
    "a place a person edits by hand.",
    "",
  ];
  writeSkeletonFile(host, directory, CLOSSYS_README_REL, lines.join("\n"));
}

function composeSkillRoster(
  host: WorkspaceHost,
  hubDirectory: string,
  hubOwner: string,
  hubRepository: string,
  options: { launcherPackageRoot: string; skillCatalogueRoot?: string; contractPath?: string },
): SkillCompositionResult & {
  readonly rosterTargets: readonly string[];
  readonly rosterSkipped: readonly { readonly inventoryId: string; readonly note: string }[];
} {
  const composeOptions = {
    launcherPackageRoot: options.launcherPackageRoot,
    ...(options.skillCatalogueRoot === undefined ? {} : { skillCatalogueRoot: options.skillCatalogueRoot }),
    ...(options.contractPath === undefined ? {} : { contractPath: options.contractPath }),
  };
  const hubSkill = composeSkills(host, hubDirectory, composeOptions);
  writeConsumerAgentsIfNeeded(host, hubDirectory);
  writeClossysReadme(host, hubDirectory);
  const hubId = hubRosterId(host, hubDirectory, hubOwner, hubRepository);
  const rosterTargets: string[] = [hubId];
  const { targets, skipped } = resolveSisterCloneTargets(host, hubDirectory, hubOwner);
  for (const target of targets) {
    composeSkills(host, target.directory, composeOptions);
    writeSisterConsumerAgentsIfNeeded(host, target.directory);
    rosterTargets.push(target.inventoryId);
  }
  return { ...hubSkill, rosterTargets, rosterSkipped: skipped };
}

function finishHubApply(
  host: WorkspaceHost,
  directory: string,
  headline: string,
  launcherPackageRoot: string,
  hubOwner: string,
  hubRepository: string,
  liveAdvisorVersion?: string,
  skillCatalogueRoot?: string,
  contractPath?: string,
  liveLauncherVersion?: string,
  migration?: HubHealthReport["migration"],
): WorkspaceApplyResult {
  const skillComposition = composeSkillRoster(host, directory, hubOwner, hubRepository, {
    launcherPackageRoot,
    ...(skillCatalogueRoot === undefined ? {} : { skillCatalogueRoot }),
    ...(contractPath === undefined ? {} : { contractPath }),
  });
  return withHealth(host, directory, headline, liveAdvisorVersion, skillComposition, liveLauncherVersion, migration);
}

/**
 * Migrates a legacy `.clossys/` hub marker (and its sibling inventory, when
 * present) to `clossys/.state/`, then removes the old directory. Called only
 * when `locateHub` found the marker at the legacy path and nowhere else
 * (`plan.migrateFrom === "legacy"`); a hub with markers at both paths is
 * refused by `planWorkspace` before apply ever runs, so this never merges
 * two hub states.
 */
function migrateLegacyHubState(host: WorkspaceHost, directory: string): HubHealthReport["migration"] {
  const markerRaw = host.readText(join(directory, LEGACY_WORKSPACE_MARKER_REL));
  if (markerRaw === null) return undefined;
  writeSkeletonFile(host, directory, WORKSPACE_MARKER_REL, markerRaw.endsWith("\n") ? markerRaw : `${markerRaw}\n`);
  const inventoryRaw = host.readText(join(directory, LEGACY_WORKSPACE_INVENTORY_REL));
  if (inventoryRaw !== null) {
    writeSkeletonFile(host, directory, WORKSPACE_INVENTORY_REL, inventoryRaw.endsWith("\n") ? inventoryRaw : `${inventoryRaw}\n`);
  }
  host.remove(join(directory, LEGACY_STATE_DIR_REL));
  return { status: "migrated", from: LEGACY_STATE_DIR_REL, to: STATE_DIR_REL };
}

/** Applies a create, resume, or adopt plan through the host. Resume refreshes composed skills and stale AGENTS.md guidance. */
export function applyWorkspacePlan(
  host: WorkspaceHost,
  plan: WorkspacePlan,
  skeletonRoot: string,
  options: ApplyWorkspaceOptions = {},
): WorkspaceApplyResult {
  const launcherPackageRoot = options.launcherPackageRoot ?? resolve(skeletonRoot, "..");
  const skillCatalogueRoot = options.skillCatalogueRoot;
  const contractPath = options.contractPath;
  const liveLauncherVersion = options.liveLauncherVersion;
  if (plan.action === "resume") {
    if (plan.clone) {
      requireZero(
        host.run("gh", ["repo", "clone", `${plan.owner}/${plan.repository}`, plan.directory]),
        "gh repo clone",
      );
    }
    const migration = plan.migrateFrom === "legacy" ? migrateLegacyHubState(host, plan.directory) : undefined;
    return finishHubApply(
      host,
      plan.directory,
      `resumed ${plan.owner}/${plan.repository} as the account hub\nOpen this folder in your coding agent. Advisor stays read-only until you approve a next action.`,
      launcherPackageRoot,
      plan.owner,
      plan.repository,
      plan.advisorVersion,
      skillCatalogueRoot,
      contractPath,
      liveLauncherVersion,
      migration,
    );
  }
  if (plan.action === "create") {
    copySkeleton(host, skeletonRoot, plan);
    requireZero(
      host.run(
        "gh",
        ["repo", "create", `${plan.owner}/${plan.repository}`, "--private", "--source", plan.directory, "--remote", "origin", "--push"],
        { cwd: plan.directory },
      ),
      "gh repo create",
    );
    return finishHubApply(
      host,
      plan.directory,
      `created ${plan.owner}/${plan.repository} as the account hub\nOpen this folder in your coding agent. Advisor stays read-only until you approve a next action.`,
      launcherPackageRoot,
      plan.owner,
      plan.repository,
      plan.advisorVersion,
      skillCatalogueRoot,
      contractPath,
      liveLauncherVersion,
    );
  }
  adoptHubFiles(host, skeletonRoot, plan);
  return finishHubApply(
    host,
    plan.directory,
    `appointed ${plan.owner}/${plan.repository} as the account hub\nExisting project files were kept. This hub inventories engagement; it does not install the catalogue into the repo.`,
    launcherPackageRoot,
    plan.owner,
    plan.repository,
    plan.advisorVersion,
    skillCatalogueRoot,
    contractPath,
    liveLauncherVersion,
  );
}

export function launcherPackageRootFromModule(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..");
}

export function skeletonRootFromModule(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..", "skeleton");
}
