import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HOOK_CHECKS, PENDING_HOOK_CHECKS, delta, normalize, pushedRefs, ratchet, report } from "./pre-push-ratchet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const write = (root, files) => {
  for (const [path, contents] of Object.entries(files)) {
    if (contents === null) { rmSync(join(root, path), { force: true }); continue; }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
};
const commit = (root, files, message) => { write(root, files); git(root, "add", "-A"); git(root, "commit", "-q", "-m", message); return git(root, "rev-parse", "HEAD"); };

const words = { quote: "a rule in the owner's words", date: "2026-11-03" };
/** The probe sub-check: one finding line per line of data/violations.txt under --root (default: the package). */
const probe = `import { existsSync, readFileSync } from "node:fs"; import { join } from "node:path";
const at = process.argv.indexOf("--root"); const root = at > 0 ? process.argv[at + 1] : process.cwd();
const file = join(root, "data/violations.txt");
const lines = existsSync(file) ? readFileSync(file, "utf8").split("\\n").filter(Boolean) : [];
for (const line of lines) console.log("VIOLATION " + line);
console.log(lines.length + " violation(s) in 12ms");
process.exit(lines.length ? 1 : 0);
`;
const enforced = { id: "R-PROBE", owner_words: words, status: "enforced", checks: ["check:studio#fixture probe"], fixture: "scripts/rules/fixtures/R-PROBE",
  fixture_runs: [{ check: "check:studio#fixture probe", cwd: "packages/producer", run: "node scripts/probe.mjs --root {fixture}", expect: "^VIOLATION planted" }] };
const exemptions = [{ check: ".#check:rules", reason: "the meta-check itself" }];
const registry = (rules, more = []) => ({ schema: "foundry.rule-registry/1", rules, exemptions: [...exemptions, ...more] });
const manifest = checks => ({ checks: [{ id: "fixture probe", kind: "static", cwd: "packages/producer", run: "node scripts/probe.mjs" }, ...checks] });

