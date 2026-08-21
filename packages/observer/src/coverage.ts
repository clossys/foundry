/**
 * The fleet coverage grader (#395): turns a fleet's package catalog, its
 * repository list, each repository's raw coverage declaration (see
 * `./coverage-declaration.ts`), and each repository's own installed
 * inventory into one graded package x repository coverage matrix.
 *
 * WHY THIS IS NOT `unobserved-surface.ts` WEARING A DIFFERENT LABEL
 * -------------------------------------------------------------------
 * `./unobserved-surface.ts` already ships a three-state declared/read fold,
 * and #395's own reading list points at it first, asking that this module
 * extend or reuse it if it fits rather than build a second thing beside
 * it. It does not fit, for three reasons, so this is a new module instead:
 *
 *   1. Different vocabulary, MANDATED, not stylistic. #395 requires
 *      exactly `installed` / `declared-absent` / `unclassified` as the
 *      three cell states. `unobserved-surface.ts`'s `Observation<T>`
 *      (`./observation.ts`) hard-codes its own three literal states --
 *      `"observed" | "unobserved" | "could-not-read"` -- into the TYPE
 *      itself, not as a parameter. Relabeling them for a different domain
 *      is not something that type supports; it would require redefining
 *      it, which is what this module does, narrowly, for this domain.
 *   2. `declared-absent` carries a MANDATORY reason; `unobserved` cannot.
 *      `Observation<T>`'s `"unobserved"` branch is deliberately
 *      payload-free -- a confirmed real-world absence of telemetry needs
 *      nothing more than the confirmation. #395's absence is a claim a
 *      REPOSITORY makes about ITSELF and must be reviewable, so it always
 *      carries `reason: string` (see `./coverage-declaration.ts`) -- a
 *      shape `unobserved` has no field for without becoming a different
 *      type entirely.
 *   3. This package's own rule against blending metrics applies here too.
 *      `unobserved-surface.ts`'s own header, and `metrics.check.ts` /
 *      `metrics-non-combination.test.ts`, establish and enforce that
 *      `EscapeRateMetric` and `UnobservedSurfaceMetric` answer different
 *      questions and are never combined into one score, because doing so
 *      would hide exactly the distinction each one exists to preserve.
 *      Coverage-by-installation and telemetry-presence are exactly that
 *      kind of different question -- a gate's SILENCE and a gate's
 *      ABSENCE FROM A REPOSITORY ENTIRELY are not the same fact, and
 *      folding this domain into `UnobservedSurfaceMetric` would be the
 *      same blending failure that module exists to prevent, aimed at
 *      itself.
 *
 * What IS reused is the DISCIPLINE, not the code: a cell nobody attempted
 * to classify is exactly as unproven as one whose classification failed,
 * and both fail closed the same way `could-not-read` already does
 * throughout this package -- see `gradeFleetCoverage` below, and this
 * repository's own issue #338 ("a run that evaluated nothing reports
 * satisfied") for the failure mode this grader refuses to reproduce: an
 * empty matrix is `indeterminate`, never `satisfied`.
 *
 * DESIGN DECISIONS FIXED BY #395 ITSELF, NOT RELITIGATED HERE
 * -----------------------------------------------------------------
 *   - The installed inventory is a CALLER-SUPPLIED input, structurally
 *     typed (`FleetInstalledInventory` below) to match
 *     `@vespeneventures/integrator`'s own `InstalledInventory`
 *     (`packages/integrator/src/inventory.ts`) WITHOUT importing that
 *     package -- the identical "named here without depending on the gate
 *     package" move `@vespeneventures/integrator`'s own `currency.ts`
 *     already makes for the fleet verdict ternary it depends on. This
 *     package grades what it is handed; it does not go fetch, and it adds
 *     no runtime dependency to do so. A real `InstalledInventory` value
 *     satisfies `FleetInstalledInventory` as-is -- structural typing, not
 *     a cast.
 *   - `unclassified` FAILS CLOSED: never counted as covered, never dropped
 *     from any denominator, and always drives the aggregate verdict to
 *     `indeterminate`. This is the opposite of `assertPeerVersion`'s
 *     deliberate warn-and-proceed for an unparseable RUNTIME value
 *     (`packages/*\/src/internal/peer-version.ts`) -- that is an import
 *     guard, where throwing crashes a consumer's build, a different
 *     question entirely. This is a GATE: a gate that cannot evaluate must
 *     refuse to certify, never quietly certify anyway.
 *
 * Zero I/O, zero clock reads, zero runtime dependencies -- matching this
 * package's own convention throughout.
 */

