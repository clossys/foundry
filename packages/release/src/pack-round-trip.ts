/**
 * `packRoundTrip` — the mechanism this package exists to provide. Every
 * layer below this one reasons about DECLARED shape: a manifest says what it
 * depends on, a catalog says whether that declaration is internally
 * consistent, a policy binding says whether materialized content matches
 * what was promised. None of that proves the package actually installs and
 * loads the way a real, external stranger would install it — with nothing
 * but the registry and whatever they declared. This does: pack the real
 * tarball, install it into a genuinely isolated temporary directory with no
 * workspace file and no sibling `node_modules` to fall back on, and try to
 * actually `import` every subpath the package's own `exports` field claims.
 *
 * Real subprocess work, real I/O, on purpose — this is the first layer of
 * this foundation where that is the point rather than something to avoid.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Finding } from "@vespeneventures/gates";
import type { ImportCheck, RoundTripResult } from "./types.js";

const execFile = promisify(execFileCb);

/**
 * Subprocess timeouts. Generous, because a real `npm install` genuinely can
 * take tens of seconds — but finite, because this function's entire job is
 * to be trustworthy proof, and proof that can hang forever is not proof of
 * anything. A timeout is a clear finding (see `summarizeExecError`), never a
 * silent hang.
 */
const NPM_PACK_TIMEOUT_MS = 60_000;
const NPM_INSTALL_TIMEOUT_MS = 120_000;
const IMPORT_TIMEOUT_MS = 30_000;

/** The kill signal used once a subprocess exceeds its timeout — SIGKILL, not the default SIGTERM, so a subprocess that is ignoring SIGTERM cannot outlive its budget. */
const TIMEOUT_KILL_SIGNAL = "SIGKILL";

/** Options for `packRoundTrip`. */
export interface PackRoundTripOptions {
  /**
   * Skip removing the temporary pack/install directories once this function
   * returns. Useful for debugging a real failure by hand. Defaults to
   * `false` — temporary directories are always cleaned up unless this is
   * explicitly set.
   */
  keepTempDir?: boolean;
  /**
   * An already-packed artifact to install instead of packing `packageDir`
   * again. This is for verifying the exact tarball that a publisher scanned
   * and uploaded; it does not change which package manifest supplies the
   * declared import surface.
   */
  tarballPath?: string;
  /**
   * An explicit registry proof configuration. Omit it to retain the default
   * unauthenticated public-registry proof. A token is used only by child npm
   * processes and is never read from the ambient environment or persisted.
   */
  registry?: RegistryInstallOptions;
  /**
   * Overrides for this round trip's subprocess timeouts, in milliseconds.
   * Each defaults to the sane, generous budget this module ships with
   * (`NPM_PACK_TIMEOUT_MS`, `NPM_INSTALL_TIMEOUT_MS`, `IMPORT_TIMEOUT_MS`)
   * when omitted. Primarily meant for tests that need to exercise the
   * timeout path itself without waiting out the real default budgets — a
   * production caller should rarely need this.
   */
  timeoutsMs?: {
    pack?: number;
    install?: number;
    import?: number;
  };
}

/** Explicit registry credentials for a private-registry install proof. */
export interface RegistryInstallOptions {
  /** Registry URL used for private runtime dependencies. */
  url: string;
  /** Optional token supplied by the caller for this proof only. */
  authToken?: string;
  /**
   * Optional npm scope to map to `url`. When supplied, unscoped dependencies
   * continue resolving from the public npm registry instead of incorrectly
   * looking for them in the private registry.
   */
  scope?: string;
}

