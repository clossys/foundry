import type { ValidationFinding } from "./types.js";

export class InfluencerActionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: string;

  constructor(
    code: string,
    message: string,
    options: { retryable: boolean; provider?: string; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "InfluencerActionError";
    this.code = code;
    this.retryable = options.retryable;
    this.provider = options.provider;
  }
}

export class InfluencerValidationError extends Error {
  readonly findings: readonly ValidationFinding[];

  constructor(subject: string, findings: readonly ValidationFinding[]) {
    super(`${subject} is invalid: ${findings.map((finding) => `${finding.field} ${finding.message}`).join("; ")}`);
    this.name = "InfluencerValidationError";
    this.findings = findings;
  }
}
