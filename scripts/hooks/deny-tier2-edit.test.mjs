// Regression tests for the Edit/Write/MultiEdit/NotebookEdit-matcher deny
// hook, deny-tier2-edit.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "deny-tier2-edit.mjs");
const repoRoot = join(scriptDir, "..", "..");

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

// #1187 escalation-rule round 6, coordinator instruction (d): resolve
// symlinks before comparing, so a symlink ALIAS to a protected path (or
// through a symlinked ancestor directory) can't present a different path
// string for the same real file and bypass basename matching.
test("symlink resolution: a plain-named alias file that resolves to a protected path is blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const aliasPath = join(dir, "not-a-protected-name.md");
    symlinkSync(join(repoRoot, "docs", "HITL-RULE.md"), aliasPath);
    assert.equal(run({ file_path: aliasPath }), 2, "editing the alias should block, same as editing docs/HITL-RULE.md directly");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("symlink resolution: an alias reached through a symlinked ANCESTOR directory is blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const aliasDir = join(dir, "docs-alias");
    symlinkSync(join(repoRoot, "docs"), aliasDir);
    const aliasedFile = join(aliasDir, "HITL-RULE.md");
    assert.equal(run({ file_path: aliasedFile }), 2, "the real file under a symlinked ancestor still resolves and blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("symlink resolution: an alias to an UNRELATED file is not blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const targetPath = join(dir, "unrelated-target.txt");
    symlinkSync(join(repoRoot, "package.json"), targetPath);
    assert.equal(run({ file_path: targetPath }), 0, "aliasing an unrelated tracked file is not itself protected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("symlink resolution: a not-yet-existing path is checked by resolving its existing ancestor directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const notYetCreated = join(dir, "brand-new-file.txt");
    assert.equal(run({ file_path: notYetCreated }), 0, "a genuinely new, unrelated path is allowed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