import { parseCoverageDeclaration } from "./coverage-declaration.js";

/** The three states #395 mandates for every package-repository cell. Never a fourth. */
export type CoverageCellState = "installed" | "declared-absent" | "unclassified";

/**
 * Structural match for `@vespeneventures/integrator`'s `InstalledPackage`
 * (`packages/integrator/src/inventory.ts`), named here rather than
 * imported -- see the module header. Only the field this grader actually
 * reads is required; a real `InstalledPackage` (which also carries
 * `declaredRange`) satisfies this as-is.
 */
export interface FleetInstalledPackage {
  readonly name: string;
  readonly installedVersion?: string;
}

/** Structural match for `@vespeneventures/integrator`'s `InstalledInventory`. See `FleetInstalledPackage`. */
export interface FleetInstalledInventory {
  readonly packages: readonly FleetInstalledPackage[];
}

/** The finite set of reasons a cell can be `unclassified` for, enumerated so a reviewer sees exactly why -- mirrors `could-not-read`'s required `note` throughout this package. */
export const UNCLASSIFIED_REASONS = Object.freeze([
  "installed-inventory-unreadable",
  "declaration-unreadable",
  "not-installed-and-not-declared",
] as const);

export type UnclassifiedReason = (typeof UNCLASSIFIED_REASONS)[number];

/** One cell resolved as `installed`: the package is a dependency and (per the caller-supplied inventory) its capabilities are wired. */
export interface InstalledCoverageCell {
  readonly package: string;
  readonly repository: string;
  readonly state: "installed";
  readonly installedVersion?: string;
}

/** One cell resolved as `declared-absent`: this repository has no such lane, stated out loud with a reason. */
export interface DeclaredAbsentCoverageCell {
  readonly package: string;
  readonly repository: string;
  readonly state: "declared-absent";
  readonly reason: string;
}

/** One cell resolved as `unclassified`: neither of the above. Fails closed -- see the module header. */
export interface UnclassifiedCoverageCell {
  readonly package: string;
  readonly repository: string;
  readonly state: "unclassified";
  readonly reason: UnclassifiedReason;
  readonly detail?: string;
}

/** One package-repository cell, resolved to exactly one of the three mandated states. */
export type CoverageCell = InstalledCoverageCell | DeclaredAbsentCoverageCell | UnclassifiedCoverageCell;

/**
 * A repository that both IS installed (per the caller-supplied inventory)
 * AND has ALSO declared itself absent for the same package. Ground truth
 * wins for the cell's own `state` (it stays `"installed"` -- hiding a real
 * install because a stale declaration disagrees would be worse than the
 * problem this contract exists to solve), but the contradiction itself is
 * real information a maintainer should see and fix: the declaration is
 * wrong, or stale, or the install was unintentional. Reported separately
 * and drives the aggregate to `violated` when nothing is `unclassified`.
 */
export interface FleetCoverageContradiction {
  readonly package: string;
  readonly repository: string;
  readonly declaredReason: string;
}

