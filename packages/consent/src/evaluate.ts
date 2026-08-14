import type { ConsentEvaluation, ConsentEvaluationPolicy, ConsentPolicyVersion, ConsentRecord } from "./types.js";

function samePolicyVersion(a: ConsentPolicyVersion, b: ConsentPolicyVersion): boolean {
  return a.policyId === b.policyId && a.version === b.version;
}

/**
 * Compares a stored record against the policy version currently in force.
 *
 * - `undefined` input (and only `undefined` input) returns `{ status:
 *   "absent" }`. A record whose own `state.kind` is `"absent"` returns the
 *   same thing — there is no third "never asked" representation. Every
 *   other malformed or missing shape is a type error the caller cannot
 *   construct (`ConsentRecord | undefined` is the whole input domain); this
 *   function does not runtime-validate its input and does not fall back to
 *   `"absent"` for anything else, on purpose — a silent fallback here would
 *   make a truly malformed record indistinguishable from a subject who was
 *   genuinely never asked.
 * - A `"granted"` record whose `policyVersion` differs from
 *   `currentPolicyVersion` is ALWAYS `"stale"` — a policy change invalidates
 *   prior consent by definition, unconditionally, for grants.
 * - A `"denied"` record whose `policyVersion` differs is `"stale"` only when
 *   `policy.invalidateDenialOnPolicyBump` is `true`. This is issue #178's
 *   deliberately-left-open question: whether a policy bump also invalidates
 *   a prior refusal is a jurisdiction judgment, not a structural one, so
 *   this package never decides it itself. `policy` has **no default** — a
 *   caller must supply `invalidateDenialOnPolicyBump` explicitly every time,
 *   so nobody gets either answer by accident. When it evaluates to `false`,
 *   the returned `"denied"` status still reports the version the record
 *   actually answered (which may differ from `currentPolicyVersion`) rather
 *   than silently relabeling it as current — the fact of which version was
 *   actually answered must survive the evaluation either way.
 */
export function evaluateConsent(
  record: ConsentRecord | undefined,
  currentPolicyVersion: ConsentPolicyVersion,
  policy: ConsentEvaluationPolicy,
): ConsentEvaluation {
  if (record === undefined || record.state.kind === "absent") return { status: "absent" };

  const { state } = record;
  const current = samePolicyVersion(state.policyVersion, currentPolicyVersion);

  if (state.kind === "granted") {
    if (!current) return { status: "stale", previousPolicyVersion: state.policyVersion };
    return { status: "granted", policyVersion: state.policyVersion };
  }

  // state.kind === "denied"
  if (!current && policy.invalidateDenialOnPolicyBump) {
    return { status: "stale", previousPolicyVersion: state.policyVersion };
  }
  return { status: "denied", policyVersion: state.policyVersion };
}
