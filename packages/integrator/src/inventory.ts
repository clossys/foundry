import { IntegratorValidationError } from "./errors.js";
import { isValidPackageName } from "./package-name.js";

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
