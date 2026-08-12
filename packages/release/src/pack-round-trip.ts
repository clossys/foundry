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
 * check every subpath the package's own `exports` field claims: import
 * executable JS/TS targets and verify static assets are present.
 *
 * Real subprocess work, real I/O, on purpose — this is the first layer of
 * this foundation where that is the point rather than something to avoid.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
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
   * Registry used to resolve the packed package's declared dependencies and
   * runtime peers. Defaults to the public npm registry. Supply this only for
   * an intentionally configured, anonymously readable registry; credentials
   * are still never inherited by the isolated subprocesses.
   */
  registry?: string | RegistryInstallOptions;
  /**
   * Opt selected exports into an isolated Next.js compilation proof instead
   * of a raw Node import. Next route, middleware, and client-component
   * modules are valid package exports, but their framework-only specifiers
   * (for example `next/headers`) are intentionally resolved by Next rather
   * than by Node's bare ESM loader.
   *
   * Each named subpath must be declared by the package. Client exports are
   * compiled from a client component; server exports from an App Router
   * module; and proxy exports from a `proxy.ts` entry. All peer dependencies
   * are still installed in the same isolated consumer before this check.
   */
  next?: {
    clientSubpaths?: readonly string[];
    serverSubpaths?: readonly string[];
    proxySubpaths?: readonly string[];
  };
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
    /** Next compilation timeout. Defaults to the install timeout. */
    next?: number;
  };
}

/** Explicit registry configuration for an authenticated package-install proof. */
export interface RegistryInstallOptions {
  /** Registry URL used for scoped private dependencies. */
  url: string;
  /** Optional proof-only token. It is passed only to child npm processes. */
  authToken?: string;
  /** Optional npm scope mapped to `url`; unscoped dependencies stay on npmjs. */
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
 *     (`https://registry.npmjs.org/`) unless the caller supplied an explicit
 *     registry option. Either way it is never inherited from ambient host
 *     configuration. An explicit registry is useful for an intentionally
 *     configured public registry; it still receives no local credentials.
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
  registry?: string | RegistryInstallOptions,
): NodeJS.ProcessEnv {
  const registryUrl = typeof registry === "string" ? registry : registry?.url ?? "https://registry.npmjs.org/";
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
    npm_config_userconfig: join(isolationDir, "unused-userconfig.npmrc"),
    npm_config_cache: join(isolationDir, "npm-cache"),
    npm_config_registry: typeof registry === "object" && registry.scope ? "https://registry.npmjs.org/" : registryUrl,
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
  if (typeof registry === "object" && registry.authToken) env.NODE_AUTH_TOKEN = registry.authToken;
  return env;
}

function registryAuthConfig(registry: string | RegistryInstallOptions | undefined): string | undefined {
  if (!registry || typeof registry === "string") return undefined;
  const parsed = new URL(registry.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("packRoundTrip: registry URL must be HTTPS without embedded credentials");
  }
  if (registry.scope && !/^@[a-z0-9][a-z0-9._-]*$/.test(registry.scope)) {
    throw new Error("packRoundTrip: registry scope must be an npm scope");
  }
  const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  const scopeLine = registry.scope ? `${registry.scope}:registry=${parsed.href}\n` : "";
  const tokenLine = registry.authToken ? `//${parsed.host}${pathname}:_authToken=${"${NODE_AUTH_TOKEN}"}\n` : "";
  return scopeLine || tokenLine ? `${scopeLine}${tokenLine}` : undefined;
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

/** Conditions Node activates for a native ESM import. `types` deliberately is
 * not active: it describes TypeScript tooling, not a runtime target. */
const IMPORT_EXPORT_CONDITIONS = new Set(["node", "import", "default"]);

/** Conditions Node activates for an explicitly advertised CommonJS branch. */
const REQUIRE_EXPORT_CONDITIONS = new Set(["node", "require", "default"]);

/** The extensions which a Node import check can meaningfully execute here. */
const RUNTIME_TARGET_EXTENSIONS = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i;

/**
 * Resolves one declared export value as Node's import resolver would for the
 * small condition set this verifier uses. This does not try to be a second
 * implementation of Node's resolver: the later import is still authoritative.
 * It only identifies the selected target's extension so static assets are not
 * handed to Node as JavaScript.
 */
function resolveExportTarget(value: unknown, conditions: ReadonlySet<string>): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = resolveExportTarget(candidate, conditions);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [condition, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!conditions.has(condition)) continue;
    const target = resolveExportTarget(candidate, conditions);
    if (target !== undefined) return target;
  }
  return undefined;
}

