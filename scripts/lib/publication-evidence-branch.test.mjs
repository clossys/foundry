import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Real, executable coverage for verify_branch_is_ours() in
// scripts/lib/publication-evidence-branch.sh — the function
// .github/workflows/record-publication-evidence.yml's "Push branch..." step
// sources and, via classify_open_evidence_branch, calls before ever treating
// an earlier run's open branch as already carrying this run's record. The
// #1468 tests at the end cover the two helpers that step also sources. This is the exact function the 2026-09-23 security re-review
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

/** Run a sourced helper and return { status, stdout } — never throws. */
function runHelper(cwd, fn, args) {
  try {
    const stdout = execFileSync("bash", ["-c", `set -euo pipefail; source "${scriptPath}"; ${fn} "$@"`, fn, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? "" };
  }
}

const PREFIX = "automation/publication-evidence/";
const RECORD = "governance/release-publications/later/publisher-0.7.0.json";

test("#1468: evidence_branch_name yields <prefix><run-id>-<8 hex>, a different name on every call, and refuses a non-numeric run id", () => {
  const first = runHelper(process.cwd(), "evidence_branch_name", [PREFIX, "36054685251"]);
  const second = runHelper(process.cwd(), "evidence_branch_name", [PREFIX, "36054685251"]);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /^automation\/publication-evidence\/36054685251-[0-9a-f]{8}\n$/);
  assert.notEqual(first.stdout, second.stdout, "two runs (or two push attempts) never share a name");
  assert.notEqual(runHelper(process.cwd(), "evidence_branch_name", [PREFIX, "36054685251; echo x"]).status, 0);
  assert.notEqual(runHelper(process.cwd(), "evidence_branch_name", [PREFIX, ""]).status, 0);
});

/** A record body carrying just enough shape for the classifier: its own publish source commit. */
function record(sourceSha, tag) {
  return `${JSON.stringify({ tag, publication: { provenance: { sourceSha } } })}\n`;
}

/**
 * A repository shaped like the #1461 incident: `main` has a commit `source`
 * (the publish run's source, carrying the qualification record) that lands
 * AFTER an older evidence branch `predates` was cut. That older branch's own
 * record (writer) is sourced at the root commit, inside its base, so it is a
 * perfectly valid pull request for its own record.
 */
function incidentRepo() {
  const root = initRepo();
  const rootSha = git(["rev-parse", "HEAD"], root).trim();
  git(["checkout", "-q", "-b", "predates"], root);
  botCommit(root, "governance/release-publications/later/writer-0.4.0.json", record(rootSha, "writer"));
  git(["checkout", "-q", "main"], root);
  humanCommit(root, "governance/release-qualifications/clossys-publisher-0.7.0.json", "{}\n", "qualify publisher");
  const source = git(["rev-parse", "HEAD"], root).trim();
  const copy = join(root, "..", `${root.split("/").pop()}-record.json`);
  writeFileSync(copy, record(source, "publisher"));
  return { root, rootSha, source, copy };
}

function classify(root, ref, source, copy) {
  return runHelper(root, "classify_open_evidence_branch", [ref, "main", RECORD, copy, source]).stdout.trim();
}

function withIncident(fn) {
  const fixture = incidentRepo();
  try {
    fn(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.copy, { force: true });
  }
}

