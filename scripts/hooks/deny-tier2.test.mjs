// Regression tests for the Bash-matcher deny hook, deny-tier2.mjs, and
// its ALLOWLIST model (#1187 escalation-rule round 6, both reviewers,
// blocking: a denylist of write verbs can never be complete -- every
// round found another one). Two layers:
//   (unit) direct calls into evaluateCommand()/splitCommand()/etc. for
//   fast, precise coverage of the parsing/allowlist logic itself.
//   (subprocess) a handful of spawnSync calls feeding real stdin JSON,
//   proving the exported logic and the actual installed hook protocol
//   agree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateCommand, splitCommand, peelPrefixes, resolveVar, referencesProtectedPath } from "./deny-tier2.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "deny-tier2.mjs");

function blocked(command) {
  return evaluateCommand(command).blocked;
}

function assertBlocked(command, label) {
  assert.equal(blocked(command), true, `expected BLOCKED: ${label ?? command}`);
}

function assertAllowed(command, label) {
  assert.equal(blocked(command), false, `expected ALLOWED: ${label ?? command}`);
}

function runSubprocess(command) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  return result.status;
}

const RULE = "docs/HITL-RULE.md";
const HOOKS_DOC = "docs/HITL-HOOKS.md";
const RECORD = "governance/decisions/hitl-escalation-rule.json";
const HOOK_SCRIPT = "scripts/hooks/deny-tier2.mjs";
const HOOK_EDIT_SCRIPT = "scripts/hooks/deny-tier2-edit.mjs";
const SETTINGS = "~/.claude/settings.json";
const SETTINGS_LOCAL = ".claude/settings.local.json";
const ALL_PROTECTED = [RULE, HOOKS_DOC, RECORD, HOOK_SCRIPT, HOOK_EDIT_SCRIPT, SETTINGS, SETTINGS_LOCAL];

