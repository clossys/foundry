import { dirname, join, resolve, sep } from "node:path";
import { extractContractBlock, injectContract } from "./contract.js";
import { parseSkillManifest, readInstalledVersion, serializeSkillManifest, sha256Hex } from "./manifest.js";
import type { SkillManifestEntry, WorkspaceHost } from "./types.js";

export interface SkillCompositionResult {
  readonly composed: readonly string[];
  readonly skipped: readonly { readonly packageDir: string; readonly note: string }[];
  /** Populated by ./core.ts's composeSkillRoster with stored-inventory position labels, never raw ids -- see its own doc comment. */
  readonly rosterTargets?: readonly string[];
  readonly rosterSkipped?: readonly { readonly inventoryId: string; readonly note: string }[];
  /** Skills pruned this run: present in the directory's previous manifest, absent from this run's composed set. */
  readonly retired: readonly string[];
  /**
   * Skills this run left exactly as found instead of rewriting or retiring them,
   * because a file at their composed location is not one Launcher can show it
   * wrote (#1473). Each needs the client's decision; see `note`.
   */
  readonly preserved: readonly SkillPreservation[];
}

/** One composed skill left untouched because its on-disk content is not provably Launcher's (#1473). */
export interface SkillPreservation {
  readonly packageDir: string;
  /** What this run would have done to the skill had Launcher still owned it. */
  readonly action: "rewrite" | "retire";
  /** The file or directory that failed the ownership check, relative to the composed directory. */
  readonly path: string;
  readonly note: string;
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

function writeAgentsSkill(host: WorkspaceHost, directory: string, packageDir: string, content: string): void {
  const target = containedPath(directory, join(agentsSkillDirRel(packageDir), "SKILL.md"));
  host.mkdirp(dirname(target));
  host.writeText(target, content);
}

function writeDiscoveryLink(host: WorkspaceHost, directory: string, packageDir: string, content: string): void {
  const linkTarget = join("..", "..", agentsSkillDirRel(packageDir));
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
      host.writeText(fallbackDir, content);
    }
  }
}

function agentsSkillDirRel(packageDir: string): string {
  return join(AGENTS_SKILLS_REL, `clossys-${packageDir}`);
}

/**
 * The on-disk locations that hold a copy of this skill's composed content:
 * `.agents/skills/clossys-<pkg>/`, plus any host discovery path that is a real
 * directory rather than a symlink (the copy `writeDiscoveryLink` falls back to
 * when a symlink cannot be made, or a directory someone else put there). A
 * discovery symlink holds no content of its own and is not listed.
 */
function skillCopyLocations(host: WorkspaceHost, directory: string, packageDir: string): { rel: string; replacedWhole: boolean }[] {
  const locations: { rel: string; replacedWhole: boolean }[] = [{ rel: agentsSkillDirRel(packageDir), replacedWhole: false }];
  for (const prefix of DISCOVERY_PREFIXES) {
    if (host.isSymlink(containedPath(directory, prefix))) continue;
    const rel = join(prefix, `clossys-${packageDir}`);
    const path = containedPath(directory, rel);
    if (host.isSymlink(path) || !host.exists(path)) continue;
    // `host.symlink` removes whatever sits at a discovery path before linking, so
    // everything in that directory is replaced, not just SKILL.md.
    locations.push({ rel, replacedWhole: true });
  }
  return locations;
}

/**
 * Decides whether Launcher may rewrite (`intendedBody` given) or remove
 * (`intendedBody` undefined) a composed skill (#1473). The digest recorded in
 * the previous manifest is the ownership record: a copy whose bytes hash to it
 * is still exactly what Launcher last wrote. A copy byte-identical to what this
 * run would write is also safe to adopt, since nothing would be lost. Anything
 * else is the client's, and is left alone. Returns the first location that
 * fails, or null when every location may be changed.
 */
function unownedSkillCopy(
  host: WorkspaceHost,
  directory: string,
  packageDir: string,
  recordedSha256: string | undefined,
  intendedBody: string | undefined,
): { path: string; location: string; reason: string } | null {
  const removing = intendedBody === undefined;
  for (const location of skillCopyLocations(host, directory, packageDir)) {
    const dirPath = containedPath(directory, location.rel);
    if (!host.exists(dirPath)) continue;
    if (!host.isDirectory(dirPath)) {
      return { path: location.rel, location: location.rel, reason: "is not a directory Launcher wrote" };
    }
    if (removing || location.replacedWhole) {
      // .DS_Store is macOS Finder metadata, written just by viewing the folder; it holds no client content.
      const others = host.readDir(dirPath).filter((name) => name !== "SKILL.md" && name !== ".DS_Store");
      if (others.length > 0) {
        return { path: location.rel, location: location.rel, reason: `holds files Launcher did not write (${others.sort().join(", ")})` };
      }
    }
    const skillRel = join(location.rel, "SKILL.md");
    const skillPath = containedPath(directory, skillRel);
    const current = host.readText(skillPath);
    if (current === null) {
      // readText returns null for any read failure (EACCES, EISDIR, ...), not only a missing file.
      if (!host.exists(skillPath)) continue;
      return { path: skillRel, location: location.rel, reason: "exists but could not be read, so Launcher cannot check it against its digest" };
    }
    if (recordedSha256 !== undefined && sha256Hex(current) === recordedSha256) continue;
    if (intendedBody !== undefined && current === intendedBody) continue;
    return {
      path: skillRel,
      location: location.rel,
      reason:
        recordedSha256 === undefined
          ? "has no digest recorded in clossys/.state/skills.json, so Launcher cannot show it wrote this file"
          : "was edited since Launcher last wrote it (its content no longer matches the digest in clossys/.state/skills.json)",
    };
  }
  return null;
}

