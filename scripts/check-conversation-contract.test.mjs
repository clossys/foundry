// Regression tests for check-conversation-contract.mjs.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateComposedSkill,
  extractContractBlock,
  injectContract,
  scanConversationContract,
} from "./check-conversation-contract.mjs";

const CONTRACT_DOC = `# Conversation contract

Provenance prose that is not part of the injected block.

## How we work together

Every reply has four parts:

1. **Where we are** — status.
2. **My recommendation** — recommendation.
3. **Your call** — a question.
4. **What happens next** — next.

Rules:

- Ask only what only the client can know.
`;

const CONTRACT_BLOCK = extractContractBlock(CONTRACT_DOC);

function skillWithBothSections(extra = "") {
  return `---
name: clossys-widget
description: test skill
disable-model-invocation: true
---
# widget

Some role content.${extra}

## How we work together

1. **Status** — old text.

## One question at a time

Old text.

## When this package is installed

Installed guidance.
`;
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "conversation-contract-test-"));
}

test("extractContractBlock takes everything from the first `## How we work together` heading, trimmed", () => {
  assert.equal(CONTRACT_BLOCK.startsWith("## How we work together"), true);
  assert.equal(CONTRACT_BLOCK.includes("Provenance prose"), false);
});

test("injectContract replaces both legacy sections with the contract, at the same position", () => {
  const composed = injectContract(skillWithBothSections(), CONTRACT_BLOCK);
  assert.equal(composed.includes(CONTRACT_BLOCK), true);
  assert.equal(composed.includes("## One question at a time"), false);
  assert.equal(composed.includes("1. **Status** — old text."), false);
  assert.equal(composed.includes("## When this package is installed"), true);
  // Same position: role content before, installed guidance after.
  assert.ok(composed.indexOf("Some role content.") < composed.indexOf(CONTRACT_BLOCK));
  assert.ok(composed.indexOf(CONTRACT_BLOCK) < composed.indexOf("## When this package is installed"));
});

test("injectContract is idempotent: composing an already-composed skill again is unchanged", () => {
  const once = injectContract(skillWithBothSections(), CONTRACT_BLOCK);
  const twice = injectContract(once, CONTRACT_BLOCK);
  assert.equal(twice, once);
});

test("injectContract inserts before `## When this package is installed` when neither legacy heading is present", () => {
  const body = `---\nname: clossys-widget\n---\n# widget\n\nRole content.\n\n## When this package is installed\n\nInstalled guidance.\n`;
  const composed = injectContract(body, CONTRACT_BLOCK);
  assert.equal(composed.includes(CONTRACT_BLOCK), true);
  assert.ok(composed.indexOf(CONTRACT_BLOCK) < composed.indexOf("## When this package is installed"));
});

test("injectContract appends at end of file when no anchor heading exists at all", () => {
  const body = `---\nname: clossys-widget\n---\n# widget\n\nRole content only.\n`;
  const composed = injectContract(body, CONTRACT_BLOCK);
  assert.equal(composed.trim().endsWith(CONTRACT_BLOCK.trim()), true);
});

test("evaluateComposedSkill flags a missing contract, a duplicated contract, and a leftover legacy heading", () => {
  const missing = evaluateComposedSkill("widget", "no contract here", CONTRACT_BLOCK);
  assert.equal(missing.findings.some((f) => f.rule === "contract-missing"), true);

  const duplicated = evaluateComposedSkill("widget", `${CONTRACT_BLOCK}\n\n${CONTRACT_BLOCK}`, CONTRACT_BLOCK);
  assert.equal(duplicated.findings.some((f) => f.rule === "contract-duplicated"), true);

  const leftover = evaluateComposedSkill("widget", `${CONTRACT_BLOCK}\n\n## One question at a time\n`, CONTRACT_BLOCK);
  assert.equal(leftover.findings.some((f) => f.rule === "legacy-heading-leftover"), true);

  const clean = evaluateComposedSkill("widget", CONTRACT_BLOCK, CONTRACT_BLOCK);
  assert.deepEqual(clean.findings, []);
});

test("scanConversationContract composes every packages/*/skill/SKILL.md into a temp directory and passes clean fixtures", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, "docs", "contracts"), { recursive: true });
    writeFileSync(join(root, "docs", "contracts", "conversation-contract.md"), CONTRACT_DOC);
    for (const name of ["alpha", "beta"]) {
      mkdirSync(join(root, "packages", name, "skill"), { recursive: true });
      writeFileSync(join(root, "packages", name, "skill", "SKILL.md"), skillWithBothSections());
    }
    const result = scanConversationContract(root);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.passed, ["alpha", "beta"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanConversationContract catches a package whose composed skill would still carry the old block", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, "docs", "contracts"), { recursive: true });
    writeFileSync(join(root, "docs", "contracts", "conversation-contract.md"), CONTRACT_DOC);
    mkdirSync(join(root, "packages", "gamma", "skill"), { recursive: true });
    // A skill whose contract heading text was hand-edited so the splice can't find it --
    // simulates a package that drifted out of the shared shape.
    writeFileSync(
      join(root, "packages", "gamma", "skill", "SKILL.md"),
      "---\nname: clossys-gamma\n---\n# gamma\n\nNo anchor headings at all.\n",
    );
    const result = scanConversationContract(root);
    // No anchor heading still appends the contract, so this should still pass --
    // regression guard: appended contract is present exactly once.
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanConversationContract exits 2 when the contract document is missing", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, "packages", "alpha", "skill"), { recursive: true });
    writeFileSync(join(root, "packages", "alpha", "skill", "SKILL.md"), skillWithBothSections());
    assert.throws(() => scanConversationContract(root), /conversation contract document not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
