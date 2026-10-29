// repeatability — issue #1176's owner comment ("Scope addition: kit
// composition scenarios", 2026-09-22): "each scenario runs several times;
// the composed team must be identical. Composition is deterministic once
// problems are confirmed, so any variance is a defect." This module runs
// `composeKitFromProblems` several times unchanged, and again over a few
// fixed reorderings of the same `confirmedProblems` array, and reports any
// run whose result differs from the first. Fixed reorderings (not a random
// shuffle) so the eval harness itself stays deterministic -- a flaky
// eval-of-the-eval would defeat the point.

/** Deterministic stable-key JSON stringify, so key order never causes a false mismatch. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Every fixed reordering this module tries, applied to a `confirmedProblems` array of any length >= 2. Order-preserving for length < 2. */
export function reorderings(confirmedProblems) {
  if (confirmedProblems.length < 2) return [confirmedProblems.slice()];
  const reversed = confirmedProblems.slice().reverse();
  const rotated = [...confirmedProblems.slice(1), confirmedProblems[0]];
  const sortedById = confirmedProblems.slice().sort((a, b) => a.id.localeCompare(b.id));
  return [confirmedProblems.slice(), reversed, rotated, sortedById];
}

/**
 * Runs `compose(confirmedProblems)` `runs` times unchanged, then once more
 * per fixed reordering of `confirmedProblems` (see {@link reorderings}), and
 * compares every result to the first run's result by deep, key-order-stable
 * equality. Returns `{ scenarioId, passed, findings }`; `findings` follows
 * docs/contracts/check-output-envelope.json's findingShape.
 */
export function checkRepeatability({ scenario, confirmedProblems, compose, runs = 5 }) {
  const scenarioId = scenario.id;
  const findings = [];
  const baseline = compose(confirmedProblems);
  const baselineKey = stableStringify(baseline);

  for (let attempt = 1; attempt < runs; attempt += 1) {
    const repeated = compose(confirmedProblems);
    if (stableStringify(repeated) !== baselineKey) {
      findings.push({
        rule: "composition-not-repeatable",
        severity: "error",
        message: `scenario "${scenarioId}" run ${attempt + 1} of ${runs} (identical input) produced a different composeKitFromProblems result than run 1 -- composition must be deterministic (#1176)`,
        path: `evals/scenarios/${scenarioId}.json`,
      });
      break;
    }
  }

  for (const [index, ordering] of reorderings(confirmedProblems).entries()) {
    const reordered = compose(ordering);
    if (stableStringify(reordered) !== baselineKey) {
      findings.push({
        rule: "composition-order-dependent",
        severity: "error",
        message: `scenario "${scenarioId}" reordering ${index + 1} of confirmedProblems produced a different composeKitFromProblems result than the original order -- composition must not depend on input ordering (#1176)`,
        path: `evals/scenarios/${scenarioId}.json`,
      });
    }
  }

  return { scenarioId, passed: findings.length === 0, findings };
}
