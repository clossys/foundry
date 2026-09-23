// Regression tests for the Bash-matcher deny hook, deny-tier2.mjs.
//
// Spawns the real script as a subprocess and feeds it the same
// Claude-Code-shaped JSON on stdin a live PreToolUse hook receives,
// exactly as the independent reviewers of #1187's HITL escalation-rule
// pull requests did by hand each round. Checking exit code 2 (block) vs
// exit code 0 (allow) here, in a committed test, is what "with tests"
// means for the regex fixes below -- not a one-off manual verification
// that has to be repeated by hand every future round.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "deny-tier2.mjs");

function run(command) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  return result.status;
}

function assertBlocked(command, label) {
  assert.equal(run(command), 2, `expected BLOCKED (exit 2): ${label ?? command}`);
}

function assertAllowed(command, label) {
  assert.equal(run(command), 0, `expected ALLOWED (exit 0): ${label ?? command}`);
}

const PROTECTED_PATHS = [
  "docs/HITL-RULE.md",
  "docs/HITL-HOOKS.md",
  "governance/decisions/hitl-escalation-rule.json",
  "governance/decisions/hitl-escalation-rule-owner-chat.json",
  "scripts/hooks/deny-tier2.mjs",
  "scripts/hooks/deny-tier2-edit.mjs",
  ".claude/settings.local.json",
  "~/.claude/settings.json",
];

test("always-tier-2 command shapes (unrelated to protected-file write-protection) are blocked", () => {
  assertBlocked("gh api repos/o/r/actions/runs/1/pending_deployments -f state=approved");
  assertBlocked("gh api repos/o/r/rulesets/1");
  assertBlocked("gh api repos/o/r/branches/claude/foo/protection -X DELETE");
  assertBlocked("gh api --method DELETE repos/o/r/git/refs/heads/claude/foo");
  assertBlocked("gh secret set FOO --body bar");
  assertBlocked("gh repo edit --description x");
  assertBlocked("gh pr merge 1 --admin");
  assertBlocked("npm publish");
  assertBlocked("npm unpublish foo@1.0.0");
  assertBlocked("npm dist-tag add foo@1.0.0 latest");
  assertBlocked("git push --force origin main");
  assertBlocked("git push -f origin main");
  assertBlocked("git push origin +main");
  assertBlocked("git push origin :some/branch");
  assertAllowed("git push --force-with-lease origin main");
});

for (const path of PROTECTED_PATHS) {
  test(`write-protection blocks known write shapes against ${path}`, () => {
    assertBlocked(`echo x > ${path}`);
    assertBlocked(`echo x >> ${path}`);
    assertBlocked(`sed -i s/x/y/ ${path}`);
    assertBlocked(`sed -i '' s/x/y/ ${path}`);
    assertBlocked(`sed -i.bak s/x/y/ ${path}`);
    assertBlocked(`truncate -s 0 ${path}`);
    assertBlocked(`rm ${path}`);
    assertBlocked(`rm -f ${path}`);
    assertBlocked(`git rm ${path}`);
    assertBlocked(`install /tmp/x ${path}`);
    assertBlocked(`dd if=/tmp/x of=${path}`);
    assertBlocked(`perl -pi -e s/x/y/ ${path}`);
    assertBlocked(`cp /tmp/x ${path}`);
    assertBlocked(`echo hello | tee ${path}`);
  });

  test(`round-4 fixes: sed --in-place / sed -E -i / sed -n -i now block ${path}`, () => {
    assertBlocked(`sed --in-place s/x/y/ ${path}`, `sed --in-place ${path}`);
    assertBlocked(`sed --in-place=.bak s/x/y/ ${path}`, `sed --in-place=.bak ${path}`);
    assertBlocked(`sed -E -i s/x/y/ ${path}`, `sed -E -i ${path}`);
    assertBlocked(`sed -n -i s/x/y/p ${path}`, `sed -n -i ${path}`);
  });

  test(`round-4 fix: perl -i -pe (flags as separate tokens) now blocks ${path}`, () => {
    assertBlocked(`perl -i -pe 's/x/y/' ${path}`, `perl -i -pe ${path}`);
    assertBlocked(`perl -i.bak -pe 's/x/y/' ${path}`, `perl -i.bak -pe ${path}`);
  });

  test(`round-4 fix: mv/git mv with the protected path as the SOURCE (moving it away) now blocks ${path}`, () => {
    assertBlocked(`mv ${path} /tmp/x`, `mv ${path} (source)`);
    assertBlocked(`git mv ${path} /tmp/x`, `git mv ${path} (source)`);
  });

  test(`mv/git mv with the protected path as the DESTINATION still blocks ${path}`, () => {
    assertBlocked(`mv /tmp/x ${path}`, `mv -> ${path} (destination)`);
    assertBlocked(`git mv /tmp/x ${path}`, `git mv -> ${path} (destination)`);
  });

  test(`round-4 fix: >| (noclobber override) now blocks ${path}`, () => {
    assertBlocked(`echo x >| ${path}`, `>| ${path}`);
  });
}