/** Whether a conditional export explicitly promises a CommonJS `require`
 * branch. A bare/default export is not treated as that promise: an ESM-only
 * package may deliberately support import only. */
function hasRequireCondition(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRequireCondition);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([condition, candidate]) => condition === "require" || hasRequireCondition(candidate),
  );
}

/** Collects TypeScript declaration targets from an export condition tree.
 * They are not executable, but a missing target makes the declared TypeScript
 * API unusable just as surely as a missing JavaScript target does at runtime. */
function typeTargetsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(typeTargetsOf);
  if (!value || typeof value !== "object") return [];
  const entries = value as Record<string, unknown>;
  const direct = typeof entries.types === "string" ? [entries.types] : [];
  return [...direct, ...Object.entries(entries).flatMap(([condition, candidate]) => condition === "types" ? [] : typeTargetsOf(candidate))];
}

/** Returns the declaration for one subpath, accounting for root shorthand. */
function exportValueFor(exportsField: unknown, subpath: string): unknown {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) return exportsField;
  if (!exportsField || typeof exportsField !== "object") return undefined;
  const entries = exportsField as Record<string, unknown>;
  const hasSubpathKeys = Object.keys(entries).some((key) => key.startsWith("."));
  return hasSubpathKeys ? entries[subpath] : entries;
}

function isRuntimeTarget(target: string | undefined): boolean {
  // An unresolvable condition still goes through Node's import check, which
  // produces the same consumer-visible failure as before this classification.
  return target === undefined || RUNTIME_TARGET_EXTENSIONS.test(target);
}

/**
 * Checks an asset target directly in node_modules. Static exports such as CSS
 * and JSONC are valid package API but cannot be imported by Node as modules.
 */
