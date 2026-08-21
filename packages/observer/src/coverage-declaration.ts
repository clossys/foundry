/**
 * The coverage-declaration contract (#395): the one shape a repository
 * writes, once, to state out loud that it has deliberately decided NOT to
 * install one of this fleet's packages -- as opposed to simply never having
 * been swept for it yet. `./coverage.ts` is where a fleet-wide grader turns
 * these declarations, plus each repository's own caller-supplied installed
 * inventory, into a graded coverage matrix.
 *
 * WHERE THIS FILE MUST LIVE, AND WHY THAT IS PART OF THE CONTRACT
 * -----------------------------------------------------------------
 * #395 requires the declaration surface to live somewhere "a repository can
 * be read WITHOUT credentials for it, so the fleet aggregate can grade
 * coverage without holding a token per account." That rules out two
 * transports this fleet already uses elsewhere, for other purposes:
 *
 *   - The registry every package here publishes to
 *     (`https://npm.pkg.github.com`, see any package's own `publishConfig`)
 *     is GitHub Packages, which requires an authenticated npm token to
 *     read even a PUBLIC package -- GitHub does not serve package metadata
 *     anonymously the way npmjs.org does. A declaration carried as a field
 *     inside a published package's own manifest would need exactly the
 *     per-account credential this contract exists to avoid holding.
 *   - The GitHub REST/GraphQL contents API requires an Authorization
 *     header for any real volume of requests -- a fleet aggregate reading
 *     one declaration per repository, across a growing repository count,
 *     would exhaust the unauthenticated rate limit doing nothing else.
 *
 * What DOES read without a credential, for any public repository, is a
 * plain HTTP GET against the hosting provider's raw-content endpoint for a
 * file already committed to that repository's own default branch (for
 * example `https://raw.githubusercontent.com/<owner>/<repo>/<default-
 * branch>/.foundry/coverage-declaration.json`). That is the transport this
 * contract is designed for: each repository commits ONE JSON file, at one
 * fixed, well-known path, on its own default branch; a fleet aggregate
 * fetches that one URL per repository with a bare, unauthenticated GET, and
 * gets either a 200 with a body or a 404 meaning "this repository has never
 * declared anything" (which the caller represents as `undefined` -- see
 * `./coverage.ts`).
 *
 * This module never fetches anything itself. Doing so would put I/O, a
 * hosting-provider opinion, and a filesystem path inside a package that
 * otherwise performs zero I/O (`./coverage.ts`'s own header states the same
 * discipline for the grader). `parseCoverageDeclaration` takes the
 * ALREADY-FETCHED response body -- `unknown`, exactly as a caller's own
 * script would hand back the parsed JSON of one completed GET, or the
 * parsed contents of a local checkout's copy of the same file. This is the
 * identical shape `@vespeneventures/builder`'s `observation-bundle.ts`
 * already established for its own self-published, provider-agnostic bundle
 * contract ("this module never fetches anything itself... no storage
 * opinion") -- reused here as a design pattern, not as a dependency: this
 * package adds no import of `@vespeneventures/builder` to get it.
 */

/** This contract's own schema version. Bumped only when the declaration SHAPE changes. */
export const COVERAGE_DECLARATION_SCHEMA_VERSION = 1 as const;

/**
 * One package a repository states, out loud, that it has deliberately
 * decided not to install. `reason` is required and must be non-empty --
 * see the module header on why an unexplained absence is not this state at
 * all (`./coverage.ts` folds it to `unclassified` instead).
 */
export interface DeclaredPackageAbsence {
  readonly package: string;
  readonly reason: string;
}

/** One repository's own coverage declaration: which packages it has decided it has no lane for, and why. */
export interface CoverageDeclaration {
  readonly schemaVersion: typeof COVERAGE_DECLARATION_SCHEMA_VERSION;
  /** Stable identifier for the repository this declaration is about. Opaque to this module -- a fleet aggregate decides its own naming scheme. */
  readonly repository: string;
  /** May be empty -- a repository that has adopted every package in the fleet declares nothing absent. Must not name the same package twice; see `validateCoverageDeclarationShape`. */
  readonly declaredAbsences: readonly DeclaredPackageAbsence[];
}