/** A repository with the real check:rules and orphan graph, one probe sub-check and two lines of existing debt. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), "pre-push-ratchet-test-"));
  git(root, "init", "-q");
  const base = commit(root, {
    "package.json": { name: "fixture", private: true, workspaces: ["packages/*"], scripts: { check: "node scripts/run-check-steps.mjs check:rules check:studio --workspace=packages/producer", "check:rules": "node scripts/check-rules.mjs" } },
    "scripts/check-rules.mjs": readFileSync(join(here, "check-rules.mjs"), "utf8"),
    "scripts/check-orphan-checks.mjs": readFileSync(join(here, "check-orphan-checks.mjs"), "utf8"),
    "scripts/run-check-steps.mjs": readFileSync(join(here, "run-check-steps.mjs"), "utf8"),
    "scripts/rules/registry.json": registry([enforced]),
    "scripts/rules/fixtures/R-PROBE/data/violations.txt": "planted\n",
    "packages/producer/package.json": { name: "@fixture/producer", private: true, scripts: { "check:studio": "node scripts/check-studio.mjs" } },
    "packages/producer/scripts/check-studio.mjs": "// stub runner: the ratchet runs sub-checks itself\n",
    "packages/producer/scripts/check-studio.json": manifest([]),
    "packages/producer/scripts/probe.mjs": probe,
    "packages/producer/data/violations.txt": "old one\nold two\n",
  }, "base with existing debt");
  return { root, base };
}
const run = (root, base, head) => ratchet({ cwd: root, base, head, ids: ["fixture probe"] });

test("unchanged existing debt passes; fixing debt passes", async () => {
  const { root, base } = repository();
  const same = commit(root, { "packages/producer/README.md": "no change to debt\n" }, "unrelated");
  const unchanged = await run(root, base, same);
  assert.equal(unchanged.delta.block, false, report(unchanged));
  assert.deepEqual(unchanged.delta.checks.map(check => check.state), ["unchanged-red"]);
  assert.equal(unchanged.delta.rules.unchanged, 0);
  const fixed = commit(root, { "packages/producer/data/violations.txt": "old one\n" }, "fix one");
  const less = await run(root, base, fixed);
  assert.equal(less.delta.block, false, report(less));
  const clean = commit(root, { "packages/producer/data/violations.txt": null }, "fix all");
  const all = await run(root, base, clean);
  assert.equal(all.delta.block, false, report(all));
  assert.deepEqual(all.delta.checks.map(check => check.state), ["fixed"]);
  assert.match(report(all), /^fixed\s+fixture probe: base exit 1, head exit 0$/m);
});

test("a new violation blocks, inside existing debt or on a green check, and the delta names it", async () => {
  const { root, base } = repository();
  const more = commit(root, { "packages/producer/data/violations.txt": "old one\nold two\nnew three\n" }, "add debt");
  const result = await run(root, base, more);
  assert.equal(result.delta.block, true);
  assert.equal(result.delta.checks[0].state, "new-lines");
  assert.deepEqual(result.delta.checks[0].lines, ["VIOLATION new three"]);
  assert.match(report(result), /NEW VIOLATION new three[\s\S]*BLOCKED/);
  const green = commit(root, { "packages/producer/data/violations.txt": null }, "clean");
  const red = commit(root, { "packages/producer/data/violations.txt": "fresh\n" }, "regress");
  const regressed = await run(root, green, red);
  assert.equal(regressed.delta.block, true);
  assert.equal(regressed.delta.checks[0].state, "new-red");
});

test("a new failing rule or unmapped sub-check blocks; a weakened check blocks even though the base reads the same", async () => {
  const { root, base } = repository();
  const open = commit(root, { "scripts/rules/registry.json": registry([enforced, { id: "R-OPEN", owner_words: words, status: "unenforced", note: "no check yet" }]) }, "new unenforced rule");
  const rule = await run(root, base, open);
  assert.equal(rule.delta.block, true);
  assert.deepEqual(rule.delta.rules.new.map(finding => `${finding.rule} ${finding.id}`), ["unenforced R-OPEN"]);
  const unmapped = commit(root, { "packages/producer/scripts/check-studio.json": manifest([{ id: "fixture extra", kind: "static", cwd: "packages/producer", run: "node scripts/probe.mjs" }]) }, "new sub-check");
  const sub = await run(root, open, unmapped);
  assert.deepEqual(sub.delta.rules.new.map(finding => `${finding.rule} ${finding.id}`), ["unmapped check:studio#fixture extra"]);
  assert.equal(sub.delta.block, true);
  const weak = commit(root, { "packages/producer/scripts/probe.mjs": probe.replace("process.exit(lines.length ? 1 : 0);", "process.exit(0);") }, "weaken the check");
  const weakened = await run(root, unmapped, weak);
  assert.equal(weakened.delta.block, true, report(weakened));
  assert.deepEqual(weakened.delta.rules.new, [], "the weakened check reads the same on the base: only the integrity finding blocks");
  assert.deepEqual(weakened.delta.rules.integrity.map(finding => `${finding.rule} ${finding.id}`), ["fixture-passed R-PROBE"]);
  assert.ok(weakened.overlaid.includes("packages/producer/scripts/probe.mjs"), "the base is measured with the head's check");
});

test("a base without a rule registry fails closed", async () => {
  const { root, base } = repository();
  const bare = commit(root, { "scripts/rules/registry.json": null }, "drop the registry");
  await assert.rejects(run(root, bare, base), /check:rules could not run on the base/);
});

test("a sub-check that cannot load gitignored build output fails closed on the head (gate F4)", async () => {
  const { root } = repository();
  const distProbe = 'import { answer } from "../dist/lib.mjs";\nconsole.log(answer);\n';
  const base = commit(root, {
    "packages/producer/scripts/dist-probe.mjs": distProbe,
    "packages/producer/scripts/check-studio.json": manifest([{ id: "fixture dist", kind: "static", cwd: "packages/producer", run: "node scripts/dist-probe.mjs" }]),
    "scripts/rules/registry.json": registry([enforced], [{ check: "check:studio#fixture dist", reason: "a probe sub-check that reads dist/" }]),
  }, "a sub-check that reads dist/");
  const head = commit(root, { "packages/producer/README.md": "unrelated\n" }, "unrelated");
  const result = await ratchet({ cwd: root, base, head, ids: ["fixture dist"] });
  assert.equal(result.delta.checks[0].state, "setup-error", report(result));
  assert.equal(result.delta.block, true, "red on both sides because dist/ is absent is not unchanged debt");
  assert.match(report(result), /LOAD .*(?:ERR_MODULE_NOT_FOUND|Cannot find module)/);
});

test("the pre-push hook measures every pushed ref, not HEAD, and skips deletes (gate F3)", () => {
  const { root } = repository();
  write(root, {
    "scripts/githooks/pre-push": readFileSync(join(here, "githooks/pre-push"), "utf8"),
    "scripts/pre-push-ratchet.mjs": readFileSync(join(here, "pre-push-ratchet.mjs"), "utf8"),
    "scripts/accept-unit.mjs": readFileSync(join(here, "accept-unit.mjs"), "utf8"),
  });
  chmodSync(join(root, "scripts/githooks/pre-push"), 0o755);
  // The hook runs the default HOOK_CHECKS ids; each is the probe here.
  commit(root, { "packages/producer/scripts/check-studio.json": manifest(HOOK_CHECKS.map(id => ({ id, kind: "static", cwd: "packages/producer", run: "node scripts/probe.mjs" }))) }, "the hook");
  const main = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const remote = mkdtempSync(join(tmpdir(), "pre-push-ratchet-remote-"));
  git(remote, "init", "-q", "--bare");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", `${main}:refs/heads/main`);
  git(root, "fetch", "-q", "origin");
  git(root, "config", "core.hooksPath", "scripts/githooks");
  git(root, "checkout", "-q", "-b", "debt");
  commit(root, { "packages/producer/data/violations.txt": "old one\nold two\nnew three\n" }, "add debt");
  git(root, "checkout", "-q", main);
  // HEAD is the clean main; the pushed branch carries the new violation and must be the one measured.
  let refused;
  try { git(root, "push", "-q", "origin", "debt"); } catch (error) { refused = `${error.stdout ?? ""}${error.stderr ?? ""}`; }
  assert.ok(refused !== undefined, "pushing a branch other than HEAD that adds debt is refused");
  assert.match(refused, /refs\/heads\/debt -> refs\/heads\/debt[\s\S]*NEW VIOLATION new three[\s\S]*BLOCKED/);
  assert.equal(git(remote, "branch", "--list", "debt"), "");
  git(root, "push", "-q", "origin", `${main}:refs/heads/gone`);
  git(root, "push", "-q", "origin", ":refs/heads/gone");
  assert.equal(git(remote, "branch", "--list", "gone"), "");
});

test("the hook runs the route, ds-only and copy-source checks; only a pending id may be absent, and its skip is reported", async () => {
  for (const id of ["producer check:routes-published", "producer check:studio-routes", "producer check:route-parity", "producer src/studio/designer-views.ds-only.test.ts", "producer check:copy-source"]) assert.ok(HOOK_CHECKS.includes(id), id);
  assert.deepEqual(PENDING_HOOK_CHECKS, ["producer check:copy-source"]);
  const { root, base } = repository();
  const head = commit(root, { "packages/producer/README.md": "unrelated\n" }, "unrelated");
  const result = await ratchet({ cwd: root, base, head, ids: ["fixture probe", "producer check:copy-source"] });
  assert.deepEqual(result.skipped, ["producer check:copy-source"]);
  assert.deepEqual(result.delta.checks.map(check => check.id), ["fixture probe"]);
  assert.match(report(result), /^skipped\s+producer check:copy-source: not in the head's check:studio manifest yet$/m);
  await assert.rejects(ratchet({ cwd: root, base, head, ids: ["fixture probe", "producer check:route-parity"] }), /no check:studio sub-check "producer check:route-parity" at head/);
  // Once the head lists it, the pending id runs like any other hook check.
  const listed = commit(root, { "packages/producer/scripts/check-studio.json": manifest([{ id: "producer check:copy-source", kind: "static", cwd: "packages/producer", run: "node scripts/probe.mjs" }]) }, "wire copy-source");
  const wired = await ratchet({ cwd: root, base, head: listed, ids: ["producer check:copy-source"] });
  assert.deepEqual(wired.skipped, []);
  assert.deepEqual(wired.delta.checks.map(check => check.id), ["producer check:copy-source"]);
});

test("pushedRefs reads git's pre-push lines, drops deletes and refuses unreadable input", () => {
  const a = "a".repeat(40), z = "0".repeat(40);
  assert.deepEqual(pushedRefs(`refs/heads/x ${a} refs/heads/x ${z}\n(delete) ${z} refs/heads/y ${a}\n`), [{ localRef: "refs/heads/x", localSha: a, remoteRef: "refs/heads/x", remoteSha: z }]);
  assert.deepEqual(pushedRefs(""), []);
  assert.throws(() => pushedRefs("garbage line"), /unreadable pre-push line/);
});

test("delta counts findings per key and normalizes tree paths and timings", () => {
  const f = (rule, id) => ({ rule, id, message: "m" });
  const verdict = delta(
    { rules: [f("unenforced", "R-A"), f("unmapped", "x")], checks: [{ id: "c", exit: 1, lines: ["VIOLATION a"] }] },
    { rules: [f("unenforced", "R-A"), f("unenforced", "R-B")], checks: [{ id: "c", exit: 1, lines: ["VIOLATION a"] }] },
  );
  assert.deepEqual(verdict.rules.new.map(finding => finding.id), ["R-B"]);
  assert.deepEqual(verdict.rules.fixed, ["unmapped x"]);
  assert.equal(verdict.rules.unchanged, 1);
  assert.equal(verdict.block, true);
  assert.deepEqual(normalize("/tmp/t/base/a.json in 3.2s\n\n", "/tmp/t/base"), ["<root>/a.json in <t>"]);
});