/**
 * Builds a deliberately minimal environment for every subprocess this
 * function spawns (`npm pack`, `npm install`, and the `node` import check).
 *
 * Full inheritance of `process.env` would hand each subprocess the
 * OPERATOR's own environment — including whatever registry auth this
 * machine happens to carry. (On the machine this was written on, for
 * example, `~/.npmrc` holds real `_authToken` entries for both the GitHub
 * Packages registry and registry.npmjs.org, and `NODE_AUTH_TOKEN` is
 * commonly set for CI.) A package that only resolves because of a LOCAL
 * credential is not proof of anything an external stranger — who has none
 * of that — would actually experience. So this builds a new environment
 * from scratch rather than filtering `process.env`: a newly introduced
 * secret-shaped variable on some future machine is excluded by default,
 * not something that has to be remembered and denylisted.
 *
 * Passed through, and why (NAMES only, values are whatever this process
 * already has — never logged, never re-derived from a literal):
 *   - `PATH` — required to locate the `npm` and `node` executables, and
 *     anything a package's own install-time script shells out to (e.g. git
 *     for a git dependency, or a native build toolchain).
 *   - `HOME` — required by ordinary POSIX tooling (`os.homedir()`, npm's own
 *     "where do I keep state" logic). This does NOT reintroduce
 *     `~/.npmrc`'s registry auth: `npm_config_userconfig` below points at a
 *     file that is never created, so npm resolves "no user config" instead
 *     of falling back to reading `$HOME/.npmrc`.
 *   - `SystemRoot`, `ComSpec`, `TEMP`, `TMP` (Windows only) — Node's own
 *     child_process/npm do not reliably start on Windows without these; none
 *     of them carry credentials.
 *
 * Explicitly set (not merely inherited), and why:
 *   - `npm_config_userconfig` — a path inside this round trip's own isolated
 *     directory that is never written, so `$HOME/.npmrc` (and whatever
 *     registry auth it holds on the host machine) is never consulted.
 *   - `npm_config_cache` — a fresh cache directory inside this round trip's
 *     own isolated directory, so concurrent round trips (this repository
 *     routinely checks several packages at once) never share npm's cache
 *     and nothing left over from a previous run can leak into this one's
 *     result.
 *   - `npm_config_registry` — pinned explicitly to the public default
 *     (`https://registry.npmjs.org/`), the same registry an external
 *     stranger with no configuration of their own would resolve against,
 *     rather than leaving resolution to whatever registry config happens to
 *     be ambient on the host.
 *   - `npm_config_audit`, `npm_config_fund`, `npm_config_update_notifier` —
 *     disabled. None of them affect whether the package actually imports;
 *     they only add extra network round trips that a slow or offline
 *     environment could hang on, undermining the timeouts above.
 *
 * Excluded (everything else in `process.env`), notably:
 *   - `NODE_AUTH_TOKEN` and any other credential- or token-shaped variable
 *     the operator's own shell happens to carry.
 *   - Any ambient `npm_config_registry`/`NPM_CONFIG_REGISTRY` override that
 *     could repoint resolution away from the public default set above.
 *   - Everything else — the operator's shell environment is not part of
 *     what this function exists to prove.
 *
 * Exported (but deliberately not re-exported from `index.ts`, so it is not
 * part of this package's public surface) so the sanitization itself has a
 * direct, fast unit test rather than only being provable indirectly through
 * a full subprocess round trip.
 */
export function subprocessEnv(
  isolationDir: string,
  registry?: RegistryInstallOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
    npm_config_userconfig: join(isolationDir, "unused-userconfig.npmrc"),
    npm_config_cache: join(isolationDir, "npm-cache"),
    npm_config_registry: registry?.scope ? "https://registry.npmjs.org/" : registry?.url ?? "https://registry.npmjs.org/",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot;
    env.ComSpec = process.env.ComSpec;
    env.TEMP = process.env.TEMP;
    env.TMP = process.env.TMP;
  }
  if (registry?.authToken) {
    env.NODE_AUTH_TOKEN = registry.authToken;
  }
  return env;
}

export function registryAuthConfig(registry: RegistryInstallOptions | undefined): string | undefined {
  if (!registry) return undefined;

  const parsed = new URL(registry.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("packRoundTrip: registry URL must be an HTTPS URL without embedded credentials");
  }
  if (registry.scope && !/^@[a-z0-9][a-z0-9._-]*$/.test(registry.scope)) {
    throw new Error("packRoundTrip: registry scope must be an npm scope such as @example");
  }
  const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  const scopeMapping = registry.scope ? `${registry.scope}:registry=${parsed.href}\n` : "";
  const auth = registry.authToken ? `//${parsed.host}${path}:_authToken=${"${NODE_AUTH_TOKEN}"}\n` : "";
  return scopeMapping || auth ? `${scopeMapping}${auth}` : undefined;
}

