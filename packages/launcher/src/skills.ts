import { dirname, join, resolve, sep } from "node:path";
import { extractContractBlock, injectContract } from "./contract.js";
import { parseSkillManifest, readInstalledVersion, serializeSkillManifest, sha256Hex } from "./manifest.js";
import type { SkillManifestEntry, WorkspaceHost } from "./types.js";

export interface SkillCompositionResult {
  readonly composed: readonly string[];
  readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
  readonly rosterTargets?: readonly string[];
  readonly rosterSkipped?: readonly { readonly inventoryId: string; readonly note: string }[];
  /** Skills pruned this run: present in the directory's previous manifest, absent from this run's composed set. */
  readonly retired: readonly string[];
}

export interface ComposeSkillsOptions {
  readonly skillCatalogueRoot?: string;
  readonly launcherPackageRoot: string;
  /** Overrides where the packed conversation contract is read from (tests). */
  readonly contractPath?: string;
}

export const DISCOVERY_PREFIXES = [".cursor/skills", ".claude/skills"] as const;
const AGENTS_SKILLS_REL = join(".agents", "skills");
export const SKILLS_MANIFEST_REL = join("clossys", ".state", "skills.json");

function containedPath(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`refusing to write outside the workspace directory: ${relativePath}`);
  }
  return resolved;
}

function skillSourceCandidates(packageDir: string, options: ComposeSkillsOptions): string[] {
  const paths: string[] = [];
  if (options.skillCatalogueRoot) {
    paths.push(join(options.skillCatalogueRoot, packageDir, "SKILL.md"));
  }
  paths.push(join(options.launcherPackageRoot, "skill-catalogue", packageDir, "SKILL.md"));
  paths.push(join(options.launcherPackageRoot, "..", packageDir, "skill", "SKILL.md"));
  return paths;
}

function installedSkillPath(composeTargetDirectory: string, packageDir: string): string {
  return join(composeTargetDirectory, "node_modules", "@clossys", packageDir, "skill", "SKILL.md");
}

function readSkillBody(
  host: WorkspaceHost,
  packageDir: string,
  options: ComposeSkillsOptions,
  composeTargetDirectory: string,
): { body: string; source: "installed" | "catalogue" } | null {
  const installed = host.readText(installedSkillPath(composeTargetDirectory, packageDir));
  if (installed !== null) return { body: installed, source: "installed" };
  for (const path of skillSourceCandidates(packageDir, options)) {
    const body = host.readText(path);
    if (body !== null) return { body, source: "catalogue" };
  }
  return null;
}

function contractSourceCandidates(options: ComposeSkillsOptions): string[] {
  const paths: string[] = [];
  if (options.contractPath) paths.push(options.contractPath);
  paths.push(join(options.launcherPackageRoot, "contracts", "conversation-contract.md"));
  // Monorepo fallback so tests and dev runs work without a prior `npm run build` pack step.
  paths.push(join(options.launcherPackageRoot, "..", "..", "docs", "contracts", "conversation-contract.md"));
  return paths;
}

/** Reads and extracts the shared conversation contract block. Returns null when no source resolves. */
function readContractBlock(host: WorkspaceHost, options: ComposeSkillsOptions): string | null {
  for (const path of contractSourceCandidates(options)) {
    const raw = host.readText(path);
    if (raw === null) continue;
    try {
      return extractContractBlock(raw);
    } catch {
      continue;
    }
  }
  return null;
}

function readLauncherVersion(host: WorkspaceHost, options: ComposeSkillsOptions): string | undefined {
  const raw = host.readText(join(options.launcherPackageRoot, "package.json"));
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version.trim() !== "") return version;
    }
  } catch {
    /* unreadable manifest; no version */
  }
  return undefined;
}

