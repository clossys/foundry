// Regression tests for generate-loop-section.mjs — pure rendering and splice
// logic, no filesystem. Mirrors check-capability-maps.test.mjs's style.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLoopSection, renderStageSection, spliceLoopSection } from "./generate-loop-section.mjs";

const STAGE_ACTIVITIES = {
  sense: "Read declared desired state and independently observe actual state.",
  judge: "Classify the delta without treating an unreadable observation as agreement.",
  act: "Correct the delta or hand it to the declared authority.",
  verify: "Reobserve actual state after correction.",
  learn: "Close on the setpoint, revise a faulty declaration, or escalate a persistent delta.",
};

function demand(overrides = {}) {
  return { reasoningTier: "standard", visionRequired: false, contextSize: "medium", parallel: false, independence: false, ...overrides };
}

function matrix(cells) {
  return { schemaVersion: 1, role: "@scope/alpha", cells };
}

test("renderStageSection sorts cells by capability id and formats applicable and n/a cells", () => {
  const cells = [
    { capability: "zebra-task", stage: "sense", applicable: true, inputs: "the zebra input", check: "zebra check", output: "clossys/alpha/zebra.json", proofCase: "case-z", demand: demand() },
    { capability: "alpha-task", stage: "sense", applicable: false, reason: "not applicable to alpha-task" },
  ];
  const rendered = renderStageSection("sense", STAGE_ACTIVITIES, cells);
  const alphaIndex = rendered.indexOf("alpha-task");
  const zebraIndex = rendered.indexOf("zebra-task");
  assert.ok(alphaIndex !== -1 && zebraIndex !== -1 && alphaIndex < zebraIndex, "alpha-task must render before zebra-task");
  assert.match(rendered, /alpha-task\*\*: n\/a — not applicable to alpha-task/);
  assert.match(rendered, /zebra-task\*\* — the zebra input\. Check: zebra check\. Output: `clossys\/alpha\/zebra\.json`\. Proof: `case-z`\./);
});

test("generateLoopSection is deterministic across repeated calls with the same input", () => {
  const doc = matrix([
    { capability: "confirm-fit", stage: "sense", applicable: true, inputs: "client intake", check: "fit-signal-check", output: "clossys/alpha/fit.json", proofCase: "case-1", demand: demand() },
    { capability: "confirm-fit", stage: "judge", applicable: false, reason: "no judgment at this stage" },
    { capability: "confirm-fit", stage: "act", applicable: false, reason: "no act at this stage" },
    { capability: "confirm-fit", stage: "verify", applicable: false, reason: "no verify at this stage" },
    { capability: "confirm-fit", stage: "learn", applicable: false, reason: "no learn at this stage" },
  ]);
  const first = generateLoopSection("@scope/alpha", doc, STAGE_ACTIVITIES);
  const second = generateLoopSection("@scope/alpha", doc, STAGE_ACTIVITIES);
  assert.equal(first, second);
  assert.match(first, /^## Run the feedback loop/);
  assert.match(first, /\/clossys-alpha loop/);
  assert.ok(first.endsWith("\n"));
  assert.equal(first.includes("\n\n\n"), false, "must not leave stacked blank lines");
});

test("spliceLoopSection replaces an existing section in place", () => {
  const skill = ["---", "name: clossys-alpha", "---", "", "# Alpha", "", "## Run the feedback loop", "", "stale content", "", "## When this package is installed", "", "installed body"].join("\n");
  const section = "## Run the feedback loop\n\nfresh content\n";
  const spliced = spliceLoopSection(skill, section);
  assert.match(spliced, /fresh content/);
  assert.equal(spliced.includes("stale content"), false);
  assert.match(spliced, /## When this package is installed/);
});

test("spliceLoopSection inserts before the installed heading when absent", () => {
  const skill = ["# Alpha", "", "## When this package is installed", "", "installed body"].join("\n");
  const section = "## Run the feedback loop\n\nfresh content\n";
  const spliced = spliceLoopSection(skill, section);
  const loopIndex = spliced.indexOf("## Run the feedback loop");
  const installedIndex = spliced.indexOf("## When this package is installed");
  assert.ok(loopIndex !== -1 && loopIndex < installedIndex);
});

test("spliceLoopSection appends at end when neither heading exists", () => {
  const skill = "# Alpha\n\nsome body";
  const section = "## Run the feedback loop\n\nfresh content\n";
  const spliced = spliceLoopSection(skill, section);
  assert.match(spliced, /some body[\s\S]*## Run the feedback loop/);
});