/**
 * Extracts a readable, size-bounded summary from a failed subprocess's
 * output — never the full raw text. A subprocess killed for exceeding its
 * timeout is reported as exactly that, never as an opaque "Command failed"
 * with no explanation of why there was nothing to explain it.
 */
function summarizeExecError(error: unknown, timeoutMs: number, maxLines = 8): string {
  const err = error as { stderr?: string; stdout?: string; message?: string; killed?: boolean; signal?: string | null };
  if (err.killed) {
    return `subprocess exceeded its ${timeoutMs}ms timeout and was killed${err.signal ? ` (${err.signal})` : ""}`;
  }
  const raw = (err.stderr && err.stderr.trim()) || (err.stdout && err.stdout.trim()) || err.message || String(error);
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `… (${omitted} more line(s) omitted)`].join("\n");
}

/** A `packageName` that may be `undefined` (a manifest with no `name`), rendered as something readable in a message instead of the literal string `"undefined"`. */
function packageLabel(packageName: string | undefined): string {
  return packageName ?? "<unnamed package>";
}

/**
 * The `exports` subpath keys of an already-parsed `package.json`'s `exports`
 * field, in a form safe to iterate regardless of shape.
 *
 * `exports` has several legal shapes, and only one of them is a map of
 * subpaths:
 *   - a bare string (`"exports": "./index.js"`) is shorthand for a single
 *     root export at `"."`;
 *   - an object whose keys all start with `.` (`{ ".": ..., "./sub": ... }`)
 *     is a genuine subpath map — those keys ARE the subpaths;
 *   - an object with no `.`-prefixed keys at all (`{ "types": ...,
 *     "import": ... }`) is a single root export written directly as a
 *     conditions object, with no `"."` wrapper — Node treats this as
 *     exactly one export, at `"."`, NOT as subpaths named `"types"` and
 *     `"import"`;
 *   - an array (`"exports": ["./index.js"]`) is npm's fallback-list form of
 *     the root export — also exactly one export, at `"."`, not subpaths
 *     `"0"`, `"1"`, ....
 *
 * This function's job is building the actual specifier this round trip will
 * try to `import()`, so an array is resolved to `["."]` rather than treated
 * as empty: `import(packageName)` against that shape genuinely does
 * resolve, and a round trip that skipped checking it would be checking less
 * than what a real consumer can actually do.
 */
function subpathsOf(exportsField: unknown): string[] {
  if (typeof exportsField === "string") return ["."];
  if (Array.isArray(exportsField)) return ["."];
  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const keys = Object.keys(exportsField as Record<string, unknown>);
    const subpathKeys = keys.filter((key) => key.startsWith("."));
    if (subpathKeys.length > 0) return subpathKeys;
    return keys.length > 0 ? ["."] : [];
  }
  return [];
}

/** Turns an `exports` key into the specifier a consumer would actually write in an `import` statement. */
function specifierFor(packageName: string, subpath: string): string {
  if (subpath === ".") return packageName;
  return `${packageName}/${subpath.replace(/^\.\//, "")}`;
}

async function manifestFromTarball(
  tarballPath: string,
  timeout: number,
): Promise<{ name?: string; exports?: unknown }> {
  const { stdout } = await execFile("tar", ["-xOf", tarballPath, "package/package.json"], {
    timeout,
    killSignal: TIMEOUT_KILL_SIGNAL,
  });
  return JSON.parse(stdout) as { name?: string; exports?: unknown };
}

/**
 * Packs `packageDir` for real, installs the resulting tarball into a fresh,
 * isolated temporary directory (outside this repository's own tree, with no
 * workspace file and nothing pre-installed), and attempts to `import` every
 * subpath the packed package's own `exports` field declares — from a Node
 * process whose module resolution root is that isolated directory, not this
 * package's.
 *
 * Never throws for an expected failure mode: a failed `npm pack`, a failed
 * `npm install`, or a failed `import` are all findings on the returned
 * `RoundTripResult`, not exceptions. This only throws for something that
 * makes the whole operation meaningless to attempt at all, such as
 * `packageDir` not containing a `package.json`.
 */
