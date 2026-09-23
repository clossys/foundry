/**
 * Folds an already-computed `VercelInspectionResult` (`../vercel/index.ts`)
 * into this subpath's provider-neutral `GateResult` vocabulary, for the
 * "right deployment serving" half of #1211's live verification.
 *
 * This is the ONE place Cloudflare (via `checkDnsRecords`) and Vercel meet
 * as this contract's first worked example -- `verify.ts` and every other
 * file in this subpath stay provider-neutral; only this small adapter names
 * Vercel, and only to translate its inspector's own shape into the shape
 * `verifyWebSurfaceLiveState` already expects for `hostingObservation`. A
 * caller wanting a second hosting provider writes the equivalent adapter
 * for it; this module does not need to change.
 *
 * Pure and synchronous: the actual Vercel API call already happened in
 * `createVercelInspector(...).inspect(...)`, with a caller-supplied bearer
 * token -- this file never touches one, matching #1211's "Builder never
 * reads or stores a token."
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { VercelInspectionResult } from "../vercel/types.js";
import type { WebSurfaceFinding } from "./types.js";

export const VERCEL_HOSTING_REASONS = createGateReasons(["vercel-network", "vercel-invalid-response"] as const);
export type VercelHostingIndeterminateReason = (typeof VERCEL_HOSTING_REASONS.reasons)[number];

export function observeVercelHosting(
  inspection: VercelInspectionResult,
  input: { readonly expectedDomains: readonly string[] },
): GateResult<WebSurfaceFinding, VercelHostingIndeterminateReason> {
  if (inspection.kind === "indeterminate") {
    return VERCEL_HOSTING_REASONS.indeterminate(inspection.reason === "network" ? "vercel-network" : "vercel-invalid-response", inspection.detail);
  }

  const findings: WebSurfaceFinding[] = [];
  if (inspection.project !== "present") {
    findings.push({ rule: "vercel-project-missing", severity: "error", message: "The declared Vercel project was not found." });
  }
  if (inspection.deployment !== "ready") {
    findings.push({ rule: "vercel-production-deployment-not-ready", severity: "error", message: `The Vercel production deployment is "${inspection.deployment}", not "ready".` });
  }
  for (const domain of input.expectedDomains) {
    const check = inspection.domains.find((candidate) => candidate.domain === domain);
    if (check === undefined || check.status !== "present") {
      findings.push({
        rule: "vercel-domain-not-verified",
        severity: "error",
        message: `${domain} is not a verified domain on this Vercel project (status: ${check?.status ?? "not observed"}).`,
        path: domain,
      });
    }
  }

  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(1 + input.expectedDomains.length);
}
