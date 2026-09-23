// Regression tests for the Edit/Write/MultiEdit/NotebookEdit-matcher deny
// hook, deny-tier2-edit.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "deny-tier2-edit.mjs");

function run(toolInput) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: "utf8",
  });
  return result.status;
}

const PROTECTED_PATHS = [
  "docs/HITL-RULE.md",
  "docs/HITL-HOOKS.md",
  "governance/decisions/hitl-escalation-rule.json",
  "governance/decisions/hitl-escalation-rule-owner-chat.json",
  "scripts/hooks/deny-tier2.mjs",
  "scripts/hooks/deny-tier2-edit.mjs",
  ".claude/settings.local.json",
  "/home/owner/.claude/settings.json",
];

for (const path of PROTECTED_PATHS) {
  test(`Edit/Write/MultiEdit (file_path) is blocked for ${path}`, () => {
    assert.equal(run({ file_path: path }), 2);
  });

  test(`NotebookEdit (notebook_path) is blocked for ${path}`, () => {
    assert.equal(run({ notebook_path: path }), 2);
  });

  test(`round-4 fix: notebook_path is still checked even when file_path is ALSO a (harmless) string, for ${path}`, () => {
    assert.equal(run({ file_path: "docs/HITL.md", notebook_path: path }), 2);
  });

  test(`round-4 fix: file_path is still checked even when notebook_path is ALSO a (harmless) string, for ${path}`, () => {
    assert.equal(run({ file_path: path, notebook_path: "notebooks/scratch.ipynb" }), 2);
  });
}

test("an ordinary edit to docs/HITL.md itself (tier-1, not protected) is allowed", () => {
  assert.equal(run({ file_path: "docs/HITL.md" }), 0);
  assert.equal(run({ notebook_path: "docs/HITL.md" }), 0);
});

test("an edit to an unrelated file is allowed", () => {
  assert.equal(run({ file_path: "src/index.ts" }), 0);
  assert.equal(run({ notebook_path: "notebooks/scratch.ipynb" }), 0);
});

test("fails open on empty, unparseable, or path-less input", () => {
  assert.equal(spawnSync(process.execPath, [scriptPath], { input: "", encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [scriptPath], { input: "{not json", encoding: "utf8" }).status, 0);
  assert.equal(run({}), 0);
  assert.equal(run({ file_path: 42 }), 0);
});