/** One repository's contribution to a fleet coverage grading run. */
export interface FleetRepositoryCoverageInput {
  /** Stable identifier for the repository. Must be unique within one `FleetCoverageInput.repositories`. */
  readonly repository: string;
  /**
   * The already-fetched, unvalidated body of this repository's own
   * coverage-declaration file (see `./coverage-declaration.ts`), or
   * `undefined` when none could be found at all (never fetched, or a 404
   * meaning this repository has never declared anything) -- distinct from
   * a file that WAS found but fails validation, which this grader reports
   * as its own `"declaration-unreadable"` unclassified reason rather than
   * conflating with "nothing was ever declared".
   */
  readonly declaration: unknown;
  /**
   * This repository's own installed inventory, caller-supplied (see the
   * module header), or `undefined` when it could not be read at all.
   */
  readonly installed: FleetInstalledInventory | undefined;
}

/** What `gradeFleetCoverage` accepts: a fleet's package catalog and every repository's own contribution. */
export interface FleetCoverageInput {
  /** The package catalog under measurement. Must be non-empty and contain no duplicate. */
  readonly packages: readonly string[];
  /** Every repository in the fleet. Must contain no duplicate `repository` id. */
  readonly repositories: readonly FleetRepositoryCoverageInput[];
}

/** How many cells resolved to each of the three mandated states. Always sums to `cells.length`. */
export interface CoverageCellCounts {
  readonly installed: number;
  readonly declaredAbsent: number;
  readonly unclassified: number;
}

/** The aggregate verdict: the same `satisfied` / `violated` / `indeterminate` ternary this repository's gates use throughout, computed for the whole coverage matrix. */
export type FleetCoverageVerdict =
  | { readonly verdict: "satisfied"; readonly evaluated: number }
  | { readonly verdict: "violated"; readonly findings: readonly FleetCoverageContradiction[] }
  | { readonly verdict: "indeterminate"; readonly reason: string; readonly detail: string };

/** The full graded report: every cell, counted, folded to one aggregate verdict. */
export interface FleetCoverageReport {
  /** Exactly `packages.length * repositories.length` entries, in `repositories`-major, `packages`-minor order. Never a subset -- see the module header on never dropping a cell from the denominator. */
  readonly cells: readonly CoverageCell[];
  readonly countsByState: CoverageCellCounts;
  readonly contradictions: readonly FleetCoverageContradiction[];
  readonly result: FleetCoverageVerdict;
}

function requireNoDuplicates(label: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.trim() === "") {
      throw new Error(`gradeFleetCoverage: ${label} contains an empty string, which cannot identify anything.`);
    }
    if (seen.has(value)) {
      throw new Error(`gradeFleetCoverage: ${label} contains a duplicate entry: ${JSON.stringify(value)}.`);
    }
    seen.add(value);
  }
}

/**
 * Grades one fleet's coverage matrix. Throws only on a caller precondition
 * being violated directly (a duplicate or empty package/repository
 * identifier) -- never on anything found IN a declaration or an inventory,
 * which is exactly the data this function exists to grade, not crash over.
 *
 * An empty matrix (`packages.length * repositories.length === 0`) resolves
 * to `indeterminate`, never `satisfied` -- see the module header on #338.
 */