function staticTargetExists(installedPackageDir: string, target: string): boolean {
  if (!target.startsWith("./")) return false;
  const resolved = resolve(installedPackageDir, target);
  const rel = relative(installedPackageDir, resolved);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`) && existsSync(resolved);
}

type NextRoundTripOptions = NonNullable<PackRoundTripOptions["next"]>;

function uniqueSubpaths(subpaths: readonly string[]): string[] {
  return [...new Set(subpaths)];
}

function nextSubpathsOf(next: NextRoundTripOptions | undefined): {
  client: string[];
  server: string[];
  proxy: string[];
  all: Set<string>;
} {
  const client = uniqueSubpaths(next?.clientSubpaths ?? []);
  const server = uniqueSubpaths(next?.serverSubpaths ?? []);
  const proxy = uniqueSubpaths(next?.proxySubpaths ?? []);
  const all = new Set([...client, ...server, ...proxy]);
  if (all.size !== client.length + server.length + proxy.length) {
    throw new Error("packRoundTrip: a Next framework subpath may appear in only one Next fixture role");
  }
  return { client, server, proxy, all };
}

function namespaceImports(packageName: string, subpaths: readonly string[]): string {
  return subpaths
    .map((subpath, index) => `import * as probe${index} from ${JSON.stringify(specifierFor(packageName, subpath))};\nvoid probe${index};`)
    .join("\n");
}

/**
 * Builds a minimal App Router project that makes Next resolve selected package
 * exports in their real client, server, or proxy execution boundary. The
 * modules are deliberately not invoked: this proves consumer installation and
 * framework resolution without needing a provider key or a live request.
 */
function writeNextFixture(
  consumerDir: string,
  packageName: string,
  next: { client: string[]; server: string[]; proxy: string[] },
): void {
  const appDir = join(consumerDir, "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "layout.tsx"),
    'import type { ReactNode } from "react";\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n',
  );
  writeFileSync(
    join(appDir, "client-probe.tsx"),
    `"use client";\n\n${namespaceImports(packageName, next.client)}\n\nexport function ClientProbe() {\n  return null;\n}\n`,
  );
  writeFileSync(
    join(appDir, "server-probe.ts"),
    `${namespaceImports(packageName, next.server)}\n\nexport const serverProbe = true;\n`,
  );
  writeFileSync(
    join(appDir, "page.tsx"),
    'import { ClientProbe } from "./client-probe";\nimport { serverProbe } from "./server-probe";\n\nexport const dynamic = "force-dynamic";\n\nexport default function Page() {\n  void serverProbe;\n  return <ClientProbe />;\n}\n',
  );
  writeFileSync(
    join(consumerDir, "proxy.ts"),
    `${namespaceImports(packageName, next.proxy)}\n\nexport function proxy() {\n  return new Response(null);\n}\n`,
  );
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
    peerDependencies?: Record<string, string>;
    types?: unknown;
    typings?: unknown;
  };
  const packageName = manifest.name;
  const subpaths = subpathsOf(manifest.exports);
  const nextSubpaths = nextSubpathsOf(options?.next);
  for (const subpath of nextSubpaths.all) {
    if (!subpaths.includes(subpath)) {
      throw new Error(`packRoundTrip: Next framework subpath ${JSON.stringify(subpath)} is not declared by this package`);
    }
  }
  const exportsBySubpath = new Map(subpaths.map((subpath) => [subpath, exportValueFor(manifest.exports, subpath)]));
  const importTargets = new Map(
    subpaths.map((subpath) => [subpath, resolveExportTarget(exportsBySubpath.get(subpath), IMPORT_EXPORT_CONDITIONS)]),
  );
  const requireTargets = new Map(
    subpaths.map((subpath) => [subpath, resolveExportTarget(exportsBySubpath.get(subpath), REQUIRE_EXPORT_CONDITIONS)]),
  );
  const requireSubpaths = new Set(subpaths.filter((subpath) => hasRequireCondition(exportsBySubpath.get(subpath))));
  const needsRuntimePeers = nextSubpaths.all.size > 0 || [
    ...importTargets.values(),
    ...[...requireSubpaths].map((subpath) => requireTargets.get(subpath)),
  ].some(isRuntimeTarget);

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
  const importEnv = { ...env };
  delete importEnv.NODE_AUTH_TOKEN;
  const authConfig = registryAuthConfig(options?.registry);
  if (authConfig) writeFileSync(join(tarballDir, "unused-userconfig.npmrc"), authConfig);
  const packTimeoutMs = options?.timeoutsMs?.pack ?? NPM_PACK_TIMEOUT_MS;
  const installTimeoutMs = options?.timeoutsMs?.install ?? NPM_INSTALL_TIMEOUT_MS;
  const importTimeoutMs = options?.timeoutsMs?.import ?? IMPORT_TIMEOUT_MS;
  const nextTimeoutMs = options?.timeoutsMs?.next ?? installTimeoutMs;

  try {
    // 1. Pack the real tarball. `npm pack` runs `prepublishOnly`, so what
    //    lands here is exactly what an `npm publish` from this state would
    //    upload — the same mechanism this repository's own artifact-safety
    //    gate uses to scan what actually ships, not the source tree.
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
        declarations: [],
        findings: [packFailedFinding(packageName, summarizeExecError(error, packTimeoutMs))],
      };
    }
    const tarballPath = join(tarballDir, tarballName);

    // npm itself refuses to produce a tarball for a manifest with no "name"
    // (that is exactly the pack-failure branch above), so reaching this
    // point already proves packageName is defined -- this is a narrowing
    // check on that invariant, not a new possibility.
    if (packageName === undefined) {
      throw new Error("packRoundTrip: npm pack succeeded but package.json has no \"name\" (unreachable in practice)");
    }

    // 2. A minimal, real consumer project in the isolated directory — just
    //    enough for `npm install` to have somewhere to install into. `.npmrc`
    //    is deliberately NOT written here: installing a package from a local
    //    tarball path resolves the tarball itself with zero registry
    //    contact. A registry is only ever consulted for THAT package's own
    //    declared dependencies — and whether that resolution succeeds is
    //    exactly the thing under test, not something to route around.
    // A TypeScript App Router fixture needs its compiler and standard React
    // declarations declared before Next runs. Without them, Next invokes its
    // own interactive dependency bootstrap during `next build`; that second
    // npm install can prune the intentionally no-save framework peers that
    // this verifier installed, turning a sound package into a false failure.
    // These are fixture-only development tools, never dependencies added to
    // the package under test.
    const fixtureDevDependencies = nextSubpaths.all.size > 0
      ? { typescript: "^6.0.0", "@types/node": "^22.0.0", "@types/react": "^19.0.0" }
      : undefined;
    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify({ name: "round-trip-consumer", private: true, type: "module", ...(fixtureDevDependencies ? { devDependencies: fixtureDevDependencies } : {}) }, null, 2),
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
        declarations: [],
        findings: [installFailedFinding(packageName, summarizeExecError(error, installTimeoutMs))],
      };
    }

    // 3b. Peer dependencies are intentionally not part of a tarball's own
    // dependency graph. Install them explicitly before executable imports so
    // the verifier proves the same peer-satisfied runtime a real application
    // has. An asset-only package has nothing Node will execute, so it does not
    // need peers merely to prove that its CSS/JSON/etc. files shipped.
    const peerSpecs = needsRuntimePeers
      ? Object.entries(manifest.peerDependencies ?? {}).map(([name, range]) => `${name}@${range}`)
      : [];
    if (peerSpecs.length > 0) {
      try {
        await execFile("npm", ["install", "--no-save", ...peerSpecs], {
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
          declarations: [],
          findings: [peerInstallFailedFinding(packageName, summarizeExecError(error, installTimeoutMs))],
        };
      }
    }

    // 4. Every declared export subpath. Executable JS/TS targets are imported
    //    from a Node process whose cwd — and therefore module resolution root
    //    — is the isolated consumer directory. Static targets (CSS, JSONC,
    //    and other non-runtime files) are instead verified to exist inside
    //    the installed package. Each executable subpath runs its own
    //    subprocess so one crashing import can never hide the next result.
    //
    //    A package that declares no subpath at all (`"exports": {}`, or no
    //    `exports` field resolving to anything) runs zero checks here — and
    //    that is itself the finding, not a clean pass. This function exists
    //    to prove the declared package surface; a round trip that checked
    //    nothing proves nothing, so it must never report `ok: true`.
    const imports: ImportCheck[] = [];
    const declarations: RoundTripResult["declarations"] = [];
    const findings: Finding[] = [];
    if (subpaths.length === 0) {
      findings.push(noExportsFinding(packageName));
    }
    for (const subpath of subpaths) {
      if (nextSubpaths.all.has(subpath)) continue;
      const target = importTargets.get(subpath);
      if (target !== undefined && !isRuntimeTarget(target)) {
        if (staticTargetExists(join(consumerDir, "node_modules", packageName), target)) {
          imports.push({ subpath, mode: "static", ok: true });
        } else {
          const message = `static export target ${JSON.stringify(target)} is absent from the isolated installed tarball`;
          imports.push({ subpath, mode: "static", ok: false, error: message });
          findings.push(assetMissingFinding(packageName, subpath, target));
        }
      } else {
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
          imports.push({ subpath, mode: "import", ok: true });
        } catch (error) {
          const message = summarizeExecError(error, importTimeoutMs);
          imports.push({ subpath, mode: "import", ok: false, error: message });
          findings.push(importFailedFinding(packageName, subpath, message));
        }
      }

      if (!requireSubpaths.has(subpath)) continue;
      const specifier = specifierFor(packageName, subpath);
      const requireTarget = requireTargets.get(subpath);
      if (requireTarget !== undefined && !isRuntimeTarget(requireTarget)) {
        if (staticTargetExists(join(consumerDir, "node_modules", packageName), requireTarget)) {
          imports.push({ subpath, mode: "static", ok: true });
        } else {
          const message = `static export target ${JSON.stringify(requireTarget)} is absent from the isolated installed tarball`;
          imports.push({ subpath, mode: "static", ok: false, error: message });
          findings.push(assetMissingFinding(packageName, subpath, requireTarget));
        }
        continue;
      }
      const requireScript =
        `try { require(${JSON.stringify(specifier)}); process.exit(0); }` +
        ` catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }`;
      try {
        await execFile("node", ["--input-type=commonjs", "-e", requireScript], {
          cwd: consumerDir,
          env: importEnv,
          timeout: importTimeoutMs,
          killSignal: TIMEOUT_KILL_SIGNAL,
        });
        imports.push({ subpath, mode: "require", ok: true });
      } catch (error) {
        const message = summarizeExecError(error, importTimeoutMs);
        imports.push({ subpath, mode: "require", ok: false, error: message });
        findings.push(requireFailedFinding(packageName, subpath, message));
      }
    }

    if (nextSubpaths.all.size > 0) {
      writeNextFixture(consumerDir, packageName, nextSubpaths);
      try {
        await execFile(join(consumerDir, "node_modules", ".bin", "next"), ["build"], {
          cwd: consumerDir,
          env: { ...importEnv, NEXT_TELEMETRY_DISABLED: "1" },
          timeout: nextTimeoutMs,
          killSignal: TIMEOUT_KILL_SIGNAL,
        });
        for (const subpath of nextSubpaths.all) imports.push({ subpath, mode: "next-build", ok: true });
      } catch (error) {
        const message = summarizeExecError(error, nextTimeoutMs);
        for (const subpath of nextSubpaths.all) {
          imports.push({ subpath, mode: "next-build", ok: false, error: message });
          findings.push(importFailedFinding(packageName, subpath, message));
        }
      }
    }

    const declarationTargets = new Map<string, { subpath: string; target: string }>();
    for (const subpath of subpaths) {
      for (const target of typeTargetsOf(exportsBySubpath.get(subpath))) {
        declarationTargets.set(`${subpath}\u0000${target}`, { subpath, target });
      }
    }
    for (const target of [manifest.types, manifest.typings]) {
      if (typeof target === "string") declarationTargets.set(`.\u0000${target}`, { subpath: ".", target });
    }
    for (const { subpath, target } of declarationTargets.values()) {
      if (staticTargetExists(join(consumerDir, "node_modules", packageName), target)) {
        declarations.push({ subpath, target, ok: true });
      } else {
        const message = `declaration target ${JSON.stringify(target)} is absent from the isolated installed tarball`;
        declarations.push({ subpath, target, ok: false, error: message });
        findings.push(declarationMissingFinding(packageName, subpath, target));
      }
    }

    return { ok: findings.length === 0, packageName, tarballPath, imports, declarations, findings };
  } finally {
    if (!options?.keepTempDir) {
      rmSync(tarballDir, { recursive: true, force: true });
      rmSync(consumerDir, { recursive: true, force: true });
    }
  }
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

function peerInstallFailedFinding(packageName: string | undefined, detail: string): Finding {
  return {
    rule: "round-trip-peer-install-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: declared peerDependencies could not be installed in the isolated consumer before executable export checks — ${detail}`,
  };
}

