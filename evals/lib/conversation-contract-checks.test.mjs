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
