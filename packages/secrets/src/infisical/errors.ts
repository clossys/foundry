import type { SecretKey } from "../types.js";

export type InfisicalErrorCode =
  | "INFISICAL_CONFIGURATION_INVALID"
  | "INFISICAL_AUTH_FAILED"
  | "INFISICAL_REQUEST_FAILED"
  | "INFISICAL_RESPONSE_INVALID"
  | "INFISICAL_RUN_FAILED"
  | "INFISICAL_MUTATION_DENIED"
  | "INFISICAL_REPLACEMENT_FAILED";

export class InfisicalError extends Error {
  readonly code: InfisicalErrorCode;
  readonly status?: number;
  readonly key?: SecretKey;

  constructor(
    code: InfisicalErrorCode,
    message: string,
    details: { status?: number; key?: SecretKey } = {},
  ) {
    super(message);
    this.name = "InfisicalError";
    this.code = code;
    this.status = details.status;
    this.key = details.key;
  }
}
