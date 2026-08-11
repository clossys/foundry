import type { VercelInspectionErrorKind } from "./types.js";

const messages: Record<VercelInspectionErrorKind, string> = {
  "credential-unavailable": "Vercel credentials are unavailable.",
  "invalid-input": "Vercel inspection input is invalid.",
  "invalid-base-url": "Vercel API base URL is invalid.",
  aborted: "Vercel inspection was aborted.",
  network: "Vercel inspection request failed.",
  unauthorized: "Vercel authorization failed.",
  "rate-limited": "Vercel request was rate limited.",
  http: "Vercel returned an unsuccessful response.",
  "invalid-response": "Vercel returned an invalid response.",
};

export class VercelInspectionError extends Error {
  readonly kind: VercelInspectionErrorKind;
  readonly statusCode?: number;

  constructor(kind: VercelInspectionErrorKind, statusCode?: number) {
    super(messages[kind]);
    this.name = "VercelInspectionError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}