test("verify_branch_is_ours returns false, never an empty-loop pass, when rev-list fails after merge-base succeeded", () => {
  const root = initRepo();
  try {
    git(["checkout", "-q", "-b", "evidence"], root);
    botCommit(root, "governance/release-publications/later/strategist-0.1.1.json", "{}\n");
    let passed;
    try {
      execFileSync("bash", ["-c", `set -e; source "${scriptPath}"; git() { if [ "$1" = rev-list ]; then return 1; fi; command git "$@"; }; verify_branch_is_ours evidence main`], { cwd: root, stdio: "ignore" });
      passed = true;
    } catch {
      passed = false;
    }
    assert.equal(passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#1468: classify_open_evidence_branch says adoptable for a verified branch cut after this record's source, whose own records are sourced in its base, that lacks this record", () => {
  withIncident(({ root, rootSha, source, copy }) => {
    git(["checkout", "-q", "-b", "current", "main"], root);
    botCommit(root, "governance/release-publications/later/writer-0.4.0.json", record(rootSha, "writer"));
    botCommit(root, "governance/release-publications/later/designer-0.6.0.json", record(source, "designer"));
    assert.equal(classify(root, "current", source, copy), "adoptable");
  });
});

test("#1468: classify_open_evidence_branch says predates — not broken — for a valid branch cut before THIS record's source whose own records are sourced in its base", () => {
  withIncident(({ root, source, copy }) => {
    assert.equal(classify(root, "predates", source, copy), "predates");
  });
});

test("#1468: classify_open_evidence_branch says broken for a verified branch carrying a record whose OWN source is not in its base — the #1461 shape — including this very record", () => {
  withIncident(({ root, source, copy }) => {
    // Exactly #1461: this run's record, byte-identical, added to a branch
    // cut before its source.
    git(["checkout", "-q", "predates"], root);
    botCommit(root, RECORD, record(source, "publisher"));
    assert.equal(classify(root, "predates", source, copy), "broken");
  });
  withIncident(({ root, source, copy }) => {
    // A different record whose own source landed on main after the cut.
    git(["checkout", "-q", "-b", "current", "main"], root);
    git(["checkout", "-q", "main"], root);
    humanCommit(root, "later-main.txt", "x\n", "main moves on");
    const later = git(["rev-parse", "HEAD"], root).trim();
    git(["checkout", "-q", "current"], root);
    botCommit(root, "governance/release-publications/later/designer-0.6.0.json", record(later, "designer"));
    assert.equal(classify(root, "current", source, copy), "broken");
  });
});

test("#1468: classify_open_evidence_branch says broken, fail-closed, for a modified record, unreadable JSON, or a missing sourceSha", () => {
  withIncident(({ root, rootSha, source, copy }) => {
    git(["checkout", "-q", "main"], root);
    humanCommit(root, "governance/release-publications/later/advisor-0.1.5.json", record(rootSha, "advisor"), "merged record");
    git(["checkout", "-q", "-b", "modifies", "main"], root);
    botCommit(root, "governance/release-publications/later/advisor-0.1.5.json", record(rootSha, "advisor-changed"));
    assert.equal(classify(root, "modifies", source, copy), "broken");
    git(["checkout", "-q", "-b", "garbled", "main"], root);
    botCommit(root, "governance/release-publications/later/designer-0.6.0.json", "not json\n");
    assert.equal(classify(root, "garbled", source, copy), "broken");
    git(["checkout", "-q", "-b", "unsourced", "main"], root);
    botCommit(root, "governance/release-publications/later/designer-0.6.0.json", "{}\n");
    assert.equal(classify(root, "unsourced", source, copy), "broken");
  });
});

test("#1468: classify_open_evidence_branch says duplicate only for identical bytes, on a verified branch cut from a base containing the source", () => {
  withIncident(({ root, source, copy }) => {
    git(["checkout", "-q", "-b", "fresh", "main"], root);
    botCommit(root, RECORD, record(source, "publisher"));
    assert.equal(classify(root, "fresh", source, copy), "duplicate");
  });
});

test("#1468: classify_open_evidence_branch says conflict for different bytes (current or predating), and for this record on a branch verify_branch_is_ours refuses", () => {
  withIncident(({ root, source, copy }) => {
    git(["checkout", "-q", "-b", "different", "main"], root);
    botCommit(root, RECORD, record(source, "publisher-other"));
    assert.equal(classify(root, "different", source, copy), "conflict");
    git(["checkout", "-q", "predates"], root);
    botCommit(root, RECORD, record(source, "publisher-other"));
    assert.equal(classify(root, "predates", source, copy), "conflict");
    git(["checkout", "-q", "-b", "planted", "main"], root);
    humanCommit(root, RECORD, record(source, "publisher"), "planted by a human");
    assert.equal(classify(root, "planted", source, copy), "conflict");
  });
});

test("#1468: classify_open_evidence_branch says foreign for an unverifiable branch without this record, and missing — a distinct verdict — for an unreadable ref", () => {
  withIncident(({ root, source, copy }) => {
    git(["checkout", "-q", "-b", "planted", "main"], root);
    humanCommit(root, "scripts-evil.sh", "echo pwned\n", "planted by a human");
    assert.equal(classify(root, "planted", source, copy), "foreign");
    assert.equal(classify(root, "no-such-branch", source, copy), "missing");
  });
});
