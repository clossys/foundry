import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Real, executable coverage for verify_branch_is_ours() in
// scripts/lib/publication-evidence-branch.sh — the function
// .github/workflows/record-publication-evidence.yml's "Push branch..." step
// sources and calls before ever building on a branch it did not just create
// itself. This is the exact function the 2026-09-23 security re-review
// (finding "B3-residual") attacked directly with a hand-planted branch;
// these tests reproduce that same planted-branch shape against a real git
// repository rather than only asserting the workflow YAML's text.
const scriptPath = new URL("./publication-evidence-branch.sh", import.meta.url).pathname;
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const OTHER_EMAIL = "someone-else@example.invalid";

function git(args, cwd, env) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: env ?? { ...process.env, GIT_AUTHOR_NAME: BOT_NAME, GIT_AUTHOR_EMAIL: BOT_EMAIL, GIT_COMMITTER_NAME: BOT_NAME, GIT_COMMITTER_EMAIL: BOT_EMAIL } });
}

function botCommit(cwd, path, contents, message = "Record publication evidence") {
  const full = join(cwd, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents);
  git(["add", path], cwd);
  git(["commit", "-q", "-m", message], cwd, { ...process.env, GIT_AUTHOR_NAME: BOT_NAME, GIT_AUTHOR_EMAIL: BOT_EMAIL, GIT_COMMITTER_NAME: BOT_NAME, GIT_COMMITTER_EMAIL: BOT_EMAIL });
}

function humanCommit(cwd, path, contents, message = "not the bot") {
  const full = join(cwd, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents);
  git(["add", path], cwd);
  git(["commit", "-q", "-m", message], cwd, { ...process.env, GIT_AUTHOR_NAME: "someone", GIT_AUTHOR_EMAIL: OTHER_EMAIL, GIT_COMMITTER_NAME: "someone", GIT_COMMITTER_EMAIL: OTHER_EMAIL });
}

/** Run `verify_branch_is_ours "$1" "$2"` from the sourced script and return whether it exited 0 (true) or nonzero (false) — never throws. */
function verifies(cwd, ref, base) {
  try {
    execFileSync("bash", ["-c", `set -e; source "${scriptPath}"; verify_branch_is_ours "$1" "$2"`, "verify", ref, base], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), "publication-evidence-branch-"));
  git(["init", "-q", "-b", "main"], root);
  botCommit(root, "README.md", "root\n", "root commit");
  return root;
}

test("verify_branch_is_ours accepts a branch whose only new commits are bot-authored and confined to governance/release-publications/later/", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    botCommit(root, "governance/release-publications/later/strategist-0.1.1.json", "{}\n");
    assert.equal(verifies(root, "evidence", "main"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_branch_is_ours refuses a branch carrying a human-authored commit — the planted-branch attack the security re-review reproduced", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    // A write-access actor pre-creates the branch with an arbitrary file,
    // authored as themselves (not forging the bot identity at all).
    humanCommit(root, "scripts-evil.sh", "echo pwned\n", "planted by a human");
    assert.equal(verifies(root, "evidence", "main"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_branch_is_ours refuses a branch with a forged bot author whose commit still touches a path outside governance/release-publications/later/ — the path confinement is the real guard", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    // The bot identity is trivially forgeable by anyone with write access —
    // this repo's own comments say so. Path confinement is what actually
    // bounds the damage, so it alone must still refuse this branch.
    botCommit(root, "scripts-evil.sh", "echo pwned\n", "forged bot author, wrong path");
    assert.equal(verifies(root, "evidence", "main"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_branch_is_ours refuses a branch mixing one legitimate evidence commit with one planted commit", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    botCommit(root, "governance/release-publications/later/strategist-0.1.1.json", "{}\n", "legitimate record");
    humanCommit(root, "scripts-evil.sh", "echo pwned\n", "planted afterward");
    assert.equal(verifies(root, "evidence", "main"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_branch_is_ours accepts multiple legitimate bot commits from a genuine multi-record batch", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    botCommit(root, "governance/release-publications/later/strategist-0.1.1.json", "{}\n", "record one");
    botCommit(root, "governance/release-publications/later/butler-0.1.9.json", "{}\n", "record two");
    assert.equal(verifies(root, "evidence", "main"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_branch_is_ours returns false, never throws, for a ref with no common history with base", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "--orphan", "unrelated"], root);
    botCommit(root, "governance/release-publications/later/strategist-0.1.1.json", "{}\n", "no shared history with main");
    assert.equal(verifies(root, "unrelated", "main"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