/** One problem found validating a raw, untrusted declaration payload. Mirrors `@vespeneventures/builder`'s `observation-bundle.ts` `Finding` shape without importing it. */
export interface CoverageDeclarationFinding {
  readonly rule: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Formats an arbitrary, possibly-malformed value for a "got X" diagnostic.
 * Never throws -- unlike bare `JSON.stringify`, which throws on a
 * top-level `BigInt` or a circular reference, either of which is entirely
 * plausible in a stranger's raw JSON payload. See
 * `@vespeneventures/builder`'s `observation-bundle.ts`'s identical helper
 * and its doc comment for why a formatter that can throw is unsafe inside
 * a validator whose entire job is to describe untrusted input without
 * crashing on it.
 */
function describeUnknown(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function finding(rule: string, message: string): CoverageDeclarationFinding {
  return { rule, message };
}

/**
 * Validates that `raw` -- ANY value, not necessarily one this module
 * produced -- has the shape of a well-formed `CoverageDeclaration`. Pure
 * and offline. Returns every finding, never throws: a caller reading a
 * stranger's declaration treats a malformed one as data to grade
 * (`./coverage.ts` folds it into its own `"declaration-unreadable"`
 * unclassified reason), never as a program error.
 */
export function validateCoverageDeclarationShape(raw: unknown): readonly CoverageDeclarationFinding[] {
  const findings: CoverageDeclarationFinding[] = [];

  if (!isRecord(raw)) {
    findings.push(finding("coverage-declaration/not-an-object", "A coverage declaration must be an object."));
    return findings;
  }

  if (raw.schemaVersion !== COVERAGE_DECLARATION_SCHEMA_VERSION) {
    findings.push(
      finding(
        "coverage-declaration/unsupported-schema-version",
        `"schemaVersion" must be ${JSON.stringify(COVERAGE_DECLARATION_SCHEMA_VERSION)}, got ${describeUnknown(raw.schemaVersion)}.`,
      ),
    );
  }

  if (typeof raw.repository !== "string" || raw.repository.trim() === "") {
    findings.push(finding("coverage-declaration/missing-repository", '"repository" is required and must be a non-empty string.'));
  }

  const declaredAbsences = raw.declaredAbsences;
  if (!Array.isArray(declaredAbsences)) {
    findings.push(finding("coverage-declaration/declared-absences-not-array", '"declaredAbsences" must be an array (an empty array is valid).'));
  } else {
    const seenPackages = new Set<string>();
    declaredAbsences.forEach((entry: unknown, index: number) => {
      const path = `declaredAbsences[${index}]`;
      if (!isRecord(entry)) {
        findings.push(finding("coverage-declaration/absence-not-object", `${path} must be an object.`));
        return;
      }
      const pkg = entry.package;
      if (typeof pkg !== "string" || pkg.trim() === "") {
        findings.push(finding("coverage-declaration/absence-missing-package", `${path}.package is required and must be a non-empty string.`));
      } else if (seenPackages.has(pkg)) {
        findings.push(finding("coverage-declaration/absence-duplicate-package", `${path}.package ${JSON.stringify(pkg)} is declared absent more than once in this declaration.`));
      } else {
        seenPackages.add(pkg);
      }
      const reason = entry.reason;
      if (typeof reason !== "string" || reason.trim() === "") {
        findings.push(
          finding(
            "coverage-declaration/absence-missing-reason",
            `${path}.reason is required and must be a non-empty string -- an absence with no reason is not reviewable and does not qualify as "declared-absent".`,
          ),
        );
      }
    });
  }

  return findings;
}

/** What `parseCoverageDeclaration` returns for a well-formed declaration. */
export interface ParsedCoverageDeclaration {
  readonly ok: true;
  readonly declaration: CoverageDeclaration;
}

/** What `parseCoverageDeclaration` returns for a declaration that failed shape validation. */
export interface InvalidCoverageDeclaration {
  readonly ok: false;
  readonly findings: readonly CoverageDeclarationFinding[];
}

/**
 * Validates `raw` and, when it passes, returns it narrowed to
 * `CoverageDeclaration`. Never throws -- a malformed declaration is data
 * for `./coverage.ts` to grade (as `unclassified`), not a program error
 * that should crash the whole fleet run over one repository's bad file.
 */
export function parseCoverageDeclaration(raw: unknown): ParsedCoverageDeclaration | InvalidCoverageDeclaration {
  const findings = validateCoverageDeclarationShape(raw);
  if (findings.length > 0) {
    return { ok: false, findings };
  }
  return { ok: true, declaration: raw as CoverageDeclaration };
}

/** What `writeCoverageDeclaration` accepts: the caller-owned data a `CoverageDeclaration` is built from. */
export interface WriteCoverageDeclarationInput {
  readonly repository: string;
  readonly declaredAbsences: readonly DeclaredPackageAbsence[];
}

/**
 * Builds and serializes one `CoverageDeclaration` as a JSON string, ready
 * to be committed at the fixed path this contract is designed to be read
 * from (see the module header). Pure: caller-supplied data in, a
 * serialized declaration out -- this function never writes a file itself.
 *
 * Throws if the assembled declaration would not pass
 * `validateCoverageDeclarationShape` -- a caller building its OWN
 * declaration and getting the shape wrong (an empty reason, a duplicate
 * package) is a programming error to catch at the call site, mirroring
 * `@vespeneventures/builder`'s `writeObservationBundle`.
 */
export function writeCoverageDeclaration(input: WriteCoverageDeclarationInput): string {
  const declaration: CoverageDeclaration = {
    schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
    repository: input.repository,
    declaredAbsences: input.declaredAbsences,
  };
  const findings = validateCoverageDeclarationShape(declaration);
  if (findings.length > 0) {
    throw new Error(
      `writeCoverageDeclaration: refusing to serialize an invalid declaration -- ${findings
        .map((entry) => `${entry.rule}: ${entry.message}`)
        .join("; ")}`,
    );
  }
  return JSON.stringify(declaration, null, 2);
}
