import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateSkillContract, roleOwnContent } from "./conversation-contract-checks.mjs";

const CONTRACT_BLOCK = [
  "## How we work together",
  "",
  "Every reply has four parts.",
  "",
  "Rules:",
  "",
  "- Never ask for ids, slugs, paths, versions, commands, or tool choices.",
].join("\n");

function skillWithRoleContent(roleContent) {
  return ["---", "name: clossys-example", "---", "# clossys-example", "", roleContent, "", CONTRACT_BLOCK, ""].join("\n");
}

test("roleOwnContent strips the shared contract block, keeping role-specific prose", () => {
  const body = skillWithRoleContent("This is the role's own content.");
  const stripped = roleOwnContent(body);
  assert.ok(stripped.includes("This is the role's own content."));
  assert.ok(!stripped.includes("Never ask for ids, slugs"));
});

test("evaluateSkillContract: clean role content has no findings", () => {
  const body = skillWithRoleContent("We recommend a plan and confirm one choice at a time.");
  assert.deepEqual(evaluateSkillContract("example", body), []);
});

test("evaluateSkillContract: an instruction to ask the client for an id is flagged", () => {
  const body = skillWithRoleContent("Ask the client for the record id before continuing.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "client-facing-jargon-request"));
});

// Regression cases for review #1413 B2: these three exact sentences (from
// both blind reviewers' probes) produced no finding before this fix,
// although the README, PR body, and finding message all claimed the rule
// covers version, path, and tool requests.
test("evaluateSkillContract: an instruction to ask the client which version is flagged", () => {
  const body = skillWithRoleContent("Ask the client which version they want to install.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "client-facing-jargon-request"));
});

test("evaluateSkillContract: an instruction to ask the client for a bare path is flagged", () => {
  const body = skillWithRoleContent("Ask the client for the repository path.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "client-facing-jargon-request"));
});

test("evaluateSkillContract: an instruction to ask the client which tool they prefer is flagged", () => {
  const body = skillWithRoleContent("Ask the client which tool they prefer.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "client-facing-jargon-request"));
});

// Negative control: ordinary jargon words that appear OUTSIDE an "ask ...
// client" clause must never be flagged, no matter how technical the
// sentence is -- the rule is scoped to instructions to ask the client
// something, not to a jargon scan of the whole file (see this module's own
// header for why a bare jargon scan would be the wrong rule for a file that
// is itself agent-facing technical documentation).
test("evaluateSkillContract: version/path/tool words in a non-ask sentence are not flagged", () => {
  const body = skillWithRoleContent("Read package.json to find this role's version, path, and preferred tool; never ask the client to restate them.");
  const findings = evaluateSkillContract("example", body);
  assert.deepEqual(findings.filter((f) => f.rule === "client-facing-jargon-request"), []);
});

// Regression case for review #1413 B2: before the `\b` fix, "id" with no
// trailing word boundary matched inside "idea"/"ideal", a false positive
// both reviewers' probes independently found.
test("evaluateSkillContract: 'idea'/'ideal' near the client are not flagged as an id request", () => {
  const body = skillWithRoleContent("Ask the founder about their product idea, and ask the client to describe their ideal customer.");
  const findings = evaluateSkillContract("example", body);
  assert.deepEqual(findings.filter((f) => f.rule === "client-facing-jargon-request"), []);
});

test("evaluateSkillContract: an instruction to ask multiple questions at once is flagged", () => {
  const body = skillWithRoleContent("Ask the client the following questions before moving on.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "multi-question-per-turn"));
});

test("evaluateSkillContract: a bare quoted loop with no role prefix in the sentence is flagged", () => {
  const body = skillWithRoleContent("Tell the client to type \"loop\" to begin.");
  const findings = evaluateSkillContract("example", body);
  assert.ok(findings.some((f) => f.rule === "bare-loop-directive"));
});

test("evaluateSkillContract: a correctly prefixed loop invocation is not flagged", () => {
  const body = skillWithRoleContent('Tell the client to type "/clossys-example loop" to begin.');
  const findings = evaluateSkillContract("example", body);
  assert.deepEqual(findings.filter((f) => f.rule === "bare-loop-directive"), []);
});

test("evaluateSkillContract: prose explaining the no-bare-loop rule itself is not flagged", () => {
  const body = skillWithRoleContent('Every invocation carries the "loop" keyword; never a bare skill name.');
  const findings = evaluateSkillContract("example", body);
  assert.deepEqual(findings.filter((f) => f.rule === "bare-loop-directive"), []);
});
