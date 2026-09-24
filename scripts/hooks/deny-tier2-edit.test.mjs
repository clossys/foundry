// Regression tests for the Edit/Write/MultiEdit/NotebookEdit-matcher deny
// hook, deny-tier2-edit.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// #1187 escalation-rule round 8, both reviewers, blocking B1: the
// patterns were not anchored to a path boundary, so a file ending in
// "settings.json" ANYWHERE, or one merely ending in a protected
// basename as a substring, blocked in every repository on the machine
// (both hooks are user-level).
test("round-8 fix: unanchored basename/settings matching no longer false-positives", () => {
  assert.equal(run({ file_path: ".vscode/settings.json" }), 0, ".vscode/settings.json");
  assert.equal(run({ file_path: "/tmp/proj/.vscode/settings.json" }), 0, "absolute .vscode/settings.json");
  assert.equal(run({ file_path: "src/config/app-settings.json" }), 0, "app-settings.json");
  assert.equal(run({ file_path: "usersettings.json" }), 0, "usersettings.json");
  assert.equal(run({ file_path: "test/fixtures/settings.json" }), 0, "test/fixtures/settings.json");
  assert.equal(run({ file_path: "packages/x/src/settings.local.json" }), 0, "settings.local.json outside .claude/");
  assert.equal(run({ file_path: "docs/NOT-HITL-RULE.md" }), 0, "NOT-HITL-RULE.md (substring of HITL-RULE.md)");
  // the real protected forms still block
  assert.equal(run({ file_path: ".claude/settings.local.json" }), 2, ".claude/settings.local.json still blocks");
  assert.equal(run({ file_path: "/home/owner/.claude/settings.json" }), 2, "~/.claude/settings.json still blocks");
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

// #1187 escalation-rule round 8, strong-class reviewer, blocking B2: a
// DANGLING symlink (whose own target does not exist yet either) could
// not be resolved by realpathSync at all, and the old fallback
// re-appended the LINK's own (harmless-looking) name instead of
// following it -- so a link literally named "neutral.json" pointing at
// ".claude/settings.local.json", which is usually absent, was never
// recognized as protected.
test("round-8 fix: a dangling symlink to a not-yet-existing protected path is still blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const linkPath = join(dir, "neutral.json");
    symlinkSync(".claude/settings.local.json", linkPath); // relative target, deliberately dangling
    assert.equal(run({ file_path: linkPath }), 2, "a dangling symlink to .claude/settings.local.json still blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("round-8 fix: a dangling symlink to a not-yet-existing superseding decision record is still blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const linkPath = join(dir, "neutral2.json");
    symlinkSync("governance/decisions/hitl-escalation-rule-v2.json", linkPath);
    assert.equal(run({ file_path: linkPath }), 2, "a dangling symlink to a -v2.json successor record still blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("round-8: a dangling symlink to something UNRELATED is not blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const linkPath = join(dir, "neutral3.json");
    symlinkSync("some/unrelated/not-yet-created.json", linkPath);
    assert.equal(run({ file_path: linkPath }), 0, "a dangling symlink to an unrelated path is allowed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #1187 escalation-rule round 9, strong-class reviewer, blocking B1: on
// a case-insensitive, Unicode-normalizing filesystem (APFS, macOS's
// default), a path differing only by U+017F (LATIN SMALL LETTER LONG S,
// "ſ") in place of "s", or U+212A (KELVIN SIGN) in place of "K", reads
// and writes the SAME real file as the plain-ASCII spelling, but was
// previously an unmatched, different JS string entirely.
test("round-9 fix: a Unicode long-s (U+017F) substitution for a protected basename still blocks", () => {
  const longS = "ſ"; // ſ
  assert.equal(run({ file_path: `.claude/${longS}ettings.json` }), 2, ".claude/ſettings.json (long s for s)");
  assert.equal(
    run({ file_path: `.claude/settings.local.j${longS}on` }),
    2,
    ".claude/settings.local.jſon (long s for s)",
  );
  assert.equal(
    run({ file_path: `governance/decisions/hitl-e${longS}calation-rule.json` }),
    2,
    "hitl-eſcalation-rule.json (long s for s)",
  );
  assert.equal(run({ file_path: `scripts/hooks/deny-tier2-edit.mj${longS}` }), 2, "deny-tier2-edit.mjſ (long s for s)");
});

test("round-9 fix: a Unicode Kelvin sign (U+212A) substitution for an ordinary K still blocks", () => {
  const kelvin = "K"; // K (KELVIN SIGN)
  // docs/HITL-HOOKS.md contains an ordinary "K" in "HOOKS" -- substitute
  // the Kelvin sign for it. NFKC folds U+212A back to ordinary "K", so
  // this should match the same protected basename.
  assert.equal(run({ file_path: `docs/HITL-HOO${kelvin}S.md` }), 2, "docs/HITL-HOO(Kelvin)S.md");
});

test("round-9: normal Unicode text unrelated to any protected name is not blocked", () => {
  assert.equal(run({ file_path: "docs/日本語のファイル.md" }), 0, "an unrelated non-ASCII filename is allowed");
});

// #1187 escalation-rule round 9, both reviewers, blocking B2/N1: a
// dangling symlink whose target is reached through a SYMLINKED ANCESTOR
// directory (as opposed to a symlinked ancestor whose target already
// fully exists, already covered above) previously returned the
// unresolved lexical target, missing that the alias directory itself
// resolves to the real, protected ancestor.
test("round-9 fix: a dangling symlink target reached through a symlinked ALIAS directory is still blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const realClaudeDir = join(dir, ".claude");
    mkdirSync(realClaudeDir);
    const aliasDir = join(dir, "claudealias");
    symlinkSync(realClaudeDir, aliasDir);
    // The dangling link points INTO the alias directory, at a file that
    // does not exist yet -- neither "aliasDir/settings.local.json" nor
    // ".claude/settings.local.json" exists on disk.
    const linkPath = join(dir, "neutral4.json");
    symlinkSync(join(aliasDir, "settings.local.json"), linkPath);
    assert.equal(
      run({ file_path: linkPath }),
      2,
      "a dangling symlink reached through a symlinked ancestor still resolves and blocks",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("round-9: a dangling symlink through a DANGLING ancestor symlink (nothing real anywhere) is allowed", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const danglingAliasDir = join(dir, "futurecfg"); // points at a directory that does not exist
    symlinkSync(join(dir, ".claude-future"), danglingAliasDir);
    const linkPath = join(dir, "neutral5.json");
    symlinkSync(join(danglingAliasDir, "settings.local.json"), linkPath);
    assert.equal(run({ file_path: linkPath }), 0, "nothing here resolves to a real protected path");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #1187 escalation-rule round 10, strong-class reviewer, blocking R1: a
// regression from round 9's B1 fix. NFKC folds some characters --
// fullwidth Latin letters among them -- that the FILESYSTEM does not
// fold. Resolving the NFKC-NORMALIZED path (round 9's mistake) names a
// DIFFERENT file than the one a fullwidth-named symlink actually points
// at, so the link was silently never followed at all. Resolution must
// use the ORIGINAL path; normalization applies only to the RESULT.
test("round-10 fix: a symlink whose own NAME contains a fullwidth character still resolves and blocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const realClaudeDir = join(dir, ".claude");
    mkdirSync(realClaudeDir);
    const realSettingsPath = join(realClaudeDir, "settings.json");
    writeFileSync(realSettingsPath, "{}");
    const fullwidthA = "ａ"; // ａ (FULLWIDTH LATIN SMALL LETTER A)
    const linkPath = join(dir, `${fullwidthA}lias.json`);
    symlinkSync(realSettingsPath, linkPath);
    assert.equal(run({ file_path: linkPath }), 2, "a fullwidth-named symlink alias to .claude/settings.json still blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("round-10 fix: a symlinked DIRECTORY whose own name contains a fullwidth character still resolves and blocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2-edit-test-"));
  try {
    const realClaudeDir = join(dir, ".claude");
    mkdirSync(realClaudeDir);
    const fullwidthX = "ｘ"; // ｘ (FULLWIDTH LATIN SMALL LETTER X)
    const aliasDir = join(dir, `${fullwidthX}dir`);
    symlinkSync(realClaudeDir, aliasDir);
    const aliasedFile = join(aliasDir, "settings.json");
    assert.equal(
      run({ file_path: aliasedFile }),
      2,
      "the real file under a fullwidth-named symlinked ancestor directory still resolves and blocks",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
