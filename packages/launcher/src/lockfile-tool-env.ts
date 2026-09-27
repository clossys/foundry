import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

export type LockfileTool = "npm" | "pnpm" | "yarn";

export interface LockfileToolEnvInput {
  readonly tool: LockfileTool;
  /** Absolute scratch directory (a fresh mkdtemp outside the regenerated root). */
  readonly scratch: string;
  /** The publishing registry, without trailing slash. Used for COREPACK_NPM_REGISTRY. */
  readonly registry: string;
  /** Whether the tool is launched through corepack (pnpm and Yarn). */
  readonly corepack: boolean;
  /** The parent environment; only PATH and COREPACK_HOME are ever read from it. */
  readonly parent: Readonly<Record<string, string | undefined>>;
}

/** Every key lockfileToolEnv can produce, for callers asserting an exact key set. */
export const LOCKFILE_TOOL_ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "npm_config_cache",
  "npm_config_ignore_scripts",
  "npm_config_audit",
  "npm_config_fund",
  "npm_config_update_notifier",
  "pnpm_config_update_notifier",
  "YARN_ENABLE_SCRIPTS",
  "YARN_ENABLE_TELEMETRY",
  "YARN_ENABLE_GLOBAL_CACHE",
  "YARN_CACHE_FOLDER",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  "COREPACK_NPM_REGISTRY",
  "COREPACK_HOME",
] as const);

const nonEmptyString = (value: string | undefined): value is string => typeof value === "string" && value.length > 0;

/**
 * Keeps only absolute entries of a PATH-shaped string, in their original order.
 * An empty, `.` or otherwise relative entry would resolve against the child's
 * cwd (the regenerated repository root), letting a committed file shadow
 * `npm`, `corepack`, or npm's own `git` lookup. Falls back to /usr/bin:/bin
 * when nothing absolute remains.
 */
function absolutePathEntries(path: string): string {
  const entries = path.split(delimiter).filter((entry) => entry.length > 0 && isAbsolute(entry));
  return entries.length > 0 ? entries.join(delimiter) : "/usr/bin:/bin";
}

/**
 * Builds the child environment from a literal allow-list. Never spreads the
 * parent. Creates nothing on disk: the empty config files and cache paths it
 * names are made by prepareLockfileScratch. User and global config are two
 * distinct empty files: npm 11 refuses to load one file as both.
 */
export function lockfileToolEnv(input: LockfileToolEnvInput): Record<string, string> {
  const { tool, scratch, registry, corepack, parent } = input;
  const home = join(scratch, "home");
  const tmp = join(scratch, "tmp");
  const env: Record<string, string> = {
    PATH: absolutePathEntries(nonEmptyString(parent.PATH) ? parent.PATH : "/usr/bin:/bin"),
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_CONFIG_HOME: join(scratch, "xdg", "config"),
    XDG_CACHE_HOME: join(scratch, "xdg", "cache"),
    XDG_DATA_HOME: join(scratch, "xdg", "data"),
    XDG_STATE_HOME: join(scratch, "xdg", "state"),
    npm_config_userconfig: join(scratch, "empty-npmrc"),
    npm_config_globalconfig: join(scratch, "empty-global-npmrc"),
    npm_config_cache: join(scratch, "npm-cache"),
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  // pnpm 12 reads its update check from this key only, not npm_config_update_notifier.
  if (tool === "pnpm") env.pnpm_config_update_notifier = "false";
  if (tool === "yarn") {
    env.YARN_ENABLE_SCRIPTS = "0";
    env.YARN_ENABLE_TELEMETRY = "0";
    env.YARN_ENABLE_GLOBAL_CACHE = "0";
    env.YARN_CACHE_FOLDER = join(scratch, "yarn-cache");
  }
  if (corepack) {
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
    env.COREPACK_NPM_REGISTRY = registry;
    if (nonEmptyString(parent.COREPACK_HOME)) env.COREPACK_HOME = parent.COREPACK_HOME;
  }
  return env;
}

export interface LockfileScratch {
  readonly path: string;
  /** Removes the scratch directory; safe to call twice. */
  remove(): Promise<void>;
}

const SCRATCH_SUBDIRECTORIES = ["home", "tmp", join("xdg", "config"), join("xdg", "cache"), join("xdg", "data"), join("xdg", "state"), "npm-cache", "yarn-cache"];

/** Creates a fresh scratch directory under the OS temp root with the empty config file and home/cache/xdg subdirectories. */
export async function prepareLockfileScratch(): Promise<LockfileScratch> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "launcher-lockfile-"));
  try {
    for (const subdirectory of SCRATCH_SUBDIRECTORIES) await mkdir(join(root, subdirectory), { recursive: true });
    for (const file of ["empty-npmrc", "empty-global-npmrc"]) await writeFile(join(root, file), "", { mode: 0o600 });
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
  return {
    path: root,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
