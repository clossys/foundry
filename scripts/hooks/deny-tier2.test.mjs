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
import { mkdtempSync, copyFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("round-7 tightening B1: cp/rsync are no longer read-only for a SOURCE reference either -- every operand can be a destination", () => {
  // Round 6 allowed `cp <rule> /tmp/x` (source-only) and blocked only
  // the last argument. #1187 escalation-rule round 7, both reviewers,
  // blocking B1: `cp elsewhere/HITL-RULE.md docs/` (a directory
  // destination), `rsync src docs/HITL-RULE.md --progress` (destination
  // not last), and `rsync --remove-source-files <rule> /tmp/` (deletes
  // the source) all wrote/deleted the real file in a scratch repo while
  // "only the last argument is the destination" said they were reads.
  // cp/rsync are now simply never read-only, like every other verb not
  // on the small allowlist.
  assertBlocked(`cp ${RULE} /tmp/x`, "cp <rule> /tmp/x (round-7: no longer treated as a safe read)");
  assertBlocked(`cp /tmp/x ${RULE}`, "cp /tmp/x <rule> (destination)");
  assertBlocked(`rsync -a ${RULE} /tmp/x`, "rsync <rule> /tmp/x (round-7: no longer treated as a safe read)");
  assertBlocked(`rsync -a /tmp/x ${RULE}`, "rsync /tmp/x <rule> (destination)");
  assertBlocked(`cp elsewhere/HITL-RULE.md docs/`, "cp INTO a directory destination (round-7 B1)");
  assertBlocked(`rsync src docs/HITL-RULE.md --progress`, "rsync destination not last (round-7 B1)");
  assertBlocked(`rsync --remove-source-files docs/HITL-RULE.md /tmp/`, "rsync --remove-source-files deletes the source (round-7 B1)");
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
  assert.equal(runSubprocess(`cp ${RULE} /tmp/x`), 2);
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
  assert.deepEqual(peelPrefixes(["sudo", "rm", "x"], vars), { verb: "rm", args: ["x"], rawVerbToken: "rm" });
  assert.deepEqual(peelPrefixes(["env", "FOO=bar", "rm", "x"], vars), { verb: "rm", args: ["x"], rawVerbToken: "rm" });
  assert.equal(vars.get("FOO"), "bar");
  assert.deepEqual(peelPrefixes(["/bin/rm", "x"], new Map()), { verb: "rm", args: ["x"], rawVerbToken: "/bin/rm" });
  assert.deepEqual(peelPrefixes(["\\rm", "x"], new Map()), { verb: "rm", args: ["x"], rawVerbToken: "\\rm" });
  const known = new Map([["F", "docs/HITL-RULE.md"]]);
  assert.deepEqual(resolveVar("$F", known), { value: "docs/HITL-RULE.md", hasUnknownVar: false });
  assert.deepEqual(resolveVar("${F}", known), { value: "docs/HITL-RULE.md", hasUnknownVar: false });
  assert.equal(resolveVar("$UNSET", new Map()).hasUnknownVar, true);
  // round-7: HOME/PATH-style names resolve against process.env when set.
  if (process.env.HOME) {
    assert.equal(resolveVar("$HOME", new Map()).hasUnknownVar, false);
    assert.equal(resolveVar("$HOME", new Map()).value, process.env.HOME);
  }
});

test("referencesProtectedPath: exercised directly for basename and glob matching", () => {
  assert.equal(referencesProtectedPath("docs/HITL-RULE.md"), true);
  assert.equal(referencesProtectedPath("HITL-RULE.md"), true);
  assert.equal(referencesProtectedPath("docs/HITL-*.md"), true);
  assert.equal(referencesProtectedPath("docs/unrelated.md"), false);
  assert.equal(referencesProtectedPath(""), false);
  // round 7 B4: a bare wildcard with no other literal character gives
  // no discriminating signal at all -- a real, ordinary glob like
  // "packages/*" must not be treated as referencing a protected path.
  assert.equal(referencesProtectedPath("packages/*"), false);
  assert.equal(referencesProtectedPath("*"), false);
  // ... but a glob WITH other literal characters is still caught.
  assert.equal(referencesProtectedPath("*.json"), true);
  assert.equal(referencesProtectedPath("docs/HITL-{RULE,X}.md"), true);
});

// ===========================================================================
// Round 7: #1187 escalation-rule round 7. Two fresh, independent, blind
// reviews at 570fffd1 (strong-class #issuecomment-5804538591, fresh-final
// #issuecomment-5804557061) plus a coordinator scoping decision: the Bash
// hook is OPTIONAL, best-effort defence in depth (the tier-2 PR gate is the
// control that matters), so round 7 fixes a scoped set of cheap, high-value
// gaps and false positives and documents the rest rather than chasing every
// remaining text-analysis bypass.
// ===========================================================================

test("round-7 B2: ancestor-directory matching normalizes trailing slashes, ./ prefixes, doubled slashes, and absolute paths", () => {
  assertBlocked("rm -rf docs/", "rm -rf docs/ (trailing slash)");
  assertBlocked("rm -rf ./docs", "rm -rf ./docs (leading ./)");
  assertBlocked("rm -rf docs//", "rm -rf docs// (doubled trailing slash)");
  assertBlocked("rm -rf docs/.", "rm -rf docs/. (trailing /.)");
  assertBlocked("mv docs/ /tmp/d", "mv docs/ (trailing slash)");
  assertBlocked("git rm -rf docs/", "git rm -rf docs/ (trailing slash)");
  assertBlocked("git checkout main -- docs/", "git checkout -- docs/ (trailing slash)");
  assertBlocked("git restore docs/", "git restore docs/ (trailing slash)");
  assertBlocked("git clean -fdx docs/", "git clean -fdx docs/ (trailing slash)");
  assertBlocked(`rm -rf ${process.cwd()}/docs`, "rm -rf <absolute path>/docs");
});

test("round-7 B2: ancestor-directory matching recognizes ~/.claude and $HOME/.claude in every spelling", () => {
  assertBlocked("rm -rf ~/.claude/hooks", "rm -rf ~/.claude/hooks");
  assertBlocked("rm -rf ~/.claude", "rm -rf ~/.claude");
  assertBlocked("mv ~/.claude /tmp/c", "mv ~/.claude /tmp/c");
  if (process.env.HOME) {
    assertBlocked("rm -rf $HOME/.claude", "rm -rf $HOME/.claude");
    assertBlocked(`rm -rf ${process.env.HOME}/.claude`, "rm -rf <real home>/.claude");
  }
});

test("round-7 B2: cd scripts && rm -rf hooks -- a relative ancestor reached via cd, without the joined spelling ever appearing literally", () => {
  assertBlocked("cd scripts\nrm -rf hooks", "cd scripts; rm -rf hooks");
  assertBlocked("cd scripts && rm -rf hooks", "cd scripts && rm -rf hooks");
});

test("round-7 fix: brace expansion is no longer shattered into a false-allowed sequence of fragments", () => {
  assertBlocked(`rm docs/HITL-{RULE,X}.md`, "rm docs/HITL-{RULE,X}.md (brace expansion reconstructs a protected name)");
  assertBlocked(`rm docs/{HITL-RULE.md,other.txt}`, "rm docs/{HITL-RULE.md,other.txt}");
  // A genuine command GROUP, glued to nothing, still isolates its inner
  // command as its own segment the way round 6 already required.
  assertBlocked("{ rm docs/HITL-RULE.md; }", "{ rm docs/HITL-RULE.md; } (real command group)");
});

test("round-7 fix B3: >&file / &>file are redirects, not a background operator or command separator", () => {
  assertBlocked(`echo x >&${RULE}`, "echo x >&<rule>");
  assertBlocked(`echo x &>${RULE}`, "echo x &><rule>");
  assertAllowed(`echo x &`, "a bare background '&' with nothing after it is still just a boundary");
});

test("round-7 fix B3: a protected path landing in the VERB position (via $()/backtick splitting artifacts) is blocked", () => {
  assertBlocked(`$(echo rm) ${RULE}`, "$(echo rm) <rule> -- the path becomes its own segment's verb");
  assertBlocked("`echo rm` " + RULE, "`echo rm` <rule> (backtick form)");
});

test("round-7 fix B1: git diff/log/show --output=... is a write, not read-only", () => {
  assertBlocked(`git diff --output=${RULE}`, "git diff --output=<rule>");
  assertBlocked(`git log -1 --output=${RULE}`, "git log --output=<rule>");
  assertBlocked(`git show --output ${RULE} HEAD`, "git show --output <rule> (space form)");
  assertAllowed(`git diff HEAD -- ${RULE}`, "git diff <rule> with no --output is still read-only");
});

test("round-7 fix B1: node -c/--check only counts as read-only in the FIRST position after node", () => {
  assertAllowed(`node --check ${HOOK_SCRIPT}`, "node --check <script> (first position)");
  assertAllowed(`node -c ${HOOK_SCRIPT}`, "node -c <script> (first position)");
  assertBlocked(`node ${RULE} -c`, "node <rule> -c (trailing -c goes to the SCRIPT, not node)");
  assertBlocked(`node -e "require('fs').writeFileSync(process.argv[1],'x')" ${RULE} -c`, "node -e ... <rule> -c");
});

test("round-7 addition: node --test is allowed (this PR's own targeted test command)", () => {
  assertAllowed(`node --test ${HOOK_SCRIPT.replace(/\.mjs$/, ".test.mjs")}`, "node --test <hook test file>");
  assertAllowed("node --test scripts/hooks/deny-tier2.test.mjs", "node --test scripts/hooks/deny-tier2.test.mjs");
  assertAllowed("node --test scripts/hooks/*.test.mjs", "node --test scripts/hooks/*.test.mjs (glob)");
});

test("round-7 addition: find is read-only unless it can act on what it finds", () => {
  assertAllowed(`find . -name '*.json' -not -path './node_modules/*'`, "find . -name '*.json' (a real glob, no -exec/-delete)");
  assertAllowed(`find docs -name '*.md'`, "find docs -name '*.md'");
  assertBlocked(`find docs -name '*.md' -delete`, "find docs -name '*.md' -delete");
  assertBlocked(`find docs -name '*.md' -exec rm {} \\;`, "find docs ... -exec rm");
  assertBlocked(`find docs -name '*.md' -execdir rm {} \\;`, "find docs ... -execdir");
  assertBlocked(`find docs -name '*.md' -fprint /tmp/out`, "find docs ... -fprint");
});

test("round-7 B4: unresolved-variable false positives on ordinary agent commands are all allowed", () => {
  assertAllowed(`gh pr comment 1354 --body "$BODY"`, 'gh pr comment --body "$BODY"');
  assertAllowed(`gh pr view $N`, "gh pr view $N");
  assertAllowed(`git -C "$WT" status`, 'git -C "$WT" status');
  assertAllowed(`echo $PATH`, "echo $PATH");
  assertAllowed(`echo "$HOME"`, 'echo "$HOME"');
  assertAllowed(`rm -rf "$TMPDIR/foo"`, 'rm -rf "$TMPDIR/foo"');
  assertAllowed(`for f in packages/*; do echo $f; done`, "for f in packages/*; do echo $f; done");
});

test("round-7 B4: the for-loop binding still catches a loop that DOES iterate a protected name", () => {
  assertBlocked(`for f in docs/HITL-RULE.md other.txt; do rm $f; done`, "a loop whose list includes the protected file itself");
});

test("round-7: unresolved variables remain risky for genuinely write-sensitive verbs", () => {
  assertBlocked("rm $F", "rm $F (F never assigned) still blocks -- rm is write-sensitive");
  assertBlocked("sed -i s/a/b/ ${TARGET}", "sed -i ${TARGET} still blocks -- sed is write-sensitive");
  assertBlocked(`F=${RULE}; rm $F`, "a KNOWN variable resolving to the protected path still blocks");
});

test("round-7: an unresolved variable that is clearly a DIRECTORY (trailing slash) or has a non-matching concrete basename stays allowed even for a write-sensitive verb", () => {
  assertAllowed("mkdir -p $OUT && cp a $OUT/", "cp a $OUT/ (trailing slash -- a directory, not a specific filename)");
  assertAllowed('rm -f "$S/unrelated.txt"', '"$S/unrelated.txt" (concrete basename does not match)');
});

test("round-7: git global flags (-C, -c) are stripped before reading the real subcommand", () => {
  assertAllowed(`git -C /tmp/other status`, "git -C /tmp/other status");
  assertAllowed(`git -C /tmp/other log -- ${RULE}`, "git -C /tmp/other log -- <rule> (still read-only)");
  assertBlocked(`git -C /tmp/other rm ${RULE}`, "git -C /tmp/other rm <rule> (still blocked)");
});

test("round-7 fix: the is-run-directly guard never fails open for a copy install with a space in its path, or a symlink to the script", () => {
  // #1187 escalation-rule round 7, strong-class reviewer, non-blocking:
  // an earlier guard compared `import.meta.url` against a raw
  // `file://${process.argv[1]}` string, which was FALSE (so the hook's
  // stdin-driven protocol never even started, exiting 0 unconditionally
  // with NO check at all) both for a copy in a directory with a space in
  // its name and for a symlink to the real script -- exactly the two
  // "copy this file" and "symlink it" install variations an owner might
  // reasonably try.
  const dir = mkdtempSync(join(tmpdir(), "deny-tier2 with spaces-"));
  try {
    const copyPath = join(dir, "deny-tier2.mjs");
    copyFileSync(scriptPath, copyPath);
    const copyResult = spawnSync(process.execPath, [copyPath], {
      input: JSON.stringify({ tool_input: { command: "git push --force origin main" } }),
      encoding: "utf8",
    });
    assert.equal(copyResult.status, 2, "a copy in a space-containing directory must still block");

    const symlinkPath = join(dir, "deny-tier2-symlink.mjs");
    symlinkSync(scriptPath, symlinkPath);
    const symlinkResult = spawnSync(process.execPath, [symlinkPath], {
      input: JSON.stringify({ tool_input: { command: "git push --force origin main" } }),
      encoding: "utf8",
    });
    assert.equal(symlinkResult.status, 2, "a symlink to the script must still block");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