export function gradeFleetCoverage(input: FleetCoverageInput): FleetCoverageReport {
  requireNoDuplicates("packages", input.packages);
  requireNoDuplicates(
    "repositories",
    input.repositories.map((repo) => repo.repository),
  );

  const totalCells = input.packages.length * input.repositories.length;
  if (totalCells === 0) {
    return {
      cells: [],
      countsByState: { installed: 0, declaredAbsent: 0, unclassified: 0 },
      contradictions: [],
      result: {
        verdict: "indeterminate",
        reason: "no-cells-to-grade",
        detail:
          `${input.packages.length} package(s) x ${input.repositories.length} repositor${input.repositories.length === 1 ? "y" : "ies"} ` +
          "= 0 cells. A matrix with nothing to grade is not evidence of coverage -- see issue #338.",
      },
    };
  }

  const cells: CoverageCell[] = [];
  const contradictions: FleetCoverageContradiction[] = [];
  let installedCount = 0;
  let declaredAbsentCount = 0;
  let unclassifiedCount = 0;

  for (const repo of input.repositories) {
    const declarationWasSupplied = repo.declaration !== undefined;
    const parsed = declarationWasSupplied ? parseCoverageDeclaration(repo.declaration) : undefined;
    const declarationIsInvalid = parsed !== undefined && !parsed.ok;

    const declaredReasonByPackage = new Map<string, string>();
    if (parsed !== undefined && parsed.ok) {
      for (const absence of parsed.declaration.declaredAbsences) {
        declaredReasonByPackage.set(absence.package, absence.reason);
      }
    }

    for (const pkg of input.packages) {
      const installedPackage = repo.installed?.packages.find((candidate) => candidate.name === pkg);

      if (installedPackage !== undefined) {
        cells.push({
          package: pkg,
          repository: repo.repository,
          state: "installed",
          ...(installedPackage.installedVersion === undefined ? {} : { installedVersion: installedPackage.installedVersion }),
        });
        installedCount += 1;

        const declaredReason = declaredReasonByPackage.get(pkg);
        if (declaredReason !== undefined) {
          contradictions.push({ package: pkg, repository: repo.repository, declaredReason });
        }
        continue;
      }

      const declaredReason = declaredReasonByPackage.get(pkg);
      if (declaredReason !== undefined) {
        cells.push({ package: pkg, repository: repo.repository, state: "declared-absent", reason: declaredReason });
        declaredAbsentCount += 1;
        continue;
      }

      if (repo.installed === undefined) {
        cells.push({
          package: pkg,
          repository: repo.repository,
          state: "unclassified",
          reason: "installed-inventory-unreadable",
          detail: `No installed-inventory was supplied for repository ${JSON.stringify(repo.repository)}, so whether ${pkg} is installed there cannot be established.`,
        });
        unclassifiedCount += 1;
        continue;
      }

      if (declarationIsInvalid) {
        const findingsList = (parsed as { ok: false; findings: readonly { rule: string; message: string }[] }).findings;
        cells.push({
          package: pkg,
          repository: repo.repository,
          state: "unclassified",
          reason: "declaration-unreadable",
          detail: `Repository ${JSON.stringify(repo.repository)}'s coverage declaration failed validation: ${findingsList
            .map((entry) => `${entry.rule}: ${entry.message}`)
            .join("; ")}`,
        });
        unclassifiedCount += 1;
        continue;
      }

      cells.push({
        package: pkg,
        repository: repo.repository,
        state: "unclassified",
        reason: "not-installed-and-not-declared",
        detail: `${pkg} is not installed in ${JSON.stringify(repo.repository)} per its installed inventory, and no coverage declaration names it absent with a reason.`,
      });
      unclassifiedCount += 1;
    }
  }

  const countsByState: CoverageCellCounts = { installed: installedCount, declaredAbsent: declaredAbsentCount, unclassified: unclassifiedCount };

  if (unclassifiedCount > 0) {
    return {
      cells,
      countsByState,
      contradictions,
      result: {
        verdict: "indeterminate",
        reason: "unclassified-cells",
        detail: `${unclassifiedCount} of ${cells.length} cell(s) are unclassified -- an ungradeable matrix cannot certify coverage.`,
      },
    };
  }

  if (contradictions.length > 0) {
    return {
      cells,
      countsByState,
      contradictions,
      result: { verdict: "violated", findings: contradictions },
    };
  }

  return {
    cells,
    countsByState,
    contradictions,
    result: { verdict: "satisfied", evaluated: cells.length },
  };
}

/** Process exit code for a `FleetCoverageVerdict`: `0` satisfied, `1` violated, `2` indeterminate -- this package's one gate ternary, applied here. */
export function fleetCoverageVerdictToExitCode(result: FleetCoverageVerdict): 0 | 1 | 2 {
  switch (result.verdict) {
    case "satisfied":
      return 0;
    case "violated":
      return 1;
    case "indeterminate":
      return 2;
    default: {
      const unhandled: never = result;
      throw new Error(`fleetCoverageVerdictToExitCode: unknown verdict ${JSON.stringify(unhandled)}`);
    }
  }
}
