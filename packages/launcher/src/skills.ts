import { dirname, join, resolve, sep } from "node:path";
import type { WorkspaceHost } from "./types.js";

export interface SkillCompositionResult {
  readonly composed: readonly string[];
  readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
}

export interface ComposeSkillsOptions {
  readonly skillCatalogueRoot?: string;
  readonly launcherPackageRoot: string;
}

const DISCOVERY_PREFIXES = [".cursor/skills", ".claude/skills"] as const;
const AGENTS_SKILLS_REL = join(".agents", "skills");

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

function readSkillBody(host: WorkspaceHost, packageDir: string, options: ComposeSkillsOptions): string | null {
  for (const path of skillSourceCandidates(packageDir, options)) {
    const body = host.readText(path);
    if (body !== null) return body;
  }
  return null;
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

/**
 * Writes `.agents/skills/clossys-<pkg>/SKILL.md` and host discovery links for every
 * catalogue package. Missing sources are skipped with notes; the hub apply continues.
 */
export function composeSkills(
  host: WorkspaceHost,
  directory: string,
  options: ComposeSkillsOptions,
): SkillCompositionResult {
  const composed: string[] = [];
  const skipped: { packageDir: string; note: string }[] = [];
  for (const packageDir of listSkillPackageCandidates(host, options)) {
    const body = readSkillBody(host, packageDir, options);
    if (body === null) {
      skipped.push({ packageDir, note: "skill source missing at apply time" });
      continue;
    }
    writeAgentsSkill(host, directory, packageDir, body);
    writeDiscoveryLink(host, directory, packageDir, body);
    composed.push(packageDir);
  }
  return { composed, skipped };
}
