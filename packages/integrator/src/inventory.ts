import { IntegratorValidationError } from "./errors.js";
import { isValidPackageName } from "./package-name.js";
import { parsePnpmRootImporterVersions } from "./pnpm-lockfile.js";

/**
 * Reads what a plane has actually vendored -- its own manifest and its own
 * lockfile -- and reports what is really resolved on disk, not merely
 * declared.
 *
 * The filesystem is injected as a port, following
 * `@vespeneventures/provisioning`'s `FileSystemPort` pattern: this module
 * never opens a file itself, so it is testable with no real checkout and so a
 * caller can point it at anything that looks like a manifest and a lockfile --
 * a real path on a real plane, or a fixture. It is deliberately a much
 * smaller port than provisioning's: this package only ever reads, and reading
 * a plane's own dependency files can never damage the machine running it, so
 * there is no need for provisioning's mutation-safety machinery here.
 */

export interface InventoryFileSystemPort {
  /** Returns the file's contents, or `undefined` when the path does not exist. */
  readFile(path: string): string | undefined;
}

export interface InventorySourceOptions {
  /** Path to the plane's own `package.json`-shaped manifest. */
  readonly manifestPath: string;
  /** Path to the plane's own npm lockfile (`lockfileVersion` 2 or 3 shape). */
  readonly lockfilePath: string;
}

export interface InstalledPackage {
  readonly name: string;
  /** The range this plane's own manifest declares for the package. */
  readonly declaredRange: string;
  /** The version actually resolved at the plane's dependency root, per its lockfile. */
  readonly installedVersion: string;
}

export interface InstalledInventory {
  readonly packages: readonly InstalledPackage[];
}

function fail(message: string): never {
  throw new IntegratorValidationError("INVALID_INVENTORY_SOURCE", message);
}

