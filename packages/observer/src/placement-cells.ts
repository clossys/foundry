/**
 * The bundle-to-placement-cells adapter (#997): turns one observation bundle
 * into advisor's `HubPlacementEvidence` cell shapes.
 *
 * ADVISOR'S TYPE, MIRRORED STRUCTURALLY
 * --------------------------------------
 * The cell shape here mirrors `@clossys/advisor`'s `HubPlacementCell`
 * (`packages/advisor/src/types.ts`; that path does not ship with this package) -- kind, packageName, repositoryId,
 * observed, expected -- WITHOUT importing that package. This is the same
 * "named here without depending on the other package" move this package's
 * own `FleetInstalledInventory` already makes for `@clossys/integrator`'s
 * `InstalledInventory` (`./coverage.ts`): a real advisor `HubPlacementCell`
 * satisfies `HubPlacementCellInput` as-is -- structural typing, not a cast
 * -- and this package stays free of any cross-package runtime dependency.
 * Advisor never reads the tree; the caller-supplied evidence chain is
 * observations -> this adapter -> advisor's `placementEvidence`.
 *
 * THE THREE MAPPINGS (#997)
 * --------------------------
 * A repository observation reporting an installed `@clossys` package that
 * is NOT in that repository's `devDependencies` is an `over-install` cell.
 * A declared dependency that could not be read (its declaration or its
 * resolved version is missing or malformed) is a `missing` cell. An
 * installed version strictly older than the declared range's floor is a
 * `stale` cell. Anything else is not a defect this adapter can name, and is
 * never silently reshaped into one that looks like it.
 *
 * Zero I/O, zero clock reads, zero runtime dependencies -- this package's
 * own convention throughout. Every field, including `observedAt`, comes
 * from the bundle the caller supplied.
 */

/** The advisor cell kinds this adapter can produce from an observation bundle. Mirrors the subset of advisor's `HubPlacementCellKind` it maps to. */
export type HubPlacementCellKind = "over-install" | "missing" | "stale";

/**
 * Structural match for `@clossys/advisor`'s `HubPlacementCell`
 * (`packages/advisor/src/types.ts`; that path does not ship with this package), named here rather than imported -- see
 * the module header. A real advisor cell carries additional fields (`id`,
 * `observedAt`, `evidence`); those are the caller's to attach when the
 * cells become a `HubPlacementEvidence` document, since this adapter has no
 * clock and no evidence store.
 */
export interface HubPlacementCellInput {
  readonly kind: HubPlacementCellKind;
  readonly packageName: string;
  readonly repositoryId: string;
  /** What was observed, as a caller-readable string (e.g. the installed version). */
  readonly observed: string;
  /** What the declaration said should be there, when a declaration said anything at all. */
  readonly expected?: string;
}

/**
 * One repository's installed-package observation, structurally mirroring
 * what a caller's own manifest reader produces. `devDependencies` is the
 * declared set a package must also appear in to not be an over-install.
 * `unreadable` marks a package that is declared (so it is expected) but
 * whose declared range or resolved version could not be read -- a `missing`
 * cell, never silently dropped.
 */