test("basename-only matching still catches a cd'd-into-the-directory command", () => {
  assertBlocked(
    "cd governance/decisions && echo x > hitl-escalation-rule.json",
    "cd + relative-basename write",
  );
});

test("false positives stay fixed: cp reading FROM a protected path, and grep referencing one, are allowed", () => {
  assertAllowed("cp docs/HITL-RULE.md /tmp/x", "cp FROM protected file");
  assertAllowed("cat docs/HITL-RULE.md 2>/dev/null", "cat protected file");
  assertAllowed("jq . docs/HITL-RULE.md > /tmp/copy.json", "jq protected file to unrelated dest");
  assertAllowed("git diff HEAD -- docs/HITL-RULE.md > /tmp/d.txt", "git diff protected file to unrelated dest");
  assertAllowed("grep -n install docs/HITL-RULE.md", "grep referencing a write-verb word");
  assertAllowed("grep -rn cp docs/HITL-RULE.md", "grep referencing cp");
  assertAllowed("rm -f /tmp/x && cat docs/HITL-RULE.md", "unrelated rm chained before a read");
});

test("cp still only anchors to its LAST argument (destination) -- reading FROM a protected file is allowed", () => {
  assertAllowed("cp scripts/hooks/deny-tier2.mjs /tmp/x", "cp deny-tier2.mjs to /tmp");
});

test("documented, still-open bypasses remain open (unchanged from round 3)", () => {
  assertAllowed("git checkout HEAD~1 -- docs/HITL-RULE.md", "git checkout restoring from history");
  assertAllowed("git restore --source=HEAD~1 docs/HITL-RULE.md", "git restore from history");
  assertAllowed("chmod 000 scripts/hooks/deny-tier2.mjs", "chmod does not write file bytes");
  assertAllowed("ln -sf /tmp/x scripts/hooks/deny-tier2.mjs", "symlink games do not match a write verb");
  assertAllowed("tee docs/HITL-RULE.md </tmp/input", "tee's destination-anchor misses trailing input redirection");
});

test("perl without an in-place flag is not blocked (reading/printing only)", () => {
  assertAllowed("perl -ne 'print if /x/' docs/HITL-RULE.md", "perl -ne (no -i)");
  assertAllowed("perl -pe 's/x/y/' docs/HITL-RULE.md", "perl -pe (no -i) prints to stdout, not in place");
});

test("an unrelated flag that merely contains the letter i does not false-positive perl in-place detection", () => {
  assertAllowed("perl -Mstrict -e 'print 1' docs/HITL-RULE.md", "perl -Mstrict is not an in-place flag");
});

test("sed without -i/--in-place is not blocked", () => {
  assertAllowed("sed -n '1,5p' docs/HITL-RULE.md", "sed -n (no -i)");
  assertAllowed("sed 's/x/y/' docs/HITL-RULE.md > /tmp/out", "sed to stdout, redirected to an unrelated file");
});

test("unrelated writes to unprotected paths are never blocked", () => {
  assertAllowed("echo x > /tmp/unrelated.md");
  assertAllowed("sed -i s/x/y/ /tmp/unrelated.md");
  assertAllowed("mv /tmp/a /tmp/b");
  assertAllowed("rm -rf /tmp/scratch");
});

test("fails open on empty or unparseable stdin", () => {
  const emptyResult = spawnSync(process.execPath, [scriptPath], { input: "", encoding: "utf8" });
  assert.equal(emptyResult.status, 0);
  const badJsonResult = spawnSync(process.execPath, [scriptPath], { input: "{not json", encoding: "utf8" });
  assert.equal(badJsonResult.status, 0);
  const noCommandResult = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ tool_input: {} }),
    encoding: "utf8",
  });
  assert.equal(noCommandResult.status, 0);
});
