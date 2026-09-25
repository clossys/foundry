// output-envelope — builds and validates this repository's shared
// docs/contracts/check-output-envelope.json shape for the evals gate's own
// report, the same way scripts/check-real-customer-evidence.mjs and
// scripts/check-permission-defaults.mjs already do for a repository-root
// gate: a plain literal object, validated with `validateCheckOutputEnvelope`
// imported from scripts/check-package-framework.mjs (the shared shape
// checker every report-mode gate here reuses), never a hand-rolled second
// copy of the shape rule and never a runtime dependency on
// @clossys/controller's own constructor -- that constructor is for a
// PACKAGE under packages/ to adopt (docs/contracts/check-output-envelope.json's
// own `adoption` rule); evals/ is not a package.

import { validateCheckOutputEnvelope } from "../../scripts/check-package-framework.mjs";

export const EVALS_PACKAGE_NAME = "foundry-evals";
export const EVALS_PACKAGE_VERSION = "1.0.0";

/**
 * Builds docs/contracts/check-output-envelope.json's shape and validates it
 * against its own rule before returning it. Throws if the envelope this gate
 * would emit is itself malformed -- the same fail-loud pattern
 * check-real-customer-evidence.mjs uses, so a bug in this gate's own report
 * construction is never silently shipped as a passing JSON body.
 */
export function buildEnvelope({ verdict, summary, findings, metric, nextAction }) {
  const envelope = {
    package: EVALS_PACKAGE_NAME,
    version: EVALS_PACKAGE_VERSION,
    verdict,
    summary,
    findings,
    ...(metric ? { metric } : {}),
    ...(nextAction ? { nextAction } : {}),
  };
  const envelopeFindings = validateCheckOutputEnvelope(envelope, "check-evals report");
  if (envelopeFindings.length > 0) {
    const detail = envelopeFindings.map((item) => `${item.rule}: ${item.message}`).join("; ");
    throw new Error(`check-evals: this gate's own report failed docs/contracts/check-output-envelope.json's shape check -- ${detail}`);
  }
  return envelope;
}
