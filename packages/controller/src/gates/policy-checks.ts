/**
 * `verifyPolicyBindings` — orchestrated policy verification. Pure
 * orchestration: multiple `PolicyCheck`s in, one aggregated
 * `PolicyCheckResult[]` out, each one clearly attributable to the
 * `policyId` that produced it. Every binding is verified using
 * `@clossys/controller/policy`'s own `verifyBinding` — no verification logic is
 * reimplemented here.
 *
 * This package invents no notion of "where a binding declaration lives" or
 * "how content gets read". The caller has already read whatever file or
 * secret each check's `content` came from — most plausibly a future CI
 * script — and that stays explicitly the caller's problem, never this
 * package's.
 */

import { verifyBinding } from "../policy/index.js";
import type { PolicyCheck, PolicyCheckResult } from "./types.js";

/**
 * Verifies every `PolicyCheck` in `checks` against its own `binding` and
 * `content`, in order, and returns one `PolicyCheckResult` per check. Does
 * no I/O — every check's `content` is already in memory by the time this
 * function is called.
 */
export function verifyPolicyBindings(checks: PolicyCheck[]): PolicyCheckResult[] {
  return checks.map((check) => ({
    policyId: check.policyId,
    findings: verifyBinding(check.binding, check.content),
  }));
}
