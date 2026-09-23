/**
 * The shared check-output-envelope (`docs/contracts/check-output-envelope.json`,
 * issue #1174): one JSON report shape for every check command's report,
 * across every role. The contract itself shipped in Stage A (#1190/#1237)
 * with its own header noting "no package emits this envelope yet" --
 * `#1224`'s schema-version check (`./migrate/cli.js`) and `#1221`'s
 * heartbeat check (`./heartbeat/cli.js`) are the first real emitters, and
 * both build ONE envelope constructor here rather than each inventing its
 * own copy of the shape -- the order-dependent-PR rule (#1187 comment
 * 5789471852: a PR that changes a check-output shape builds on shared
 * framework definitions and merges after them, never a local copy).
 *
 * `verdict` reuses `GateVerdict` from `./gates/result.js` -- the identical
 * three-word vocabulary the contract itself declares -- rather than
 * re-declaring a second copy of "satisfied" | "violated" | "indeterminate".
 */
import type { GateVerdict } from "./gates/result.js";

export type { GateVerdict };

export interface CheckFinding {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}

export interface CheckMetric {
  readonly name: string;
  readonly value: number;
  readonly direction: "increase" | "decrease" | "maintain" | "target-range";
}

/** One check command's JSON report, exactly as `docs/contracts/check-output-envelope.json` shapes it. */
export interface CheckOutputEnvelope {
  readonly package: string;
  readonly version: string;
  readonly verdict: GateVerdict;
  /** Exactly one sentence, plain language -- the only field a non-technical reader sees with no translation. */
  readonly summary: string;
  readonly findings: readonly CheckFinding[];
  readonly metric?: CheckMetric;
  readonly nextAction?: string;
}

export interface BuildEnvelopeOptions {
  readonly package: string;
  readonly version: string;
  readonly verdict: GateVerdict;
  readonly summary: string;
  /** May be omitted or empty only when `verdict` is `"satisfied"` -- see the thrown error below. */
  readonly findings?: readonly CheckFinding[];
  readonly metric?: CheckMetric;
  readonly nextAction?: string;
}

/**
 * Builds one check-output-envelope report, enforcing the contract's own
 * two hard rules at construction time rather than leaving each caller to
 * remember them: `findings` is non-empty whenever `verdict` is not
 * `"satisfied"` ("a non-satisfied verdict with no findings reports a
 * problem while refusing to say what it is"), and `summary` is a real,
 * non-empty sentence.
 */
export function buildCheckOutputEnvelope(options: BuildEnvelopeOptions): CheckOutputEnvelope {
  const findings = options.findings ?? [];
  if (options.verdict !== "satisfied" && findings.length === 0) {
    throw new Error(
      `buildCheckOutputEnvelope: verdict "${options.verdict}" requires at least one finding -- a non-satisfied ` +
        `verdict with no findings reports a problem while refusing to say what it is.`,
    );
  }
  const summary = options.summary.trim();
  if (summary.length === 0) {
    throw new Error("buildCheckOutputEnvelope: summary is required and must be a non-empty, plain-language sentence.");
  }
  return Object.freeze({
    package: options.package,
    version: options.version,
    verdict: options.verdict,
    summary,
    findings: Object.freeze([...findings]),
    ...(options.metric !== undefined ? { metric: options.metric } : {}),
    ...(options.nextAction !== undefined ? { nextAction: options.nextAction } : {}),
  });
}

/**
 * Folds an envelope's `verdict` onto this repository's 0/1/2 exit-code
 * convention -- the identical mapping `gateResultToExitCode`
 * (`./gates/result.js`) already uses, applied to the envelope shape
 * instead of the internal `GateResult` shape.
 */
export function envelopeToExitCode(envelope: CheckOutputEnvelope): 0 | 1 | 2 {
  switch (envelope.verdict) {
    case "satisfied":
      return 0;
    case "violated":
      return 1;
    case "indeterminate":
      return 2;
    default: {
      const unhandled: never = envelope.verdict;
      throw new Error(`envelopeToExitCode: unknown verdict ${JSON.stringify(unhandled)}`);
    }
  }
}