/** Package directory names that have a resolvable skill source in the catalogue or monorepo. */
export function listSkillPackageCandidates(host: WorkspaceHost, options: ComposeSkillsOptions): string[] {
  const names = new Set<string>();
  const considerRoot = (root: string | undefined): void => {
    if (root === undefined || !host.isDirectory(root)) return;
    for (const name of host.readDir(root)) {
      if (name.startsWith(".")) continue;
      const skillPath = join(root, name, "SKILL.md");
      if (host.readText(skillPath) !== null) names.add(name);
    }
  };
  considerRoot(options.skillCatalogueRoot);
  considerRoot(join(options.launcherPackageRoot, "skill-catalogue"));
  const packagesSibling = join(options.launcherPackageRoot, "..");
  if (host.isDirectory(packagesSibling)) {
    for (const name of host.readDir(packagesSibling)) {
      if (name.startsWith(".")) continue;
      const skillPath = join(packagesSibling, name, "skill", "SKILL.md");
      if (host.readText(skillPath) !== null) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function writeAgentsSkill(host: WorkspaceHost, directory: string, packageDir: string, body: string): void {
  const relativeDir = join(AGENTS_SKILLS_REL, `clossys-${packageDir}`);
  const skillRel = join(relativeDir, "SKILL.md");
  const target = containedPath(directory, skillRel);
  host.mkdirp(dirname(target));
  host.writeText(target, body.endsWith("\n") ? body : `${body}\n`);
}

function writeDiscoveryLink(host: WorkspaceHost, directory: string, packageDir: string, skillBody: string): void {
  const agentsDirRel = join(AGENTS_SKILLS_REL, `clossys-${packageDir}`);
  const linkTarget = join("..", "..", agentsDirRel);
  for (const prefix of DISCOVERY_PREFIXES) {
    const prefixPath = containedPath(directory, prefix);
    // A directory-symlink onto `.agents/skills` already exposes every composed
    // skill. Writing a nested `.claude/skills/clossys-<pkg>` link follows that
    // symlink and replaces the just-written SKILL.md with a circular link.
    if (host.isSymlink(prefixPath)) continue;
    const linkRel = join(prefix, `clossys-${packageDir}`);
    const linkPath = containedPath(directory, linkRel);
    host.mkdirp(dirname(linkPath));
    try {
      host.symlink(linkTarget, linkPath);
    } catch {
      const fallbackDir = containedPath(directory, join(linkRel, "SKILL.md"));
      host.mkdirp(dirname(fallbackDir));
      host.writeText(fallbackDir, skillBody.endsWith("\n") ? skillBody : `${skillBody}\n`);
    }
  }
}

/** Removes a composed skill's `.agents/skills/` directory and its host discovery links. Missing paths are no-ops. */
function removeComposedSkill(host: WorkspaceHost, directory: string, packageDir: string): void {
  host.remove(containedPath(directory, join(AGENTS_SKILLS_REL, `clossys-${packageDir}`)));
  for (const prefix of DISCOVERY_PREFIXES) {
    const prefixPath = containedPath(directory, prefix);
    if (host.isSymlink(prefixPath)) continue; // shared view onto .agents/skills; already handled above
    host.remove(containedPath(directory, join(prefix, `clossys-${packageDir}`)));
  }
}

/**
 * Writes `.agents/skills/clossys-<pkg>/SKILL.md` and host discovery links for every
 * catalogue package, with the shared conversation contract (#1182) injected in place
 * of each skill's own `## How we work together` / `## One question at a time`
 * sections. Missing sources are skipped with notes; the hub apply continues.
 *
 * Also writes `clossys/.state/skills.json` (#1183): source, version, and content
 * digest per composed skill. A skill named in this directory's *previous* manifest
 * but not composed this run is retired — its composed output is pruned and it is
 * dropped from the new manifest. Never touches a skill this directory's manifest
 * did not itself write.
 */
export function composeSkills(
  host: WorkspaceHost,
  directory: string,
  options: ComposeSkillsOptions,
): SkillCompositionResult {
  const composed: string[] = [];
  const skipped: { packageDir: string; note: string }[] = [];
  const manifestEntries: SkillManifestEntry[] = [];
  const contractBlock = readContractBlock(host, options);
  const launcherVersion = readLauncherVersion(host, options);

  for (const packageDir of listSkillPackageCandidates(host, options)) {
    const found = readSkillBody(host, packageDir, options, directory);
    if (found === null) {
      skipped.push({ packageDir, note: "skill source missing at apply time" });
      continue;
    }
    const body = contractBlock === null ? found.body : injectContract(found.body, contractBlock);
    writeAgentsSkill(host, directory, packageDir, body);
    writeDiscoveryLink(host, directory, packageDir, body);
    composed.push(packageDir);
    const version = found.source === "installed" ? readInstalledVersion(host, directory, packageDir) : launcherVersion;
    manifestEntries.push({
      name: packageDir,
      source: found.source,
      sha256: sha256Hex(body.endsWith("\n") ? body : `${body}\n`),
      ...(version === undefined ? {} : { version }),
    });
  }

  const previousManifest = parseSkillManifest(host.readText(join(directory, SKILLS_MANIFEST_REL)));
  const composedSet = new Set(composed);
  const retired: string[] = [];
  for (const entry of previousManifest?.skills ?? []) {
    if (composedSet.has(entry.name)) continue;
    removeComposedSkill(host, directory, entry.name);
    retired.push(entry.name);
  }

  const manifestPath = containedPath(directory, SKILLS_MANIFEST_REL);
  host.mkdirp(dirname(manifestPath));
  host.writeText(
    manifestPath,
    serializeSkillManifest({ schemaVersion: 1, generatedAt: host.now(), skills: manifestEntries }),
  );

  return { composed, skipped, retired };
}
