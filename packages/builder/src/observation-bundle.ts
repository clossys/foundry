/**
 * The observation-bundle contract (#255, narrowed): a versioned, validated
 * shape for one repository's own self-observation output.
 *
 * WHY THIS EXISTS, AND WHY IT IS NARROW
 * --------------------------------------
 * The fleet's evaluation model is inverted from a central scanner: each
 * repository runs its own gates, in its own CI, against its own tree, and
 * observes its own compliance. A plane that wants a fleet-wide picture does
 * not re-run those gates itself -- it reads what each repository already
 * concluded about itself. Today those conclusions have no standard shape or
 * transport: every plane that wants one improvises its own.
 *
 * #255 originally proposed generalizing that gap into a full declared-
 * intent-vs-live-state framework. The owner narrowed that: an API without a
 * consumer is a guess, and this repository's own `liveStateSurface`
 * consolidation (`./live-state.ts`) already generalizes the *reconciliation*
 * half of that shape. What is still missing, and still concrete enough to
 * ship, is the *transport* -- the one shape a repository's CI writes and a
 * plane's CI reads, with nothing about storage, scheduling, or fetching
 * decided here. See this file's own README section for the fuller
 * "what this is not" list.
 *
 * THE SHAPE
 * ---------
 * One bundle is one repository's self-observation, produced once per CI run
 * that cares to publish it:
 *
 *   - `repository` -- which repository this is about, opaque to this module;
 *   - `producedAt` -- when this bundle was produced, supplied by the caller
 *     (never read from the system clock -- see `writeObservationBundle`);
 *   - `gates` -- one `GateResult` per gate this repository's own CI ran,
 *     reusing `@vespeneventures/controller/gates`'s existing ternary rather
 *     than inventing a parallel result type (this package already depends
 *     on controller for that ternary throughout `./live-state.ts` and
 *     `./toolchain.ts`);
 *   - `schemaVersion` -- this contract's own version, so a reader can tell a
 *     bundle written against a newer or older shape apart from one that is
 *     simply malformed.
 *
 * `writeObservationBundle` and `validateObservationBundleShape` share one
 * validator (`collectObservationBundleFindings`) on purpose: the rules for
 * "is this a well-formed bundle" are the same rule, asked at two different
 * moments -- once, loudly, against data the CALLER controls and got wrong
 * (a programming error, so `writeObservationBundle` throws); and once,
 * quietly, against data a STRANGER's CI produced and might have gotten
 * wrong, or might be a stale or foreign shape entirely (so
 * `validateObservationBundleShape` returns findings instead of throwing --
 * see `./observation-aggregate.ts`, which is where a schema-invalid bundle
 * becomes `indeterminate` for the repository it claims to be about, never a
 * thrown exception that would take the whole aggregation down with it).
 *
 * Zero I/O, zero clock reads, zero network. Every value comes from the
 * caller; this module only shapes and validates what it is given.
 */

import type { GateResult } from "@vespeneventures/controller/gates";
import type { Finding } from "./types.js";

/** This contract's own schema version. Bumped only when the bundle SHAPE changes, never on a behavioral fix elsewhere in this package. */
export const OBSERVATION_BUNDLE_SCHEMA_VERSION = 1 as const;

/** Which repository one bundle is about. Opaque to this module -- never validated against a registry, because this module knows of no registry. */
export interface ObservationBundleRepository {
  /** Stable identifier the plane recognizes this repository by. Non-empty, otherwise unconstrained -- the plane decides its own naming scheme. */
  readonly id: string;
  /** The commit this observation was produced from, if knowable. Opaque; never parsed as a hash or validated against a remote. */
  readonly ref?: string;
}

/** One gate this repository's own CI ran, and what it concluded. */
export interface ObservationBundleGateEntry {
  /** Stable identifier for the gate, e.g. `"secret-scan"`, `"release-readiness"`. Non-empty, unique within one bundle -- see `validateObservationBundleShape`. */
  readonly gateId: string;
  /** The gate's own outcome, in the shared `GateResult` ternary this package already depends on `@vespeneventures/controller/gates` for. */
  readonly result: GateResult<Finding, string>;
}

/** One repository's self-observation, ready to be written to wherever the caller's CI decides observations live. */
export interface ObservationBundle {
  readonly schemaVersion: typeof OBSERVATION_BUNDLE_SCHEMA_VERSION;
  readonly repository: ObservationBundleRepository;
  /**
   * When this bundle was produced, ISO 8601, supplied by the caller. This
   * module never calls `Date.now()` or `new Date()` -- see the module
   * header, and `#313`/`#314`'s lesson (this repository's own
   * `liveStateSurface` timestamp bug) for why an unparseable value here is
   * a validation finding rather than something silently trusted.
   */
  readonly producedAt: string;
  /** Every gate this repository's own CI ran for this observation. Must be non-empty -- a bundle with zero gates observed nothing. */
  readonly gates: readonly ObservationBundleGateEntry[];
}