export async function packRoundTrip(packageDir: string, options?: PackRoundTripOptions): Promise<RoundTripResult> {
  const absPackageDir = resolve(packageDir);
  const manifestPath = join(absPackageDir, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`packRoundTrip: no package.json at ${absPackageDir}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    exports?: unknown;
  };
  let packageName = manifest.name;
  let subpaths = subpathsOf(manifest.exports);

  // Two SEPARATE temporary directories: one to receive the packed tarball,
  // and one — genuinely isolated, outside this repository's own tree
  // entirely — to install it into and import from. Neither is a
  // subdirectory of this workspace, so npm finds no workspace file here and
  // no sibling node_modules to fall back on. `tarballDir` also anchors this
  // round trip's sanitized subprocess environment (its own npm cache and a
  // deliberately-absent npmrc — see `subprocessEnv`), so every subprocess
  // below, including `npm pack` itself, runs isolated the same way.
  const tarballDir = mkdtempSync(join(tmpdir(), "release-pack-"));
  const consumerDir = mkdtempSync(join(tmpdir(), "release-consumer-"));
  const env = subprocessEnv(tarballDir, options?.registry);
  // Registry credentials are needed only while npm resolves dependencies.
  // Package code runs during the import probe, so it must never inherit the
  // caller's registry credential through Node's process environment.
  const { NODE_AUTH_TOKEN: _npmAuthToken, ...importEnv } = env;
  const authConfigPath = join(tarballDir, "unused-userconfig.npmrc");
  const packTimeoutMs = options?.timeoutsMs?.pack ?? NPM_PACK_TIMEOUT_MS;
  const installTimeoutMs = options?.timeoutsMs?.install ?? NPM_INSTALL_TIMEOUT_MS;
  const importTimeoutMs = options?.timeoutsMs?.import ?? IMPORT_TIMEOUT_MS;

  try {
    const authConfig = registryAuthConfig(options?.registry);
    if (authConfig) writeFileSync(authConfigPath, authConfig);

    // 1. Pack the real tarball. `npm pack` runs `prepublishOnly`, so what
    //    lands here is exactly what an `npm publish` from this state would
    //    upload — the same mechanism this repository's own artifact-safety
    //    gate uses to scan what actually ships, not the source tree.
    let tarballPath: string;
    if (options?.tarballPath) {
      tarballPath = resolve(options.tarballPath);
      if (!existsSync(tarballPath)) {
        return {
          ok: false,
          packageName,
          tarballPath: "",
          imports: [],
          findings: [tarballMissingFinding(packageName, tarballPath)],
        };
      }
    } else {
      let tarballName: string;
      try {
        const { stdout } = await execFile("npm", ["pack", "--pack-destination", tarballDir], {
          cwd: absPackageDir,
          env,
          timeout: packTimeoutMs,
          killSignal: TIMEOUT_KILL_SIGNAL,
        });
        const lastLine = stdout.trim().split("\n").filter(Boolean).pop();
        if (!lastLine) throw new Error("npm pack produced no output");
        tarballName = lastLine;
      } catch (error) {
        return {
          ok: false,
          packageName,
          tarballPath: "",
          imports: [],
          findings: [packFailedFinding(packageName, summarizeExecError(error, packTimeoutMs))],
        };
      }
      tarballPath = join(tarballDir, tarballName);
    }

    // Read the packed artifact's manifest, rather than continuing to trust
    // the source directory. A caller using `tarballPath` is proving that
    // exact selected artifact, including its own export surface.
    try {
      const artifactManifest = await manifestFromTarball(tarballPath, packTimeoutMs);
      packageName = artifactManifest.name;
      subpaths = subpathsOf(artifactManifest.exports);
    } catch (error) {
      return {
        ok: false,
        packageName,
        tarballPath,
        imports: [],
        findings: [tarballInvalidFinding(packageName, summarizeExecError(error, packTimeoutMs))],
      };
    }
    if (packageName === undefined) {
      return {
        ok: false,
        packageName,
        tarballPath,
        imports: [],
        findings: [tarballInvalidFinding(packageName, "package/package.json has no name")],
      };
    }

    // 2. A minimal, real consumer project in the isolated directory — just
    //    enough for `npm install` to have somewhere to install into. `.npmrc`
    //    is deliberately NOT written here: installing a package from a local
    //    tarball path resolves the tarball itself with zero registry
    //    contact. A registry is only ever consulted for THAT package's own
    //    declared dependencies — and whether that resolution succeeds is
    //    exactly the thing under test, not something to route around.
    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify({ name: "round-trip-consumer", private: true, type: "module" }, null, 2),
    );

    // 3. Install the local tarball for real. If this fails, that IS the
    //    interesting finding — there is nothing installed to import, so step
    //    4 is skipped entirely.
    try {
      await execFile("npm", ["install", tarballPath], {
        cwd: consumerDir,
        env,
        timeout: installTimeoutMs,
        killSignal: TIMEOUT_KILL_SIGNAL,
      });
    } catch (error) {
      return {
        ok: false,
        packageName,
        tarballPath,
        imports: [],
        findings: [installFailedFinding(packageName, summarizeExecError(error, installTimeoutMs))],
      };
    }

    // 4. Every declared export subpath, imported from a Node process whose
    //    cwd — and therefore module resolution root — is the isolated
    //    consumer directory, not this package's own node_modules. Each
    //    subpath runs its own subprocess so one crashing import can never
    //    hide the result of the next.
    //
    //    A package that declares no importable subpath at all (`"exports":
    //    {}`, or no `exports` field resolving to anything) runs zero
    //    imports here — and that is itself the finding, not a clean pass.
    //    This function exists to prove importability; a round trip that
    //    checked nothing proves nothing, so it must never report `ok: true`
    //    for having imported zero subpaths.
    const imports: ImportCheck[] = [];
    const findings: Finding[] = [];
    if (subpaths.length === 0) {
      findings.push(noExportsFinding(packageName));
    }
    for (const subpath of subpaths) {
      const specifier = specifierFor(packageName, subpath);
      const script =
        `import(${JSON.stringify(specifier)})` +
        `.then(() => { process.exit(0); })` +
        `.catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); });`;
      try {
        await execFile("node", ["--input-type=module", "-e", script], {
          cwd: consumerDir,
          env: importEnv,
          timeout: importTimeoutMs,
          killSignal: TIMEOUT_KILL_SIGNAL,
        });
        imports.push({ subpath, ok: true });
      } catch (error) {
        const message = summarizeExecError(error, importTimeoutMs);
        imports.push({ subpath, ok: false, error: message });
        findings.push(importFailedFinding(packageName, subpath, message));
      }
    }

    return { ok: findings.length === 0, packageName, tarballPath, imports, findings };
  } finally {
    // `keepTempDir` is for import debugging, never for retaining credentials.
    rmSync(authConfigPath, { force: true });
    if (!options?.keepTempDir) {
      rmSync(tarballDir, { recursive: true, force: true });
      rmSync(consumerDir, { recursive: true, force: true });
    }
  }
}