export interface RepositoryPackageObservation {
  readonly repositoryId: string;
  readonly packageName: string;
  /** The installed version, when the package resolved. */
  readonly installedVersion?: string;
  /** The declared dependency range, when one could be read. */
  readonly declaredRange?: string;
  /** True when the package is declared but its declaration or version could not be read. */
  readonly unreadable?: boolean;
  /** The `devDependencies` map the observation read, when readable. */
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** One observation bundle as this adapter accepts it: which repository, and every package observation taken of it. */
export interface HubPlacementObservationBundle {
  readonly repositoryId: string;
  readonly packages: readonly RepositoryPackageObservation[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;
const CARET_OR_TILDE = /^[~^]\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

function parseVersionParts(value: string): { major: number; minor: number; patch: number; prerelease: string | undefined } | undefined {
  const match = VERSION.exec(value.trim());
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/**
 * The floor a declared range starts at, when the range is one this adapter
 * can read (`^x.y.z`, `~x.y.z`, or an exact version). An exotic range
 * (`>=`, `*`, a tag, a workspace protocol) has no floor this adapter can
 * name, so it yields `undefined` -- an unreadable floor is never treated as
 * a satisfied one.
 */
function rangeFloor(range: string): { major: number; minor: number; patch: number; prerelease: string | undefined } | undefined {
  const trimmed = range.trim();
  if (EXACT.test(trimmed)) return parseVersionParts(trimmed);
  const caret = CARET_OR_TILDE.exec(trimmed);
  if (caret === null) return undefined;
  return {
    major: Number(caret[1]),
    minor: Number(caret[2]),
    patch: Number(caret[3]),
    prerelease: caret[4],
  };
}

function strictlyOlder(installed: { major: number; minor: number; patch: number; prerelease: string | undefined }, floor: { major: number; minor: number; patch: number; prerelease: string | undefined }): boolean {
  if (installed.major !== floor.major) return installed.major < floor.major;
  if (installed.minor !== floor.minor) return installed.minor < floor.minor;
  if (installed.patch !== floor.patch) return installed.patch < floor.patch;
  // Same release: a prerelease is older than the release itself.
  if (installed.prerelease !== undefined && floor.prerelease === undefined) return true;
  if (installed.prerelease === undefined || floor.prerelease === undefined) return false;
  return installed.prerelease < floor.prerelease;
}

/**
 * Converts one observation bundle into advisor-shaped placement cells, in
 * `packages` order. A package observation yields at most one cell: an
 * installed `@clossys` package missing from the read `devDependencies` is
 * `over-install`; a declared-but-unreadable package is `missing`; an
 * installed version strictly below its declared range's floor is `stale`.
 * The hub inventories `@clossys` packages, so an over-install is only
 * named for `@clossys/`-scoped names — other software's placement is not
 * the hub's business and is never reshaped into a defect that looks like
 * one. An observation with no readable repository id names no repository
 * and is refused — a cell that cannot say where it was seen is not
 * evidence.
 */
export function mapBundleToPlacementCells(bundle: HubPlacementObservationBundle): readonly HubPlacementCellInput[] {
  if (typeof bundle.repositoryId !== "string" || bundle.repositoryId.trim() === "") {
    throw new Error("mapBundleToPlacementCells: bundle.repositoryId must be a non-empty string.");
  }
  const cells: HubPlacementCellInput[] = [];
  for (const observation of bundle.packages) {
    const packageName = observation.packageName;
    if (typeof packageName !== "string" || packageName.trim() === "") {
      throw new Error("mapBundleToPlacementCells: every package observation must carry a non-empty packageName.");
    }

    // Declared but unreadable: the declaration named the package, so a
    // defect exists even though its shape could not be established.
    if (observation.unreadable === true) {
      cells.push({
        kind: "missing",
        packageName,
        repositoryId: bundle.repositoryId,
        observed: "declared but unreadable",
        ...(observation.declaredRange === undefined ? {} : { expected: observation.declaredRange }),
      });
      continue;
    }

    // Installed but not declared: an over-install, whether or not the
    // installed version itself could be read. Scoped to `@clossys`
    // packages -- see the doc comment.
    if (observation.installedVersion !== undefined && packageName.startsWith("@clossys/") && (observation.devDependencies === undefined || !(packageName in observation.devDependencies))) {
      cells.push({
        kind: "over-install",
        packageName,
        repositoryId: bundle.repositoryId,
        observed: observation.installedVersion,
      });
      continue;
    }

    // Declared and installed, but older than the range's floor: stale.
    if (observation.installedVersion !== undefined && typeof observation.declaredRange === "string") {
      const floor = rangeFloor(observation.declaredRange);
      const actual = parseVersionParts(observation.installedVersion);
      if (floor !== undefined && actual !== undefined && strictlyOlder(actual, floor)) {
        cells.push({
          kind: "stale",
          packageName,
          repositoryId: bundle.repositoryId,
          observed: observation.installedVersion,
          expected: observation.declaredRange,
        });
      }
    }
  }
  return cells;
}