function importFailedFinding(packageName: string | undefined, subpath: string, detail: string): Finding {
  return {
    rule: "round-trip-import-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: subpath "${subpath}" failed to import from a genuinely isolated install — ${detail}`,
  };
}

function requireFailedFinding(packageName: string | undefined, subpath: string, detail: string): Finding {
  return {
    rule: "round-trip-require-failed",
    severity: "error",
    message: `${packageLabel(packageName)}: CommonJS subpath "${subpath}" failed to require from a genuinely isolated install — ${detail}`,
  };
}

function assetMissingFinding(packageName: string | undefined, subpath: string, target: string): Finding {
  return {
    rule: "round-trip-asset-missing",
    severity: "error",
    message: `${packageLabel(packageName)}: static export subpath "${subpath}" targets ${JSON.stringify(target)}, but that file is absent from the isolated installed tarball`,
  };
}

function declarationMissingFinding(packageName: string | undefined, subpath: string, target: string): Finding {
  return {
    rule: "round-trip-declaration-missing",
    severity: "error",
    message: `${packageLabel(packageName)}: TypeScript declaration target ${JSON.stringify(target)} for subpath "${subpath}" is absent from the isolated installed tarball`,
  };
}

/** The finding emitted when a package declares no `exports` surface at all — see the note at the call site for why this must never be a silent `ok: true`. */
function noExportsFinding(packageName: string | undefined): Finding {
  return {
    rule: "round-trip-no-exports",
    severity: "error",
    message: `${packageLabel(packageName)}: package.json "exports" declares no subpath, so this round trip checked zero exports. A round trip that checked nothing is not proof the declared package surface works and must not be reported as a clean pass.`,
  };
}
