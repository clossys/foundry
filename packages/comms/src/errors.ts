/** A normalized adapter failure that can cross the provider-neutral boundary. */
export class CommunicationDeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: string;

  constructor(
    code: string,
    message: string,
    options: { retryable: boolean; provider?: string; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CommunicationDeliveryError";
    this.code = code;
    this.retryable = options.retryable;
    this.provider = options.provider;
  }
}

/** Thrown before delivery when a message violates the core contract. */
export class CommunicationValidationError extends Error {
  readonly findings: readonly import("./types.js").CommunicationFinding[];

  constructor(findings: readonly import("./types.js").CommunicationFinding[]) {
    super(`Communication message is invalid: ${findings.map((finding) => `${finding.field} ${finding.message}`).join("; ")}`);
    this.name = "CommunicationValidationError";
    this.findings = findings;
  }
}