function preservationNote(action: "rewrite" | "retire", unowned: { path: string; location: string; reason: string }): string {
  const remedy =
    action === "rewrite"
      ? `to take Launcher's current version instead, move your copy aside, delete \`${unowned.location}\`, and run launcher again`
      : `Launcher no longer composes this skill; delete \`${unowned.location}\` yourself if you no longer want it, and the next run completes the retirement`;
  return `${unowned.path} ${unowned.reason}; left as is -- ${remedy}`;
}

/** Removes a composed skill's `.agents/skills/` directory and its host discovery links. Missing paths are no-ops. */
function removeComposedSkill(host: WorkspaceHost, directory: string, packageDir: string): void {
  host.remove(containedPath(directory, agentsSkillDirRel(packageDir)));
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
 *
 * Before rewriting or retiring a skill, the on-disk copy is checked against the
 * digest that manifest recorded (#1473). A copy that no longer matches (the
 * client edited it), or one with no recorded digest that differs from what this
 * run would write, is left exactly as found and reported in `preserved`; its
 * previous manifest entry, if any, is carried forward unchanged so the next run
 * checks it again. A missing copy is recreated: `.agents/skills` is
 * Launcher-generated output, and recreating it loses no client content.
 */
export function composeSkills(
  host: WorkspaceHost,
  directory: string,
  options: ComposeSkillsOptions,
): SkillCompositionResult {
  const composed: string[] = [];
  const skipped: { packageDir: string; note: string }[] = [];
  const preserved: SkillPreservation[] = [];
  const manifestEntries: SkillManifestEntry[] = [];
  const contractBlock = readContractBlock(host, options);
  const launcherVersion = readLauncherVersion(host, options);
  const previousManifest = parseSkillManifest(host.readText(join(directory, SKILLS_MANIFEST_REL)));
  const previousEntries = new Map((previousManifest?.skills ?? []).map((entry) => [entry.name, entry]));
  const handled = new Set<string>();

  for (const packageDir of listSkillPackageCandidates(host, options)) {
    const found = readSkillBody(host, packageDir, options, directory);
    if (found === null) {
      skipped.push({ packageDir, note: "skill source missing at apply time" });
      continue;
    }
    const body = contractBlock === null ? found.body : injectContract(found.body, contractBlock);
    const content = body.endsWith("\n") ? body : `${body}\n`;
    const previous = previousEntries.get(packageDir);
    handled.add(packageDir);
    const unowned = unownedSkillCopy(host, directory, packageDir, previous?.sha256, content);
    if (unowned !== null) {
      preserved.push({
        packageDir,
        action: "rewrite",
        path: unowned.path,
        note: preservationNote("rewrite", unowned),
      });
      if (previous !== undefined) manifestEntries.push(previous);
      continue;
    }
    writeAgentsSkill(host, directory, packageDir, content);
    writeDiscoveryLink(host, directory, packageDir, content);
    composed.push(packageDir);
    const version = found.source === "installed" ? readInstalledVersion(host, directory, packageDir) : launcherVersion;
    manifestEntries.push({
      name: packageDir,
      source: found.source,
      sha256: sha256Hex(content),
      ...(version === undefined ? {} : { version }),
    });
  }

  const retired: string[] = [];
  for (const entry of previousManifest?.skills ?? []) {
    if (handled.has(entry.name)) continue;
    const unowned = unownedSkillCopy(host, directory, entry.name, entry.sha256, undefined);
    if (unowned !== null) {
      preserved.push({
        packageDir: entry.name,
        action: "retire",
        path: unowned.path,
        note: preservationNote("retire", unowned),
      });
      manifestEntries.push(entry);
      continue;
    }
    removeComposedSkill(host, directory, entry.name);
    retired.push(entry.name);
  }

  const manifestPath = containedPath(directory, SKILLS_MANIFEST_REL);
  host.mkdirp(dirname(manifestPath));
  host.writeText(
    manifestPath,
    serializeSkillManifest({ schemaVersion: 1, generatedAt: host.now(), skills: manifestEntries }),
  );

  return { composed, skipped, retired, preserved };
}
