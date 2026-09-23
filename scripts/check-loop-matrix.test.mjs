// Regression tests for check-loop-matrix.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLoopMatrix, validateLoopMatrixShape } from "./check-loop-matrix.mjs";
import { generateLoopSection } from "./generate-loop-section.mjs";

const ROLE = "@scope/alpha";
const STAGE_ACTIVITIES = {
  sense: "sense default", judge: "judge default", act: "act default", verify: "verify default", learn: "learn default",
};

function demand(overrides = {}) {
  return { reasoningTier: "standard", visionRequired: false, contextSize: "medium", parallel: false, independence: false, ...overrides };
}

function fullCellsFor(capabilities) {
  const cells = [];
  for (const capability of capabilities) {
    for (const stage of ["sense", "judge", "act", "verify", "learn"]) {
      cells.push({ capability, stage, applicable: false, reason: `${stage} not applicable to ${capability}` });
    }
  }
  return cells;
}

test("absence of loop-matrix.json is printed and counted, never a report-mode failure", () => {
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].loopMatrix, "absent");
});

test("--enforce fails a role with no loop-matrix.json", () => {
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null }], { enforce: true });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "required-loop-matrix-absent");
});

test("validateLoopMatrixShape requires every capability × every stage exactly once", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]).slice(0, 4) }; // missing "learn"
  const findings = validateLoopMatrixShape(ROLE, doc, ["confirm-fit"]);
  assert.ok(findings.some((f) => f.rule === "loop-matrix-missing-cell" && f.message.includes("learn")));
});

test("validateLoopMatrixShape rejects an applicable cell missing required fields", () => {
  const doc = { role: ROLE, cells: [{ capability: "confirm-fit", stage: "sense", applicable: true }] };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("invalid-cell-inputs"));
  assert.ok(rules.includes("invalid-cell-check"));
  assert.ok(rules.includes("cell-output-outside-role-folder"));
  assert.ok(rules.includes("invalid-cell-proof-case"));
});

test("validateLoopMatrixShape rejects an n/a cell that also carries content", () => {
  const doc = { role: ROLE, cells: [{ capability: "confirm-fit", stage: "sense", applicable: false, reason: "n/a", inputs: "should not be here" }] };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  assert.ok(findings.some((f) => f.rule === "cell-na-carries-content"));
});

test("validateLoopMatrixShape rejects a demand floor above the declared tier", () => {
  const doc = {
    role: ROLE,
    cells: [{ capability: "confirm-fit", stage: "sense", applicable: true, inputs: "x", check: "y", output: "clossys/alpha/z.json", proofCase: "case-1", demand: demand({ reasoningTier: "light", minimumTierFloor: "deep" }) }],
  };
  const findings = validateLoopMatrixShape(ROLE, doc, null);
  assert.ok(findings.some((f) => f.rule === "cell-demand-floor-above-tier"));
});

test("a well-formed matrix with no generated section in the skill reports declared/absent and no findings in report mode", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource: "# Alpha\n\nno loop section here", stageActivities: STAGE_ACTIVITIES }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].loopMatrix, "declared");
  assert.equal(result.table[0].generatedSection, "absent");
});

test("a generated section matching the matrix reports current with no findings", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const generated = generateLoopSection(ROLE, doc, STAGE_ACTIVITIES);
  const skillSource = `# Alpha\n\n${generated}\n## When this package is installed\n\ninstalled body\n`;
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource, stageActivities: STAGE_ACTIVITIES }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].generatedSection, "current");
});

test("a drifted generated section ALWAYS fails, even in report mode", () => {
  const doc = { role: ROLE, cells: fullCellsFor(["confirm-fit"]) };
  const skillSource = "# Alpha\n\n## Run the feedback loop\n\nhand-written, stale prose\n\n## When this package is installed\n";
  const result = evaluateLoopMatrix([{ role: ROLE, matrixDoc: doc, capabilityIds: ["confirm-fit"], skillSource, stageActivities: STAGE_ACTIVITIES }], { enforce: false });
  assert.ok(result.findings.some((f) => f.rule === "loop-section-drifted"));
  assert.equal(result.table[0].generatedSection, "stale");
});