function parseJsonObject(content: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    fail(`${label} does not parse as JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function declaredRanges(manifest: Record<string, unknown>): Map<string, string> {
  const ranges = new Map<string, string>();
  // Read in an order where a `dependencies` entry wins over the same name
  // declared in `devDependencies` or `optionalDependencies` -- a plane's
  // production intent takes precedence when a name somehow appears twice.
  for (const field of ["devDependencies", "optionalDependencies", "dependencies"]) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(`manifest field ${field} must be an object`);
    }
    for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
      if (!isValidPackageName(name)) fail(`manifest field ${field} has an invalid package name: ${JSON.stringify(name)}`);
      if (typeof range !== "string" || range.length === 0) fail(`manifest field ${field} has an invalid range for ${name}`);
      ranges.set(name, range);
    }
  }
  return ranges;
}

function resolvedVersion(lockfile: Record<string, unknown>, name: string): string | undefined {
  const packages = lockfile["packages"];
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
    fail("lockfile field packages must be an object -- only lockfileVersion 2 or 3 lockfiles are read");
  }
  // The entry reachable from the plane's own dependency root, not a nested
  // resolution under some other package's node_modules -- a deduped nested
  // install is not what the plane itself would require or import.
  const entry = (packages as Record<string, unknown>)[`node_modules/${name}`];
  if (entry === undefined) return undefined;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    fail(`lockfile entry for ${name} must be an object`);
  }
  const version = (entry as Record<string, unknown>)["version"];
  if (version === undefined) return undefined; // a link/workspace entry can legitimately omit a version
  if (typeof version !== "string" || version.length === 0) fail(`lockfile entry for ${name} has an invalid version`);
  return version;
}

/**
 * Read a plane's manifest and lockfile through the injected port and report
 * what is really installed. A name declared in the manifest with no matching
 * lockfile resolution is NOT reported here -- from this reader's point of
 * view that is not installed, and it is left to the version reconciler to
 * decide whether that counts as a decision (`absent-with-reason`) or drift
 * (`absent-without-reason`).
 */
export function readInstalledInventory(fs: InventoryFileSystemPort, options: InventorySourceOptions): InstalledInventory {
  const manifestContent = fs.readFile(options.manifestPath);
  if (manifestContent === undefined) fail(`manifest not found: ${options.manifestPath}`);
  const lockfileContent = fs.readFile(options.lockfilePath);
  if (lockfileContent === undefined) fail(`lockfile not found: ${options.lockfilePath}`);

  const manifest = parseJsonObject(manifestContent, `manifest at ${options.manifestPath}`);
  const lockfile = parseJsonObject(lockfileContent, `lockfile at ${options.lockfilePath}`);

  const ranges = declaredRanges(manifest);
  const packages: InstalledPackage[] = [];
  for (const [name, declaredRange] of ranges) {
    const installedVersion = resolvedVersion(lockfile, name);
    if (installedVersion === undefined) continue;
    packages.push({ name, declaredRange, installedVersion });
  }

  return { packages: Object.freeze(packages) };
}

/** Which lockfile grammar `readInstalledInventoryReport` actually read. */
export type InventoryLockfileFormat = "npm" | "pnpm";

/**
 * Why `readInstalledInventoryReport` could not produce an `InstalledInventory`
 * at all. Never omitted -- see the function's own doc comment for why this
 * exists as an explicit reported state rather than an empty inventory or a
 * thrown error (issue #330).
 */
export type InstalledInventoryIndeterminateReason =
  | "manifest-not-found"
  | "manifest-invalid"
  | "lockfile-not-found"
  | "lockfile-invalid"
  | "ambiguous-lockfile-format";

export type InstalledInventoryReadResult =
  | {
      readonly kind: "read";
      readonly inventory: InstalledInventory;
      readonly lockfileFormat: InventoryLockfileFormat;
    }
  | {
      readonly kind: "indeterminate";
      readonly reason: InstalledInventoryIndeterminateReason;
      readonly detail?: string;
    };

export interface InventoryReportSourceOptions {
  /** Path to the plane's own `package.json`-shaped manifest. */
  readonly manifestPath: string;
  /** Candidate path to an npm lockfile (`lockfileVersion` 2 or 3 shape) -- checked for presence, not assumed. */
  readonly npmLockfilePath: string;
  /** Candidate path to a pnpm lockfile (the current `importers`-based shape) -- checked for presence, not assumed. */
  readonly pnpmLockfilePath: string;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildPackages(ranges: ReadonlyMap<string, string>, versions: ReadonlyMap<string, string>): readonly InstalledPackage[] {
  const packages: InstalledPackage[] = [];
  for (const [name, declaredRange] of ranges) {
    const installedVersion = versions.get(name);
    if (installedVersion === undefined) continue;
    packages.push({ name, declaredRange, installedVersion });
  }
  return Object.freeze(packages);
}

function npmResolvedVersions(lockfile: Record<string, unknown>, names: Iterable<string>): ReadonlyMap<string, string> {
  const versions = new Map<string, string>();
  for (const name of names) {
    const version = resolvedVersion(lockfile, name);
    if (version !== undefined) versions.set(name, version);
  }
  return versions;
}

/**
 * Read a plane's manifest and EITHER lockfile format through the injected
 * port, and report what is really installed -- or report exactly why it
 * could not, as an explicit `indeterminate` result. Never throws (issue
 * #330), unlike `readInstalledInventory` above: this is the "detect what a
 * plane actually has" entry point, following `detectSupersession`'s own
 * documented discipline (see its header in `./supersession.ts`) of folding
 * every internal parser's throw into a named, reported state rather than
 * letting it escape or silently reporting an empty inventory.
 *
 * `readInstalledInventory` stays npm-only and keeps throwing, unchanged --
 * this is a deliberately separate, additive entry point, not a replacement,
 * so nothing that already depends on the throwing contract is disturbed.
 *
 * The caller supplies BOTH candidate lockfile paths (typically the plane's
 * own `package-lock.json` and `pnpm-lock.yaml`, at whatever root the caller
 * already knows), and this function checks which actually exist rather than
 * assuming a format from the caller's say-so:
 *
 * - Neither present -> `indeterminate` / `"lockfile-not-found"`.
 * - Exactly one present -> read in that format.
 * - BOTH present -> `indeterminate` / `"ambiguous-lockfile-format"`, its own
 *   reported state, never a silent pick of one over the other -- a plane
 *   mid-migration between package managers, or one that simply has stale
 *   lockfile litter, is a fact worth surfacing, not guessing past.
 *
 * A lockfile that IS present but fails to parse in its own format is
 * `indeterminate` / `"lockfile-invalid"`, carrying the parser's message as
 * `detail` -- never folded into an empty, "nothing installed" inventory,
 * which is the exact ambiguity issue #330 exists to remove.
 *
 * `pnpm-lock.yaml` support is intentionally scoped to the CURRENT
 * `importers`-based lockfile shape (see `./pnpm-lockfile.ts`'s own header).
 * A pnpm lockfile that predates that shape is `"lockfile-invalid"`, not
 * silently misread.
 */
export function readInstalledInventoryReport(fs: InventoryFileSystemPort, options: InventoryReportSourceOptions): InstalledInventoryReadResult {
  const manifestContent = fs.readFile(options.manifestPath);
  if (manifestContent === undefined) {
    return { kind: "indeterminate", reason: "manifest-not-found", detail: `manifest not found: ${options.manifestPath}` };
  }

  let ranges: ReadonlyMap<string, string>;
  try {
    ranges = declaredRanges(parseJsonObject(manifestContent, `manifest at ${options.manifestPath}`));
  } catch (error) {
    return { kind: "indeterminate", reason: "manifest-invalid", detail: detailOf(error) };
  }

  const npmContent = fs.readFile(options.npmLockfilePath);
  const pnpmContent = fs.readFile(options.pnpmLockfilePath);

  if (npmContent !== undefined && pnpmContent !== undefined) {
    return {
      kind: "indeterminate",
      reason: "ambiguous-lockfile-format",
      detail: `both an npm lockfile (${options.npmLockfilePath}) and a pnpm lockfile (${options.pnpmLockfilePath}) are present -- which one governs is not this reader's call to make`,
    };
  }

  if (npmContent !== undefined) {
    try {
      const lockfile = parseJsonObject(npmContent, `lockfile at ${options.npmLockfilePath}`);
      const versions = npmResolvedVersions(lockfile, ranges.keys());
      return { kind: "read", inventory: { packages: buildPackages(ranges, versions) }, lockfileFormat: "npm" };
    } catch (error) {
      return { kind: "indeterminate", reason: "lockfile-invalid", detail: detailOf(error) };
    }
  }

  if (pnpmContent !== undefined) {
    try {
      const versions = parsePnpmRootImporterVersions(pnpmContent);
      return { kind: "read", inventory: { packages: buildPackages(ranges, versions) }, lockfileFormat: "pnpm" };
    } catch (error) {
      return { kind: "indeterminate", reason: "lockfile-invalid", detail: detailOf(error) };
    }
  }

  return {
    kind: "indeterminate",
    reason: "lockfile-not-found",
    detail: `neither an npm lockfile (${options.npmLockfilePath}) nor a pnpm lockfile (${options.pnpmLockfilePath}) was found`,
  };
}
