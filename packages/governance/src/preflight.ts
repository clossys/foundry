import { preflightPackage } from "@vespeneventures/release";
import { runGovernanceCheck } from "./governance.js";
import type { GovernedPreflightOptions, GovernedPreflightReport } from "./types.js";

/**
 * Adds lifecycle and workspace evidence to `release`'s package preflight.
 * It delegates packing and isolated installation entirely to `release`; this
 * wrapper neither publishes nor supplies credentials or registry settings.
 */
export async function preflightGovernedPackage(
  root: string,
  packageDir: string,
  lifecycle: unknown,
  options?: GovernedPreflightOptions,
): Promise<GovernedPreflightReport> {
  if (options?.scope && options.release?.scope && options.scope !== options.release.scope) {
    throw new TypeError("scope and release.scope must match when both are provided");
  }
  const scope = options?.scope ?? options?.release?.scope;
  const releaseOptions = {
    ...options?.release,
    scope,
  };
  const [preflight, governance] = await Promise.all([
    preflightPackage(root, packageDir, releaseOptions),
    Promise.resolve(runGovernanceCheck(root, lifecycle, { scope })),
  ]);
  return { preflight, governance, ok: preflight.ok && governance.ok };
}