test("always-tier-2 command shapes are still blocked (unchanged from round 4)", () => {
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

for (const path of ALL_PROTECTED) {
  test(`every previously-enumerated write verb blocks ${path}`, () => {
    assertBlocked(`echo x > ${path}`, `> ${path}`);
    assertBlocked(`echo x >> ${path}`, `>> ${path}`);
    assertBlocked(`echo x >| ${path}`, `>| ${path}`);
    assertBlocked(`sed -i s/x/y/ ${path}`);
    assertBlocked(`truncate -s 0 ${path}`);
    assertBlocked(`rm ${path}`);
    assertBlocked(`rm -f ${path}`);
    assertBlocked(`git rm ${path}`);
    assertBlocked(`install /tmp/x ${path}`);
    assertBlocked(`dd if=/tmp/x of=${path}`);
    assertBlocked(`perl -pi -e s/x/y/ ${path}`);
    assertBlocked(`cp /tmp/x ${path}`);
    assertBlocked(`echo hello | tee ${path}`);
    assertBlocked(`mv /tmp/x ${path}`, `mv -> ${path} (destination)`);
    assertBlocked(`mv ${path} /tmp/x`, `mv ${path} (source, moving it away)`);
    assertBlocked(`git mv ${path} /tmp/x`, `git mv ${path} (source)`);
  });

  test(`round-6 fix: combined/reordered flags now block ${path} (the allowlist model doesn't care about flags at all)`, () => {
    assertBlocked(`sed --in-place s/x/y/ ${path}`);
    assertBlocked(`sed -E -i s/x/y/ ${path}`);
    assertBlocked(`sed -Ei s/x/y/ ${path}`, `sed -Ei ${path} (combined flags, round-6 B2)`);
    assertBlocked(`sed -ni p ${path}`, `sed -ni ${path} (combined flags, round-6 B2)`);
    assertBlocked(`perl -i -pe 's/x/y/' ${path}`);
    assertBlocked(`perl -0pi -e 's/x/y/' ${path}`, `perl -0pi ${path} (0 flag, round-6 B2)`);
  });

  test(`round-6 fix: a write on the SECOND OR LATER line of a multi-line command now blocks ${path} (round-6 B1)`, () => {
    assertBlocked(`true\nrm ${path}`, `true\\nrm ${path}`);
    assertBlocked(`echo start\nsed -i '' s/a/b/ ${path}`, `echo start\\nsed -i ${path}`);
    assertBlocked(`cd /tmp\nmv ${path} /tmp/x`, `cd /tmp\\nmv ${path}`);
  });

  test(`round-6 fix: command prefixes (sudo, env, time, command, nohup, xargs) no longer bypass ${path}`, () => {
    assertBlocked(`sudo rm ${path}`);
    assertBlocked(`env LC_ALL=C sed -i s/a/b/ ${path}`);
    assertBlocked(`time sed -i s/a/b/ ${path}`);
    assertBlocked(`command rm ${path}`);
    assertBlocked(`nohup rm ${path}`);
    assertBlocked(`echo ${path} | xargs sed -i s/a/b/`, `xargs sed -i (path as literal xargs arg)`);
    assertBlocked(`/bin/rm ${path}`, `/bin/rm ${path} (absolute binary path)`);
    assertBlocked(`\\rm ${path}`, `backslash-escaped rm ${path}`);
  });

  test(`round-6 fix: subshells, command groups, and control-flow keywords no longer bypass ${path}`, () => {
    assertBlocked(`(rm ${path})`, `(rm ${path})`);
    assertBlocked(`{ rm ${path}; }`, `{ rm ${path}; }`);
    assertBlocked(`$(rm ${path})`, `$(rm ${path})`);
    assertBlocked(`` + "`rm " + path + "`", `backtick subshell rm ${path}`);
    assertBlocked(`if true; then rm ${path}; fi`, `if/then rm ${path}`);
    assertBlocked(`for f in x; do rm ${path}; done`, `for/do rm ${path}`);
    assertBlocked(`true || rm ${path}`, `|| rm ${path}`);
  });

  test(`fails closed on an unrecognized verb referencing ${path}`, () => {
    assertBlocked(`unlink ${path}`, `unlink ${path} (unknown verb)`);
    assertBlocked(`shred ${path}`, `shred ${path} (unknown verb)`);
    assertBlocked(`awk -i inplace '{print}' ${path}`, `awk -i inplace ${path} (unknown verb)`);
    assertBlocked(`vim ${path}`, `vim ${path} (unknown verb)`);
    assertBlocked(`git apply ${path}.patch -- ${path}`, `git apply referencing ${path}`);
    assertBlocked(`patch ${path} < /tmp/x.diff`, `patch ${path} (unknown verb)`);
  });

  test(`glob-that-could-match and quote-split reconstruction both block ${path}`, () => {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    if (base.length > 4) {
      const globPath = `${dir === "." ? "" : dir + "/"}${base.slice(0, 4)}*`;
      assertBlocked(`rm ${globPath}`, `rm ${globPath} (glob that could match ${path})`);
    }
    const mid = Math.floor(base.length / 2);
    const splitBase = `${base.slice(0, mid)}'${base.slice(mid)}'`;
    const splitPath = `${dir === "." ? "" : dir + "/"}${splitBase}`;
    assertBlocked(`rm ${splitPath}`, `rm ${splitPath} (quote-split reconstruction of ${path})`);
  });
}

test("round-6 fix: an unresolved $VAR referencing a non-read verb fails closed", () => {
  assertBlocked("rm $F", "rm $F (F never assigned in this command)");
  assertBlocked("sed -i s/a/b/ ${TARGET}", "sed -i ${TARGET} (unresolved)");
});

test("round-6 fix: a $VAR assigned earlier in the SAME command to a protected path is tracked and blocks", () => {
  assertBlocked(`F=${RULE}; rm $F`, "F=<rule>; rm $F");
  assertBlocked(`F=${RULE}\nrm $F`, "F=<rule> (newline) rm $F");
  assertBlocked(`export F=${RULE}; rm "$F"`, 'export F=<rule>; rm "$F"');
});

test("a $VAR assigned to something UNRELATED is resolved precisely and does not false-positive", () => {
  assertAllowed("F=/tmp/unrelated.txt; rm $F", "F=/tmp/unrelated.txt; rm $F");
  assertAllowed("F=/tmp/unrelated.txt\nrm $F", "F=/tmp/unrelated.txt (newline) rm $F");
});

test("read-only allowlist verbs are allowed even when they reference a protected path", () => {
  for (const path of ALL_PROTECTED) {
    assertAllowed(`cat ${path} 2>/dev/null`, `cat ${path}`);
    assertAllowed(`less ${path}`, `less ${path}`);
    assertAllowed(`head ${path}`, `head ${path}`);
    assertAllowed(`tail -n 5 ${path}`, `tail ${path}`);
    assertAllowed(`grep -n install ${path}`, `grep ${path}`);
    assertAllowed(`rg install ${path}`, `rg ${path}`);
    assertAllowed(`wc -l ${path}`, `wc ${path}`);
    assertAllowed(`diff ${path} /tmp/other`, `diff ${path}`);
    assertAllowed(`cmp ${path} /tmp/other`, `cmp ${path}`);
    assertAllowed(`file ${path}`, `file ${path}`);
    assertAllowed(`stat ${path}`, `stat ${path}`);
    assertAllowed(`ls -la ${path}`, `ls ${path}`);
    assertAllowed(`jq . ${path}`, `jq (no -i) ${path}`);
    assertAllowed(`cp ${path} /tmp/x`, `cp ${path} /tmp/x (source)`);
  }
  assertAllowed(`git show HEAD:${RECORD}`, "git show <record>");
  assertAllowed(`git log -- ${RULE}`, "git log -- <rule>");
  assertAllowed(`git diff HEAD -- ${RULE} > /tmp/d.txt`, "git diff <rule> to unrelated dest");
  assertAllowed(`git blame ${RULE}`, "git blame <rule>");
  assertAllowed(`git cat-file -p HEAD:${RULE}`, "git cat-file <rule>");
  assertAllowed(`node --check ${HOOK_SCRIPT}`, "node --check <hook script>");
});

test("verbs demoted from round 3/4's allow-list are now blocked (deliberate tightening: perl and sed are never read-only, regardless of flags)", () => {
  assertBlocked(`perl -Mstrict -ne 'print' ${RULE}`, "perl -Mstrict -ne (no -i) is still blocked under the allowlist model");
  assertBlocked(`sed -n '1,5p' ${RULE}`, "sed -n (no -i) is still blocked under the allowlist model");
});

test("cp/rsync: the protected path may be a SOURCE, never the destination", () => {
  assertAllowed(`cp ${RULE} /tmp/x`, "cp <rule> /tmp/x (source)");
  assertBlocked(`cp /tmp/x ${RULE}`, "cp /tmp/x <rule> (destination)");
  assertAllowed(`rsync -a ${RULE} /tmp/x`, "rsync <rule> /tmp/x (source)");
  assertBlocked(`rsync -a /tmp/x ${RULE}`, "rsync /tmp/x <rule> (destination)");
});

test("jq -i / --in-place is blocked; jq without it is allowed", () => {
  assertAllowed(`jq . ${RULE}`, "jq . <rule>");
  assertBlocked(`jq -i . ${RULE}`, "jq -i");
  assertBlocked(`jq --in-place . ${RULE}`, "jq --in-place");
});

test("node without --check is blocked (can execute arbitrary code); node --check is allowed", () => {
  assertBlocked(`node ${HOOK_SCRIPT}`, "node <hook script> (executes it)");
  assertAllowed(`node --check ${HOOK_SCRIPT}`, "node --check <hook script>");
  assertAllowed(`node -c ${HOOK_SCRIPT}`, "node -c <hook script>");
});

test("round-6 fix N3: a protected path used only as a `<` INPUT redirect target is a read, not a write", () => {
  assertAllowed(`tee /tmp/out < ${RULE}`, "tee /tmp/out < <rule> (reads <rule>, writes /tmp/out)");
});

test("a protected path as the destination of `<` combined with also being an explicit write argument still blocks", () => {
  assertBlocked(`tee ${RULE} < /tmp/x`, "tee <rule> < /tmp/x (writes <rule>)");
});

test("false positives from earlier rounds stay fixed", () => {
  assertAllowed(`cd governance/decisions && cat hitl-escalation-rule.json`, "cd + basename read");
  assertAllowed(`rm -rf /tmp/scratch`, "rm -rf of an unrelated directory");
  assertAllowed(`rm -rf node_modules`, "rm -rf of an ordinary, unrelated directory name");
});

test("round-6 tightening: git checkout/restore of a specific protected FILE, and chmod on one, are now blocked (previously documented, now-closed bypasses)", () => {
  // Round 3/4 documented these as open bypasses under the old denylist
  // model (neither "checkout" nor "chmod" was a matched write verb).
  // Under the allowlist model, "git checkout" isn't one of the small
  // read-only git subcommands (show/log/diff/blame/cat-file), and
  // "chmod" isn't a recognized verb at all -- both now fail closed.
  assertBlocked(`git checkout HEAD~1 -- ${RULE}`, "git checkout <rule> now blocks (fails closed)");
  assertBlocked(`git restore --source=HEAD~1 ${RULE}`, "git restore <rule> now blocks (fails closed)");
  assertBlocked(`chmod 000 ${HOOK_SCRIPT}`, "chmod <hook script> now blocks (fails closed)");
  assertBlocked(`ln -sf /tmp/x ${HOOK_SCRIPT}`, "ln -sf <hook script> now blocks (fails closed)");
});

test("part (c): recursive/destructive operations on an ANCESTOR directory of a protected path block, even with no protected basename named", () => {
  assertBlocked("rm -rf docs", "rm -rf docs (ancestor of HITL-RULE.md)");
  assertBlocked("rm -rf governance", "rm -rf governance (ancestor of the decision record)");
  assertBlocked("rm -rf governance/decisions", "rm -rf governance/decisions");
  assertBlocked("rm -rf scripts/hooks", "rm -rf scripts/hooks (ancestor of both hook scripts)");
  assertBlocked("git rm -r docs", "git rm -r docs");
  assertBlocked("mv docs docs-renamed", "mv docs docs-renamed");
  assertBlocked("git mv docs docs-renamed", "git mv docs docs-renamed");
  assertBlocked("git checkout main -- docs", "git checkout <ref> -- docs (ancestor pathspec)");
  assertBlocked("git restore --source=HEAD~1 docs", "git restore an ancestor");
  assertBlocked("git reset --hard -- docs", "git reset an ancestor pathspec");
  assertBlocked("git stash -- docs", "git stash an ancestor pathspec");
  assertBlocked("rsync -a --delete /tmp/src/ docs", "rsync --delete into docs");
  assertBlocked("ln -s docs /tmp/alias", "ln -s docs (aliasing an ancestor directory)");
  assertBlocked("cd docs\nrm -rf .", "cd docs; rm -rf . (relative ancestor via cd)");
  assertBlocked("cd docs && git clean -fdx", "cd docs && git clean -fdx (forced clean of an ancestor cwd)");
});

test("ancestor-directory checks do not false-positive on ordinary, unrelated directories", () => {
  assertAllowed("rm -rf dist", "rm -rf dist");
  assertAllowed("rm -rf build", "rm -rf build");
  assertAllowed("mv docs/build-tmp /tmp/x", "mv of a SUBdirectory of docs, not docs itself");
  assertAllowed("git rm -r packages/foo", "git rm -r of an unrelated directory");
  assertAllowed("rsync -a --delete /tmp/src/ /tmp/dest/", "rsync --delete into an unrelated directory");
});

test("documented, still-open bypasses remain open and are not silently claimed as fixed", () => {
  assertAllowed(`python3 -c "open('${RULE}','w').close()"`, "an interpreter one-liner running from -c text (documented gap)");
  assertAllowed(`node -e "require('fs').writeFileSync('${RULE}','x')"`, "a node -e one-liner (documented gap)");
});

test("fails open on empty or unparseable command text", () => {
  assertAllowed("", "empty command");
});

test("subprocess parity: the exported logic and the real installed script agree on a sample of cases", () => {
  assert.equal(runSubprocess(`rm ${RULE}`), 2);
  assert.equal(runSubprocess(`sed -Ei s/a/b/ ${RULE}`), 2);
  assert.equal(runSubprocess(`true\nrm ${RULE}`), 2);
  assert.equal(runSubprocess("rm -rf docs"), 2);
  assert.equal(runSubprocess(`cat ${RULE}`), 0);
  assert.equal(runSubprocess(`cp ${RULE} /tmp/x`), 0);
  assert.equal(runSubprocess("git push --force origin main"), 2);
  assert.equal(runSubprocess("npm test"), 0);
  const emptyResult = spawnSync(process.execPath, [scriptPath], { input: "", encoding: "utf8" });
  assert.equal(emptyResult.status, 0);
  const badJsonResult = spawnSync(process.execPath, [scriptPath], { input: "{not json", encoding: "utf8" });
  assert.equal(badJsonResult.status, 0);
});

test("splitCommand: exercised directly for the boundary characters it must split on", () => {
  assert.deepEqual(splitCommand("a; b"), ["a", "b"]);
  assert.deepEqual(splitCommand("a && b"), ["a", "b"]);
  assert.deepEqual(splitCommand("a || b"), ["a", "b"]);
  assert.deepEqual(splitCommand("a | b"), ["a", "b"]);
  assert.deepEqual(splitCommand("a\nb"), ["a", "b"]);
  assert.deepEqual(splitCommand("(a)"), ["a"]);
  assert.deepEqual(splitCommand("{ a; }"), ["a"]);
  assert.deepEqual(splitCommand("$(a)"), ["$", "a"]);
  assert.deepEqual(splitCommand("if true; then a; fi"), ["if true", "then a", "fi"]);
});

test("peelPrefixes + resolveVar: exercised directly for prefix stripping and variable tracking", () => {
  const vars = new Map();
  assert.deepEqual(peelPrefixes(["sudo", "rm", "x"], vars), { verb: "rm", args: ["x"] });
  assert.deepEqual(peelPrefixes(["env", "FOO=bar", "rm", "x"], vars), { verb: "rm", args: ["x"] });
  assert.equal(vars.get("FOO"), "bar");
  assert.deepEqual(peelPrefixes(["/bin/rm", "x"], new Map()), { verb: "rm", args: ["x"] });
  assert.deepEqual(peelPrefixes(["\\rm", "x"], new Map()), { verb: "rm", args: ["x"] });
  const known = new Map([["F", "docs/HITL-RULE.md"]]);
  assert.deepEqual(resolveVar("$F", known), { value: "docs/HITL-RULE.md", hasUnknownVar: false });
  assert.deepEqual(resolveVar("${F}", known), { value: "docs/HITL-RULE.md", hasUnknownVar: false });
  assert.equal(resolveVar("$UNSET", new Map()).hasUnknownVar, true);
});

test("referencesProtectedPath: exercised directly for basename and glob matching", () => {
  assert.equal(referencesProtectedPath("docs/HITL-RULE.md"), true);
  assert.equal(referencesProtectedPath("HITL-RULE.md"), true);
  assert.equal(referencesProtectedPath("docs/HITL-*.md"), true);
  assert.equal(referencesProtectedPath("docs/unrelated.md"), false);
  assert.equal(referencesProtectedPath(""), false);
});