function tarballMissingFinding(packageName: string | undefined, tarballPath: string): Finding {
  return {
    rule: "round-trip-tarball-missing",
    severity: "error",
    message: `${packageLabel(packageName)}: requested tarball does not exist at ${tarballPath}`,
  };
}

function tarballInvalidFinding(packageName: string | undefined, detail: string): Finding {
  return {
    rule: "round-trip-tarball-invalid",
    severity: "error",
    message: `${packageLabel(packageName)}: requested tarball has no usable package manifest — ${detail}`,
  };
}

function packFailedFinding(packageName: string | undefined, detail: string): Finding {
  return {
    rule: "round-trip-install-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: npm pack failed, so there is no tarball to install — ${detail}`,
  };
}

function installFailedFinding(packageName: string | undefined, detail: string): Finding {
  return {
    rule: "round-trip-install-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: npm install failed in an isolated directory with no workspace and no sibling node_modules — ${detail}`,
  };
}

function importFailedFinding(packageName: string | undefined, subpath: string, detail: string): Finding {
  return {
    rule: "round-trip-import-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: subpath "${subpath}" failed to import from a genuinely isolated install — ${detail}`,
  };
}

/** The finding emitted when a package declares no importable `exports` surface at all — see the note at the call site for why this must never be a silent `ok: true`. */
function noExportsFinding(packageName: string | undefined): Finding {
  return {
    rule: "round-trip-no-exports",
    severity: "error",
    message: `${packageLabel(packageName)}: package.json "exports" declares no importable subpath, so this round trip checked zero imports. A round trip that never imported anything is not proof the package is importable and must not be reported as a clean pass.`,
  };
}
