import type { RenderInspectionErrorKind } from "./types.js";

const messages: Record<RenderInspectionErrorKind, string> = {
  "credential-unavailable": "Render credentials are unavailable.",
  "invalid-input": "Render inspection input is invalid.",
  "invalid-base-url": "Render API base URL is invalid.",
  aborted: "Render inspection was aborted.",
  network: "Render inspection request failed.",
  unauthorized: "Render authorization failed.",
  "rate-limited": "Render request was rate limited.",
  http: "Render returned an unsuccessful response.",
  "invalid-response": "Render returned an invalid response.",
};

export class RenderInspectionError extends Error {
  readonly kind: RenderInspectionErrorKind;
  readonly statusCode?: number;

  constructor(kind: RenderInspectionErrorKind, statusCode?: number) {
    super(messages[kind]);
    this.name = "RenderInspectionError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}
