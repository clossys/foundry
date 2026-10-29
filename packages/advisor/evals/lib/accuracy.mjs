// accuracy — scores one composition scenario's actual `composeKitFromProblems`
// result against its fixture's `expect` block. Pure: no filesystem or
// network access, no randomness. Issue #1185, scope addition recorded on
// #1176 ("Scope addition: kit composition scenarios", 2026-09-22): each
// scenario is scored for precision/recall against the expected team, plus
// the guardrail states (`over-cap`, `indeterminate`) the engine itself
// defines in packages/advisor/src/composition.ts and this repository's own
// mirror, scripts/lib/capability-catalogue.mjs.

/** @typedef {{ role: string }} ComposedRoleLike */

function rolesOf(result) {
  if (result.state === "composed" || result.state === "over-cap") {
    return result.roles.map((role) => role.role);
  }
  return [];
}

/**
 * Precision/recall of `actualRoles` against `expectedRoles`, as plain sets
 * (role order does not affect this score -- `sequence` below checks order
 * separately). Both are 1 when the sets are identical; either is 0 when
 * `actualRoles` is empty and `expectedRoles` is not (or vice versa for
 * precision when `actualRoles` is empty -- reported as 1 to avoid a
 * division by zero reading as a failure when both are legitimately empty).
 */
export function precisionRecall(expectedRoles, actualRoles) {
  const expected = new Set(expectedRoles);
  const actual = new Set(actualRoles);
  const intersection = [...actual].filter((role) => expected.has(role));
  const precision = actual.size === 0 ? (expected.size === 0 ? 1 : 0) : intersection.length / actual.size;
  const recall = expected.size === 0 ? (actual.size === 0 ? 1 : 0) : intersection.length / expected.size;
  return { precision, recall };
}

/**
 * Scores one scenario fixture against the real `composeKitFromProblems`
 * result computed from the current tree's real, generated capability
 * catalogue (built by scripts/lib/capability-catalogue.mjs#buildCapabilityCatalogue
 * from packages/*\/package.json foundry manifests). Returns
 * `{ scenarioId, passed, precision, recall, findings }` -- `findings`
 * follows docs/contracts/check-output-envelope.json's findingShape so the
 * caller can fold every scenario's findings into one envelope.
 */
export function scoreScenario(scenario, result) {
  const findings = [];
  const expect = scenario.expect;
  const scenarioId = scenario.id;

  const fail = (rule, message) => findings.push({ rule, severity: "error", message, path: `evals/scenarios/${scenarioId}.json` });

  if (expect.state !== result.state) {
    fail(
      "composition-state-mismatch",
      `scenario "${scenarioId}" expected state "${expect.state}" but composeKitFromProblems returned "${result.state}"${result.state === "indeterminate" ? ` (${result.reason})` : ""}`,
    );
    return { scenarioId, passed: false, precision: 0, recall: 0, findings };
  }

  if (expect.state === "indeterminate") {
    const reasonOk = typeof expect.reasonIncludes !== "string" || result.reason.includes(expect.reasonIncludes);
    if (!reasonOk) {
      fail("composition-reason-mismatch", `scenario "${scenarioId}" expected reason to include ${JSON.stringify(expect.reasonIncludes)}, got ${JSON.stringify(result.reason)}`);
    }
    return { scenarioId, passed: findings.length === 0, precision: 1, recall: 1, findings };
  }

  const actualRoles = rolesOf(result);
  const { precision, recall } = precisionRecall(expect.mustIncludeRoles, actualRoles);

  const missing = expect.mustIncludeRoles.filter((role) => !actualRoles.includes(role));
  if (missing.length > 0) {
    fail("composition-missing-expected-role", `scenario "${scenarioId}" is missing expected role(s): ${missing.join(", ")}`);
  }

  const excludeSet = new Set(expect.mustExcludeRoles ?? []);
  const wronglyIncluded = actualRoles.filter((role) => excludeSet.has(role));
  if (wronglyIncluded.length > 0) {
    fail("composition-unexpected-role", `scenario "${scenarioId}" composed unexpected role(s) that must be excluded: ${wronglyIncluded.join(", ")}`);
  }

  // Anything neither expected nor explicitly excluded is still unaccounted
  // for -- a scenario fixture's mustIncludeRoles is meant to be exhaustive,
  // so an extra role is exactly as much a regression as a missing one.
  const expectedSet = new Set(expect.mustIncludeRoles);
  const unaccounted = actualRoles.filter((role) => !expectedSet.has(role) && !excludeSet.has(role));
  if (unaccounted.length > 0) {
    fail("composition-unaccounted-role", `scenario "${scenarioId}" composed role(s) not listed in either mustIncludeRoles or mustExcludeRoles: ${unaccounted.join(", ")} -- update the fixture`);
  }

  if (typeof expect.maxRoles === "number" && actualRoles.length > expect.maxRoles) {
    fail("composition-exceeds-max-roles", `scenario "${scenarioId}" composed ${actualRoles.length} roles, exceeding maxRoles ${expect.maxRoles}`);
  }

  if (expect.state === "over-cap") {
    if (typeof expect.cap === "number" && result.cap !== expect.cap) {
      fail("composition-cap-mismatch", `scenario "${scenarioId}" expected cap ${expect.cap}, got ${result.cap}`);
    }
    if (typeof expect.roleCount === "number" && result.roleCount !== expect.roleCount) {
      fail("composition-role-count-mismatch", `scenario "${scenarioId}" expected roleCount ${expect.roleCount}, got ${result.roleCount}`);
    }
  }

  if (Array.isArray(expect.sequence)) {
    const actualSequence = result.sequence;
    const sequenceMatches = actualSequence.length === expect.sequence.length && actualSequence.every((role, index) => role === expect.sequence[index]);
    if (!sequenceMatches) {
      fail("composition-sequence-mismatch", `scenario "${scenarioId}" expected sequence [${expect.sequence.join(", ")}] but got [${actualSequence.join(", ")}]`);
    }
  }

  if (expect.state === "composed" && Array.isArray(expect.unsatisfiedNeeds) && expect.unsatisfiedNeeds.length === 0 && result.unsatisfiedNeeds.length > 0) {
    fail("composition-unsatisfied-needs", `scenario "${scenarioId}" expected no unsatisfied needs, got ${JSON.stringify(result.unsatisfiedNeeds)}`);
  }

  return { scenarioId, passed: findings.length === 0, precision, recall, findings };
}
