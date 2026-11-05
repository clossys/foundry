import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { ruleFindings, shapeFindings } from "./check-rules.mjs";

/** A throwaway repository: { "path": "contents" }; objects are written as JSON. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "check-rules-test-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return root;
}
const words = { quote: "a rule in the owner's words", date: "2026-11-03" };
const probe = `import { existsSync } from "node:fs"; import { join } from "node:path";
const root = process.argv[process.argv.indexOf("--root") + 1];
if (existsSync(join(root, "bad.txt"))) { console.log("bad found"); process.exit(1); }
console.log("clean");`;
const run = (check, script, extra = {}) => ({ check, cwd: ".", run: `node scripts/${script} --root {fixture}`, expect: "^bad found", ...extra });
const kinds = result => result.findings.map(finding => `${finding.rule} ${finding.id}`).sort();

function repository(rules, exemptions = [{ check: ".#check:rules", reason: "the meta-check itself, enforced by its own fixture elsewhere" }]) {
  return tree({
    "package.json": { name: "fixture", private: true, scripts: { check: "npm run check:a && npm run check:rules", "check:a": "node scripts/check-a.mjs --root .", "check:b": "node scripts/check-b.mjs --root .", "check:rules": "node -e 0" } },
    "scripts/check-a.mjs": probe,
    "scripts/check-b.mjs": probe,
    "scripts/rules/fixtures/bad/bad.txt": "violation\n",
    "scripts/rules/fixtures/clean/ok.txt": "fine\n",
    "scripts/rules/registry.json": { schema: "foundry.rule-registry/1", rules, exemptions },
  });
}

test("shape: ids, owner words, status and the note an unenforced rule needs", () => {
  const found = shapeFindings({ rules: [
    { id: "bad id", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "f" },
    { id: "R-NO-DATE", owner_words: { quote: "q", date: "Nov 3" }, status: "unenforced", note: "missing" },
    { id: "R-NO-NOTE", owner_words: words, status: "unenforced" },
    { id: "R-NO-FIXTURE", owner_words: words, status: "enforced", checks: [".#check:a"] },
    { id: "R-NO-WIRE", owner_words: words, status: "pending-wire", note: "no branch named", pending_wire: { check: "check:x" } },
    { id: "R-BAD-RUN", owner_words: words, status: "unenforced", note: "n", fixture_runs: [{ check: ".#check:a", cwd: ".", run: "x", expect: "(" }] },
  ] }).map(finding => finding.id);
  assert.deepEqual(found, ["bad id", "R-NO-DATE", "R-NO-NOTE", "R-NO-FIXTURE", "R-NO-WIRE", "R-BAD-RUN"]);
  assert.deepEqual(shapeFindings({}).map(finding => finding.rule), ["shape"]);
});

test("an enforced rule whose check fails on its fixture holds; unenforced, passing, unwired and unrelated rules fail", async () => {
  const root = repository([
    { id: "R-HOLDS", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-a.mjs")] },
    { id: "R-PASSES", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/clean", fixture_runs: [run(".#check:a", "check-a.mjs")] },
    { id: "R-UNWIRED", owner_words: words, status: "enforced", checks: [".#check:b"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:b", "check-b.mjs")] },
    { id: "R-UNRELATED", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-b.mjs")] },
    { id: "R-SILENT", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-a.mjs", { expect: "^a different finding" })] },
    { id: "R-OPEN", owner_words: words, status: "unenforced", note: "a check that fails on its fixture does not lift unenforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-a.mjs")] },
    { id: "R-UNKNOWN", owner_words: words, status: "unenforced", note: "names a missing script", related: [".#check:missing"] },
    { id: "R-PENDING", owner_words: words, status: "pending-wire", note: "built elsewhere", pending_wire: { check: "check:later", branch: "claude/later" } },
    { id: "R-LANDED", owner_words: words, status: "pending-wire", note: "landed, not wired", pending_wire: { check: "check:b", branch: "claude/b" } },
  ]);
  const result = await ruleFindings(root);
  assert.deepEqual(kinds(result), ["fixture-not-detected R-SILENT", "fixture-passed R-PASSES", "fixture-unrelated R-UNRELATED", "unenforced R-OPEN", "unenforced R-UNKNOWN", "unknown-check R-UNKNOWN", "unreachable R-UNWIRED", "unwired R-LANDED", "unwired R-PENDING"]);
  assert.match(result.findings.find(finding => finding.id === "R-PENDING").message, /check:later is pending wire from claude\/later; it is not on this branch yet/);
  assert.match(result.findings.find(finding => finding.id === "R-LANDED").message, /it now exists in \.: list it in checks/);
  assert.equal(result.enforced, 2, "R-HOLDS and R-UNWIRED fail on their fixtures; R-UNWIRED is still reported unreachable");
});

test("a check after check:rules in an && chain is unreachable while check:rules has findings; the aggregate reaches it (gate F6)", async () => {
  const rows = [
    { id: "R-HOLDS", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-a.mjs")] },
    { id: "R-OPEN", owner_words: words, status: "unenforced", note: "an open rule: check:rules exits 1" },
  ];
  const root = repository(rows);
  const manifest = (check, at = root) => writeFileSync(join(at, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { check, "check:a": "node scripts/check-a.mjs --root .", "check:rules": "node -e 0" } }));
  manifest("npm run check:rules && npm run check:a");
  const chained = await ruleFindings(root);
  assert.deepEqual(kinds(chained), ["unenforced R-OPEN", "unreachable R-HOLDS"]);
  assert.match(chained.findings.find(finding => finding.rule === "unreachable").message, /runs only after check:rules in an && chain/);
  manifest("node scripts/run-check-steps.mjs check:rules check:a");
  assert.deepEqual(kinds(await ruleFindings(root)), ["unenforced R-OPEN"]);
  // With no other finding, check:rules can pass, so a step after it is reached.
  const held = repository(rows.slice(0, 1));
  manifest("npm run check:rules && npm run check:a", held);
  assert.deepEqual(kinds(await ruleFindings(held)), []);
});

test("a meta-check no rule lists is unmapped unless exempt with a reason; stale and empty exemptions fail", async () => {
  const held = [{ id: "R-HOLDS", owner_words: words, status: "enforced", checks: [".#check:a"], fixture: "scripts/rules/fixtures/bad", fixture_runs: [run(".#check:a", "check-a.mjs")] }];
  assert.deepEqual(kinds(await ruleFindings(repository(held, []))), ["unmapped .#check:rules"]);
  assert.deepEqual(kinds(await ruleFindings(repository(held))), []);
  assert.deepEqual(kinds(await ruleFindings(repository(held, [{ check: ".#check:rules", reason: "" }, { check: ".#check:gone", reason: "a reason that names nothing governed" }]))),
    ["exemption-reason .#check:rules", "exemption-stale .#check:gone"]);
});