function bundleFinding(rule: string, message: string): Finding {
  return { rule, severity: "high", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Formats an arbitrary, possibly-malformed value for a "got X" diagnostic
 * message. Never throws -- unlike bare `JSON.stringify`, which throws a
 * `TypeError` on a top-level `BigInt` (and on any value containing one, or
 * a circular reference). `raw` is untrusted input from a stranger's bundle
 * by design (see the module header): a value this module cannot even
 * FORMAT must never take down validation itself -- that would mean one
 * malformed field crashes `validateObservationBundleShape`, which crashes
 * `parseObservationBundle`, which crashes `aggregateObservations` for every
 * OTHER repository in the same aggregation run, not just the malformed one.
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

const FINDING_SEVERITIES = new Set(["high", "medium", "low"]);

/**
 * True when `value` has the runtime shape of a `Finding`
 * (`{ rule, severity, message }`, matching `./types.ts`). A `violated`
 * `GateResult`'s `findings` array is untrusted, transported data -- without
 * this check, a malformed entry (`null`, `{}`, a bare string) passes the
 * "non-empty array" test on its own, `validateObservationBundleShape`
 * reports zero findings, and `parseObservationBundle` returns the bundle
 * typed as a well-formed `ObservationBundle` with `null` sitting inside it
 * as a `Finding` for every downstream consumer (starting with
 * `./observation-aggregate.ts`'s own fold).
 */
function isFindingShaped(value: unknown): value is Finding {
  return (
    isRecord(value) &&
    typeof value.rule === "string" &&
    value.rule.trim() !== "" &&
    typeof value.severity === "string" &&
    FINDING_SEVERITIES.has(value.severity) &&
    typeof value.message === "string" &&
    value.message.trim() !== ""
  );
}

/** True when `value` parses as a real instant. Mirrors this repository's own `#314` fix: a timestamp is validated by parsing, never by string comparison or shape alone. */
function isParseableInstant(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function collectGateResultFindings(value: unknown, path: string, findings: Finding[]): void {
  if (!isRecord(value)) {
    findings.push(bundleFinding("observation-bundle/gate-result-not-object", `${path} must be an object.`));
    return;
  }
  switch (value.verdict) {
    case "satisfied": {
      const evaluated = value.evaluated;
      if (!Number.isInteger(evaluated) || (evaluated as number) <= 0) {
        findings.push(
          bundleFinding(
            "observation-bundle/gate-result-invalid-evaluated",
            `${path}.evaluated must be a positive integer when verdict is "satisfied", got ${describeUnknown(evaluated)}.`,
          ),
        );
      }
      return;
    }
    case "violated": {
      const gateFindings = value.findings;
      if (!Array.isArray(gateFindings) || gateFindings.length === 0) {
        findings.push(
          bundleFinding(
            "observation-bundle/gate-result-empty-findings",
            `${path}.findings must be a non-empty array when verdict is "violated".`,
          ),
        );
        return;
      }
      gateFindings.forEach((entry: unknown, index: number) => {
        if (!isFindingShaped(entry)) {
          findings.push(
            bundleFinding(
              "observation-bundle/gate-result-invalid-finding",
              `${path}.findings[${index}] is not a well-formed Finding ({rule, severity, message}), got ${describeUnknown(entry)}.`,
            ),
          );
        }
      });
      return;
    }
    case "indeterminate": {
      const reason = value.reason;
      if (typeof reason !== "string" || reason.trim() === "") {
        findings.push(
          bundleFinding(
            "observation-bundle/gate-result-missing-reason",
            `${path}.reason is required and must be a non-empty string when verdict is "indeterminate".`,
          ),
        );
      }
      return;
    }
    default:
      findings.push(
        bundleFinding(
          "observation-bundle/gate-result-unknown-verdict",
          `${path}.verdict must be "satisfied", "violated", or "indeterminate", got ${describeUnknown(value.verdict)}.`,
        ),
      );
  }
}

/**
 * Validates that `raw` -- ANY value, not necessarily one this module
 * produced -- has the shape of a well-formed `ObservationBundle`. Pure and
 * offline: no network, no filesystem, no clock. Returns every finding, never
 * throws -- a caller reading a stranger's bundle treats a malformed one as
 * data to report on (see `./observation-aggregate.ts`), not as a program
 * error.
 */
export function validateObservationBundleShape(raw: unknown): readonly Finding[] {
  const findings: Finding[] = [];

  if (!isRecord(raw)) {
    findings.push(bundleFinding("observation-bundle/not-an-object", "An observation bundle must be an object."));
    return findings;
  }

  if (raw.schemaVersion !== OBSERVATION_BUNDLE_SCHEMA_VERSION) {
    findings.push(
      bundleFinding(
        "observation-bundle/unsupported-schema-version",
        `"schemaVersion" must be ${JSON.stringify(OBSERVATION_BUNDLE_SCHEMA_VERSION)}, got ${describeUnknown(raw.schemaVersion)}.`,
      ),
    );
  }

  const repository = raw.repository;
  if (!isRecord(repository)) {
    findings.push(bundleFinding("observation-bundle/missing-repository", "\"repository\" must be an object."));
  } else {
    if (typeof repository.id !== "string" || repository.id.trim() === "") {
      findings.push(bundleFinding("observation-bundle/missing-repository-id", "\"repository.id\" is required and must be a non-empty string."));
    }
    if (repository.ref !== undefined && (typeof repository.ref !== "string" || repository.ref.trim() === "")) {
      findings.push(bundleFinding("observation-bundle/invalid-repository-ref", "\"repository.ref\", when present, must be a non-empty string."));
    }
  }

  if (!isParseableInstant(raw.producedAt)) {
    findings.push(
      bundleFinding(
        "observation-bundle/produced-at-unparseable",
        `"producedAt" must be a parseable ISO 8601 instant, got ${describeUnknown(raw.producedAt)}.`,
      ),
    );
  }

  const gates = raw.gates;
  if (!Array.isArray(gates) || gates.length === 0) {
    findings.push(bundleFinding("observation-bundle/empty-gates", "\"gates\" must be a non-empty array -- a bundle with no gates observed nothing."));
  } else {
    const seenGateIds = new Set<string>();
    gates.forEach((entry: unknown, index: number) => {
      const path = `gates[${index}]`;
      if (!isRecord(entry)) {
        findings.push(bundleFinding("observation-bundle/gate-entry-not-object", `${path} must be an object.`));
        return;
      }
      const gateId = entry.gateId;
      if (typeof gateId !== "string" || gateId.trim() === "") {
        findings.push(bundleFinding("observation-bundle/gate-entry-missing-id", `${path}.gateId is required and must be a non-empty string.`));
      } else if (seenGateIds.has(gateId)) {
        findings.push(bundleFinding("observation-bundle/gate-entry-duplicate-id", `${path}.gateId ${JSON.stringify(gateId)} is duplicated within this bundle.`));
      } else {
        seenGateIds.add(gateId);
      }
      collectGateResultFindings(entry.result, `${path}.result`, findings);
    });
  }

  return findings;
}

/** What `parseObservationBundle` returns for a well-formed bundle. */
export interface ParsedObservationBundle {
  readonly ok: true;
  readonly bundle: ObservationBundle;
}

/** What `parseObservationBundle` returns for a bundle that failed shape validation. */
export interface InvalidObservationBundle {
  readonly ok: false;
  readonly findings: readonly Finding[];
}

/**
 * Validates `raw` and, when it passes, returns it narrowed to
 * `ObservationBundle`. Never throws -- a malformed bundle is exactly the
 * kind of thing `./observation-aggregate.ts` exists to report on rather
 * than crash over, so this function hands back findings instead.
 */
export function parseObservationBundle(raw: unknown): ParsedObservationBundle | InvalidObservationBundle {
  const findings = validateObservationBundleShape(raw);
  if (findings.length > 0) {
    return { ok: false, findings };
  }
  return { ok: true, bundle: raw as ObservationBundle };
}

/** What `writeObservationBundle` accepts: the caller-owned data an `ObservationBundle` is built from. */
export interface WriteObservationBundleInput {
  readonly repository: ObservationBundleRepository;
  /** ISO 8601, supplied by the caller. This function never reads a clock -- see the module header. */
  readonly producedAt: string;
  readonly gates: readonly ObservationBundleGateEntry[];
}

/**
 * Builds and serializes one `ObservationBundle` as a JSON string. Pure:
 * caller-supplied data in, a serialized bundle out. No I/O, no clock, no
 * network -- the caller decides where the returned string goes (a committed
 * artifact, a release asset, anywhere else), which is this contract's
 * SHAPE, not its storage. See the package README's "what this is not"
 * section.
 *
 * Throws if the assembled bundle would not pass
 * `validateObservationBundleShape` -- the same rules, but enforced loudly
 * here, because a caller building its own bundle and getting the shape
 * wrong is a programming error to catch at the call site, not data for a
 * downstream reader to puzzle over. A stranger's bundle failing the same
 * check downstream is a different situation entirely and is handled without
 * throwing -- see `./observation-aggregate.ts`.
 */
export function writeObservationBundle(input: WriteObservationBundleInput): string {
  const bundle: ObservationBundle = {
    schemaVersion: OBSERVATION_BUNDLE_SCHEMA_VERSION,
    repository: input.repository,
    producedAt: input.producedAt,
    gates: input.gates,
  };
  const findings = validateObservationBundleShape(bundle);
  if (findings.length > 0) {
    throw new Error(
      `writeObservationBundle: refusing to serialize an invalid bundle -- ${findings
        .map((finding) => `${finding.rule}: ${finding.message}`)
        .join("; ")}`,
    );
  }
  return JSON.stringify(bundle, null, 2);
}
