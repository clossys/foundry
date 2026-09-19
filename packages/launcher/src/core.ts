import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CommandResult,
  CwdObservation,
  HubDocument,
  HubHealthReport,
  InventoryObservation,
  WorkspaceApplyResult,
  WorkspaceDecision,
  WorkspaceHost,
  WorkspaceObservation,
  WorkspacePlan,
  WorkspacePlanCreate,
  WorkspaceRefusal,
} from "./types.js";

export const DEFAULT_REPOSITORY_NAME = "workspace";
export const WORKSPACE_MARKER_REL = ".clossys/workspace.json";
export const WORKSPACE_INVENTORY_REL = ".clossys/inventory.json";
export const ADVISOR_PACKAGE = "@clossys/advisor";

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

This repository is the account hub for Foundry packages. It inventories
where packages are installed and coordinates engagement. It is not a
product application and does not need the whole catalogue installed here.

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

function readHub(host: WorkspaceHost, directory: string): HubDocument | undefined {
  const raw = host.readText(join(directory, WORKSPACE_MARKER_REL));
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isHubDocument(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Classifies a generated hub inventory (packed template skeleton/.clossys/inventory.json; the generated path does not ship) without inventing repositories. */
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

/** Collects GitHub owner, cwd shape, default-hub presence, and the public Advisor pin. */
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

  const cwdObservation: CwdObservation = {
    absolutePath: cwd,
    empty: isEffectivelyEmpty(entries),
    git,
    ...(githubOwner === undefined ? {} : { githubOwner }),
    ...(githubRepository === undefined ? {} : { githubRepository }),
    ...(readHub(host, cwd) === undefined ? {} : { hub: readHub(host, cwd) }),
    looksLikeFoundry: looksLikeFoundry(host, cwd),
    inventory: inspectInventory(host.readText(join(cwd, WORKSPACE_INVENTORY_REL))),
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
function resolveAdoptInventory(
  host: WorkspaceHost,
  cwd: CwdObservation,
  inventoryPath: string | undefined,
): { inventorySource?: string } | WorkspaceRefusal {
  if (cwd.inventory?.status === "populated") return {};
  const trimmed = inventoryPath?.trim();
  if (!trimmed) {
    return refuse(
      "violated",
      "appointing requires a populated generated hub inventory (packed template skeleton/.clossys/inventory.json; the generated path does not ship), or --inventory <path> to a populated inventory document",
    );
  }
  const resolved = resolve(cwd.absolutePath, trimmed);
  const imported = inspectInventory(host.readText(resolved));
  if (imported.status !== "populated") {
    return refuse(
      "violated",
      "--inventory must point at a populated inventory document (schemaVersion 1, nonempty repositories)",
    );
  }
  return { inventorySource: resolved };
}

export function planWorkspace(
  observation: WorkspaceObservation,
  host: WorkspaceHost,
  options: { inventoryPath?: string } = {},
): WorkspaceDecision {
  const { cwd } = observation;
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
    throw new Error(`refusing to write outside the hub directory: ${relativePath}`);
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

/** Leaves an existing Advisor pin in whichever bucket it already occupies. */
function mergeAdvisorPin(
  host: WorkspaceHost,
  directory: string,
  skeletonRoot: string,
  advisorVersion: string,
  repository: string,
): void {
  const path = join(directory, "package.json");
  const raw = host.readText(path);
  if (raw === null) {
    const skeleton = host.readText(join(skeletonRoot, "package.json"));
    if (skeleton === null) throw new Error("missing skeleton package.json");
    writeSkeletonFile(host, directory, "package.json", substitute(skeleton, { owner: repository, repository, advisorVersion }));
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
  const extra = new Set<string>();
  const inDependencies = clossysNames(manifest.dependencies, extra);
  const inDevDependencies = clossysNames(manifest.devDependencies, extra);
  if (inDependencies !== undefined || inDevDependencies !== undefined) return;
  const devDependencies = isRecord(manifest.devDependencies) ? { ...manifest.devDependencies } : {};
  devDependencies[ADVISOR_PACKAGE] = advisorVersion;
  manifest.devDependencies = devDependencies;
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

function adoptHubFiles(host: WorkspaceHost, skeletonRoot: string, plan: WorkspacePlan & { advisorVersion: string }): void {
  const marker = {
    schemaVersion: 1,
    kind: "account-hub",
    owner: plan.owner,
    repository: `${plan.owner}/${plan.repository}`,
  };
  writeSkeletonFile(host, plan.directory, WORKSPACE_MARKER_REL, `${JSON.stringify(marker, null, 2)}\n`);
  if ("inventorySource" in plan && typeof plan.inventorySource === "string") {
    const raw = host.readText(plan.inventorySource);
    if (raw === null || inspectInventory(raw).status !== "populated") {
      throw new Error("inventory source is not a populated inventory document");
    }
    writeSkeletonFile(host, plan.directory, WORKSPACE_INVENTORY_REL, raw.endsWith("\n") ? raw : `${raw}\n`);
  }
  if (host.readText(join(plan.directory, "AGENTS.md")) === null) {
    writeSkeletonFile(host, plan.directory, "AGENTS.md", CONSUMER_AGENTS_MD);
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
  mergeAdvisorPin(host, plan.directory, skeletonRoot, plan.advisorVersion, plan.repository);
}

function requireZero(result: CommandResult, label: string): void {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`);
  }
}

/** Read-only pin and inventory report. Does not install or uninstall. */
export function reportHubHealth(host: WorkspaceHost, directory: string, liveAdvisorVersion?: string): HubHealthReport {
  const extra = new Set<string>();
  let dependencies: string | undefined;
  let devDependencies: string | undefined;
  const manifestRaw = host.readText(join(directory, "package.json"));
  if (manifestRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(manifestRaw);
      if (isRecord(parsed)) {
        dependencies = clossysNames(parsed.dependencies, extra);
        devDependencies = clossysNames(parsed.devDependencies, extra);
      }
    } catch {
      /* unreadable manifest is reported as missing pins */
    }
  }
  return {
    marker: readHub(host, directory) === undefined ? "missing" : "present",
    inventory: inspectInventory(host.readText(join(directory, WORKSPACE_INVENTORY_REL))),
    advisorPin: {
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(devDependencies === undefined ? {} : { devDependencies }),
      ...(liveAdvisorVersion === undefined ? {} : { live: liveAdvisorVersion }),
    },
    dualPin: dependencies !== undefined && devDependencies !== undefined,
    extraClossys: [...extra].sort(),
  };
}

export function formatHubHealth(report: HubHealthReport): string {
  const pinParts: string[] = [];
  if (report.advisorPin.dependencies !== undefined) pinParts.push(`dependencies ${report.advisorPin.dependencies}`);
  if (report.advisorPin.devDependencies !== undefined) pinParts.push(`devDependencies ${report.advisorPin.devDependencies}`);
  const pin = pinParts.length === 0 ? "missing" : pinParts.join(" and ");
  const live = report.advisorPin.live === undefined ? "" : `; live ${report.advisorPin.live}`;
  const extra = report.extraClossys.length === 0 ? "none" : report.extraClossys.join(", ");
  const inventory =
    report.inventory.status === "populated" ? `populated (${report.inventory.count})` : report.inventory.status;
  return [
    `hub marker: ${report.marker}`,
    `inventory: ${inventory}`,
    `advisor pin: ${pin}${live}`,
    `dual pin: ${report.dualPin ? "yes" : "no"}`,
    `extra @clossys/*: ${extra}`,
    `health: ${JSON.stringify(report)}`,
  ].join("\n");
}

function withHealth(
  host: WorkspaceHost,
  directory: string,
  headline: string,
  liveAdvisorVersion?: string,
): WorkspaceApplyResult {
  const health = reportHubHealth(host, directory, liveAdvisorVersion);
  return {
    state: "satisfied",
    message: `${headline}\n${formatHubHealth(health)}`,
    health,
  };
}

/** Applies a create, resume, or adopt plan through the host. Resume does not write. */
export function applyWorkspacePlan(host: WorkspaceHost, plan: WorkspacePlan, skeletonRoot: string): WorkspaceApplyResult {
  if (plan.action === "resume") {
    if (plan.clone) {
      requireZero(
        host.run("gh", ["repo", "clone", `${plan.owner}/${plan.repository}`, plan.directory]),
        "gh repo clone",
      );
    }
    return withHealth(
      host,
      plan.directory,
      `resumed ${plan.owner}/${plan.repository} as the account hub\nOpen this folder in your coding agent. Advisor stays read-only until you approve a next action.`,
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
    return withHealth(
      host,
      plan.directory,
      `created ${plan.owner}/${plan.repository} as the account hub\nOpen this folder in your coding agent. Advisor stays read-only until you approve a next action.`,
      plan.advisorVersion,
    );
  }
  adoptHubFiles(host, skeletonRoot, plan);
  return withHealth(
    host,
    plan.directory,
    `appointed ${plan.owner}/${plan.repository} as the account hub\nExisting project files were kept. This hub inventories engagement; it does not install the catalogue into the repo.`,
    plan.advisorVersion,
  );
}

export function skeletonRootFromModule(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..", "skeleton");
}
