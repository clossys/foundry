import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

import { STALE_AFTER_MS, WORK_MARKER, acceptUnit, cleanStale, diskUsage, distCommand, loosening, pruneCache, removeWork } from "./accept-unit.mjs";

/** Every fixture folder a test makes is removed when the file's tests end. */
const made = [];
const scratch = prefix => { const dir = mkdtempSync(join(tmpdir(), prefix)); made.push(dir); return dir; };
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const write = (root, files) => {
  for (const [path, contents] of Object.entries(files)) {
    if (contents === null) { rmSync(join(root, path), { force: true }); continue; }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
};
const commit = (root, files, message) => { write(root, files); git(root, "add", "-A"); git(root, "commit", "-q", "-m", message); return git(root, "rev-parse", "HEAD"); };

/** before: no check; broken: the check exists and fails; fixed: the unit makes it pass. */
function history() {
  const root = scratch("accept-unit-test-");
  git(root, "init", "-q");
  const pkg = scripts => ({ name: "@fixture/producer", private: true, scripts });
  const before = commit(root, { "package.json": { name: "fixture", private: true, workspaces: ["packages/*"] }, "packages/producer/package.json": pkg({}) }, "before");
  const check = `import { existsSync } from "node:fs";\nif (!existsSync(new URL("../fixed.txt", import.meta.url))) { console.log("FAIL not fixed"); process.exit(1); }\nconsole.log("ok");\n`;
  const broken = commit(root, { "packages/producer/package.json": pkg({ "check:fixed": "node scripts/check-fixed.mjs" }), "packages/producer/scripts/check-fixed.mjs": check }, "broken");
  const fixed = commit(root, { "packages/producer/fixed.txt": "yes\n" }, "fixed");
  return { root, before, broken, fixed };
}

test("PASS when the check fails on the base and passes on the head; FAIL the other way round", async () => {
  const { root, broken, fixed } = history();
  const pass = await acceptUnit({ base: broken, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(pass.pass, true, pass.line);
  assert.match(pass.line, /^PASS packages\/producer#check:fixed: base \w{9} exit 1 \(want 1\), head \w{9} exit 0 \(want 0\); base measured with the head check \(1 file\(s\) overlaid\); trees removed \(--keep keeps them\)$/);
  assert.deepEqual(pass.overlaid, ["packages/producer/scripts/check-fixed.mjs"], "the base is always measured with the head's check");
  const fail = await acceptUnit({ base: fixed, head: broken, check: "packages/producer#check:fixed", cwd: root });
  assert.equal(fail.pass, false);
  assert.match(fail.line, /^FAIL .* base \w{9} exit 0 .* head \w{9} exit 1 /);
  const same = await acceptUnit({ base: fixed, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(same.pass, false, "a check that already passes on the base proves nothing");
});

test("a base without the check is measured with the head's check files and script", async () => {
  const { root, before, fixed } = history();
  const result = await acceptUnit({ base: before, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(result.pass, true, result.line);
  assert.deepEqual(result.overlaid, ["packages/producer/scripts/check-fixed.mjs"]);
  assert.match(result.line, /base measured with the head check \(1 file\(s\) overlaid\)/);
});

test("a head that weakens its own check does not PASS: the base is measured with the head's check (gate F5)", async () => {
  const { root, broken } = history();
  const weak = commit(root, { "packages/producer/scripts/check-fixed.mjs": "console.log(\"ok\");\nprocess.exit(0);\n" }, "weaken the check");
  const result = await acceptUnit({ base: broken, head: weak, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.equal(result.baseExit, 0, "the base ran the head's weakened check");
  assert.match(result.line, /^FAIL .*base measured with the head check \(1 file\(s\) overlaid\)/);
});

test("a base that cannot load the check is not a failing base (gate F4)", async () => {
  const { root, broken } = history();
  // The check reaches gitignored build output (here an unresolvable package) only on the unfixed path.
  const check = `import { existsSync } from "node:fs";\nif (!existsSync(new URL("../fixed.txt", import.meta.url))) { await import("@fixture/missing-dist"); process.exit(1); }\nconsole.log("ok");\n`;
  const head = commit(root, { "packages/producer/scripts/check-fixed.mjs": check, "packages/producer/fixed.txt": "yes\n" }, "check loads build output");
  const result = await acceptUnit({ base: broken, head, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.notEqual(result.baseExit, 0);
  assert.match(result.load.base, /ERR_MODULE_NOT_FOUND|Cannot find package/);
  assert.match(result.line, /the base could not load the check/);
});

test("unknown revisions and scripts are setup errors, not verdicts", async () => {
  const { root, broken, fixed } = history();
  await assert.rejects(acceptUnit({ base: "no-such-rev", head: fixed, check: "check:fixed", cwd: root }), /unknown revision/);
  await assert.rejects(acceptUnit({ base: broken, head: fixed, check: "check:none", cwd: root }), /no package.json at head defines check:none/);
});

/** A two-workspace repository: @fixture/lib (linked into node_modules as an install would) and a producer check that imports it. */
function workspace(lib, { build } = {}) {
  const root = scratch("accept-unit-test-");
  git(root, "init", "-q");
  const check = 'import { state } from "@fixture/lib";\nconsole.log("lib says " + state);\nprocess.exit(state === "fixed" ? 0 : 1);\n';
  const libManifest = build
    ? { name: "@fixture/lib", private: true, type: "module", main: "dist/index.mjs", scripts: { build: "node build.mjs" } }
    : { name: "@fixture/lib", private: true, type: "module", main: "src/index.mjs" };
  const files = {
    ".gitignore": "node_modules/\ndist/\n",
    "package.json": { name: "fixture", private: true, workspaces: ["packages/*"] },
    "packages/lib/package.json": libManifest,
    "packages/lib/src/index.mjs": `export const state = ${JSON.stringify(lib)};\n`,
    "packages/producer/package.json": { name: "@fixture/producer", private: true, type: "module", dependencies: { "@fixture/lib": "*" }, scripts: { "check:lib": "node scripts/check-lib.mjs" } },
    "packages/producer/scripts/check-lib.mjs": check,
  };
  if (build) files["packages/lib/build.mjs"] = build;
  const base = commit(root, files, "base");
  mkdirSync(join(root, "node_modules/@fixture"), { recursive: true });
  symlinkSync("../../packages/lib", join(root, "node_modules/@fixture/lib"), "dir");
  return { root, base };
}
const copyBuild = 'import { copyFileSync, mkdirSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\ncopyFileSync("src/index.mjs", "dist/index.mjs");\n';

test("B3: a workspace link resolves to the tree's own package, so the base runs the base's package code", async () => {
  const { root, base } = workspace("broken");
  const head = commit(root, { "packages/lib/src/index.mjs": 'export const state = "fixed";\n' }, "fix the lib");
  // The checkout is at the head: a link into the checkout would give the base the head's fixed lib.
  const result = await acceptUnit({ base, head, check: "check:lib", cwd: root });
  assert.equal(result.pass, true, result.line);
  assert.equal(result.baseExit, 1, "the base measured its own broken lib");
});

test("B2: each tree is a git work tree of its commit, so a check that asks git sees that commit", async () => {
  const { root } = history();
  const tracked = commit(root, { "packages/producer/fixed.txt": null, "packages/producer/package.json": { name: "@fixture/producer", private: true, scripts: { "check:fixed": "node scripts/check-fixed.mjs", "check:tracked": "git ls-files --error-unmatch fixed.txt" } } }, "a check that asks git");
  const head = commit(root, { "packages/producer/fixed.txt": "yes\n" }, "track it");
  const result = await acceptUnit({ base: tracked, head, check: "check:tracked", cwd: root });
  assert.equal(result.pass, true, result.line);
  assert.equal(result.baseExit, 1, "git answered on the base: fixed.txt is not tracked there");
});

test("each tree builds the dist/ its check loads from its own sources; the same tree is restored from the cache", async () => {
  const { root, base } = workspace("broken", { build: copyBuild });
  const head = commit(root, { "packages/lib/src/index.mjs": 'export const state = "fixed";\n' }, "fix the lib");
  const cache = scratch("accept-unit-cache-");
  const first = await acceptUnit({ base, head, check: "check:lib", cwd: root, cache, keep: true });
  assert.equal(first.pass, true, first.line);
  assert.deepEqual([first.builds.base.built, first.builds.head.built], [["packages/lib"], ["packages/lib"]]);
  assert.equal(existsSync(join(first.work, "base/packages/lib/dist/index.mjs")), true);
  removeWork(first.work);
  const again = await acceptUnit({ base, head, check: "check:lib", cwd: root, cache });
  assert.equal(again.pass, true, again.line);
  assert.deepEqual([again.builds.base.cached, again.builds.head.cached, again.builds.base.built], [["packages/lib"], ["packages/lib"], []]);
});

test("a build that fails, or that rewrites a tracked file, is FAIL: nothing was measured", async () => {
  const { root, base } = workspace("broken", { build: copyBuild });
  const cache = scratch("accept-unit-cache-");
  const failing = commit(root, { "packages/lib/src/index.mjs": 'export const state = "fixed";\n', "packages/lib/build.mjs": 'console.error("tsc: error TS2322 planted");\nprocess.exit(3);\n' }, "break the build");
  const failed = await acceptUnit({ base, head: failing, check: "check:lib", cwd: root, cache });
  assert.equal(failed.pass, false);
  assert.match(failed.line, /^FAIL packages\/producer#check:lib: not measured, .*the head build of packages\/lib failed \(exit 3: node build\.mjs\): tsc: error TS2322 planted/);
  const rewriting = commit(root, { "packages/lib/build.mjs": `${copyBuild}import { writeFileSync } from "node:fs";\nwriteFileSync("src/index.mjs", "export const state = 1;\\n");\n` }, "a build that rewrites a source");
  const rewrote = await acceptUnit({ base, head: rewriting, check: "check:lib", cwd: root, cache });
  assert.equal(rewrote.pass, false);
  assert.match(rewrote.line, /the head build of packages\/lib failed .*the build rewrote tracked file packages\/lib\/src\/index\.mjs/);
});

test("distCommand keeps a build script up to its last tsc step", () => {
  assert.equal(distCommand("tsc -p tsconfig.build.json && node scripts/copy.mjs && npx tsc -p types && node scripts/generate.mjs && node scripts/check.mjs"), "tsc -p tsconfig.build.json && node scripts/copy.mjs && npx tsc -p types");
  assert.equal(distCommand("vite build"), "vite build");
  assert.equal(distCommand("tsc -p . || true"), "tsc -p . || true");
});

test("G5: a base that exits 2 (a usage or read error) is not a failing base", async () => {
  const { root } = history();
  const usage = commit(root, { "packages/producer/fixed.txt": null, "packages/producer/scripts/check-fixed.mjs": 'import { existsSync } from "node:fs";\nif (!existsSync(new URL("../fixed.txt", import.meta.url))) { console.error("usage: check-fixed"); process.exit(2); }\n' }, "exit 2 when unfixed");
  const head = commit(root, { "packages/producer/fixed.txt": "yes\n" }, "fix");
  const result = await acceptUnit({ base: usage, head, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.equal(result.baseExit, 2);
  assert.match(result.line, /the base exit 2 is a usage, read or run error, not a finding/);
});

test("G4: a head that adds an entry to the check's allowlist is FAIL as loosened, not fixed", async () => {
  const { root } = history();
  const check = 'import { existsSync, readFileSync } from "node:fs";\nconst allowed = JSON.parse(readFileSync(new URL("./check-fixed.allowlist.json", import.meta.url), "utf8"));\nif (!existsSync(new URL("../fixed.txt", import.meta.url)) && !allowed.includes("fixed.txt")) { console.log("FAIL not fixed"); process.exit(1); }\n';
  const base = commit(root, { "packages/producer/fixed.txt": null, "packages/producer/scripts/check-fixed.mjs": check, "packages/producer/scripts/check-fixed.allowlist.json": [] }, "a check with an allowlist");
  const allow = commit(root, { "packages/producer/scripts/check-fixed.allowlist.json": ["fixed.txt"] }, "allowlist it instead of fixing it");
  const result = await acceptUnit({ base, head: allow, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.deepEqual(result.loosened, ['packages/producer/scripts/check-fixed.allowlist.json: adds [] "fixed.txt"']);
  assert.match(result.line, /^FAIL packages\/producer#check:fixed: loosened/);
  assert.ok(result.overlaid.includes("packages/producer/scripts/check-fixed.allowlist.json"), "the base is measured with the head's policy data");
  const fixedHead = commit(root, { "packages/producer/scripts/check-fixed.allowlist.json": [], "packages/producer/fixed.txt": "yes\n" }, "fix it for real");
  const real = await acceptUnit({ base, head: fixedHead, check: "check:fixed", cwd: root });
  assert.equal(real.pass, true, real.line);
});

test("G4: loosening reads a removed, unenforced or thinned registry rule and an added exemption", () => {
  const tree = rules => { const root = scratch("accept-unit-registry-"); write(root, { "scripts/rules/registry.json": rules }); return root; };
  const row = (id, status, checks, runs = checks) => ({ id, status, checks, fixture_runs: runs.map(check => ({ check, run: "x" })), note: "prose" });
  const base = tree({ rules: [row("R-A", "enforced", ["a#x", "a#y"]), row("R-B", "unenforced", []), row("R-C", "enforced", ["c#x"])], exemptions: [{ check: ".#check:rules", reason: "meta" }] });
  const head = tree({ rules: [row("R-A", "enforced", ["a#x"], ["a#x"]), row("R-C", "pending-wire", ["c#x"])], exemptions: [{ check: ".#check:rules", reason: "reworded" }, { check: "p#z", reason: "new" }] });
  assert.deepEqual(loosening(base, head, ["scripts/rules/registry.json"]), [
    "scripts/rules/registry.json: R-A drops check a#y",
    "scripts/rules/registry.json: R-A drops a fixture run of a#y",
    "scripts/rules/registry.json: removes rule R-B",
    "scripts/rules/registry.json: R-C goes from enforced to pending-wire",
    'scripts/rules/registry.json: adds exemption {"check":"p#z"}',
  ]);
  assert.deepEqual(loosening(head, base, ["scripts/rules/registry.json"]), [], "tightening loosens nothing; a reworded reason is prose");
});

test("the work folder (trees, node_modules clones, dist/, logs) is removed after a PASS, a FAIL and an error; keep keeps it", async () => {
  const { root: repo, broken, fixed } = history();
  const root = scratch("accept-unit-work-");
  const passed = await acceptUnit({ base: broken, head: fixed, check: "check:fixed", cwd: repo, root });
  assert.equal(passed.pass, true, passed.line);
  assert.equal(passed.kept, false);
  assert.match(passed.line, /; trees removed \(--keep keeps them\)$/);
  assert.deepEqual(readdirSync(root), [], "nothing is left after a PASS");
  const failed = await acceptUnit({ base: fixed, head: broken, check: "check:fixed", cwd: repo, root });
  assert.equal(failed.pass, false, failed.line);
  assert.deepEqual(readdirSync(root), [], "nothing is left after a FAIL");
  assert.ok(failed.logs["head.log"].some(line => line.includes("FAIL not fixed")), "the failing log's tail is carried in the result");
  await assert.rejects(acceptUnit({ base: broken, head: fixed, check: "check:none", cwd: repo, root }));
  assert.deepEqual(readdirSync(root), [], "nothing is left after an error");
  const kept = await acceptUnit({ base: broken, head: fixed, check: "check:fixed", cwd: repo, root, keep: true });
  assert.equal(kept.kept, true);
  assert.match(kept.line, /; trees and logs kept in /);
  assert.deepEqual(readdirSync(root), [kept.work.split("/").at(-1)]);
  assert.equal(existsSync(join(kept.work, "head", ".git")), true, "the kept folder holds the trees");
  assert.deepEqual(JSON.parse(readFileSync(join(kept.work, WORK_MARKER), "utf8")).tool, "accept-unit");
  removeWork(kept.work);
  assert.deepEqual(readdirSync(root), []);
});

test("removeWork refuses a folder without the marker and never follows a symlink out of the folder", () => {
  const root = scratch("accept-unit-remove-");
  const outside = scratch("accept-unit-outside-");
  writeFileSync(join(outside, "keep.txt"), "mine\n");
  const unmarked = join(root, "accept-unit-abc123");
  mkdirSync(unmarked);
  assert.throws(() => removeWork(unmarked), /not a marked work folder/);
  assert.equal(existsSync(unmarked), true);
  const named = join(root, "elsewhere-abc123");
  mkdirSync(named);
  writeFileSync(join(named, WORK_MARKER), JSON.stringify({ kind: "foundry-check-tree", tool: "accept-unit", pid: 1, host: hostname(), started: new Date().toISOString() }));
  assert.throws(() => removeWork(named), /not a marked work folder/, "the marker without the tool's name prefix is refused");
  const marked = join(root, "accept-unit-def456");
  mkdirSync(join(marked, "head"), { recursive: true });
  writeFileSync(join(marked, WORK_MARKER), JSON.stringify({ kind: "foundry-check-tree", tool: "accept-unit", pid: 1, host: hostname(), started: new Date().toISOString() }));
  symlinkSync(outside, join(marked, "head", "node_modules"));
  removeWork(marked);
  assert.equal(existsSync(marked), false);
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "mine\n", "the link was removed, not its target");
});

test("cleanStale removes only marked, old folders of a gone process that nothing holds open", async () => {
  const root = scratch("accept-unit-stale-");
  const now = Date.now();
  const old = new Date(now - STALE_AFTER_MS - 60_000).toISOString();
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const folder = (name, marker) => {
    mkdirSync(join(root, name, "head"), { recursive: true });
    writeFileSync(join(root, name, "head", "file.txt"), "x".repeat(8192));
    if (marker) writeFileSync(join(root, name, WORK_MARKER), JSON.stringify({ kind: "foundry-check-tree", host: hostname(), ...marker }));
    return join(root, name);
  };
  folder("accept-unit-stale1", { tool: "accept-unit", pid: gone, started: old });
  folder("pre-push-ratchet-stale2", { tool: "pre-push-ratchet", pid: gone, started: old });
  folder("accept-unit-unmarked", undefined);
  folder("accept-unit-young", { tool: "accept-unit", pid: gone, started: new Date(now - 60_000).toISOString() });
  folder("accept-unit-live", { tool: "accept-unit", pid: process.pid, started: old });
  folder("accept-unit-elsewhere", { tool: "accept-unit", pid: gone, started: old, host: `${hostname()}-other` });
  folder("accept-unit-wrongtool", { tool: "pre-push-ratchet", pid: gone, started: old });
  folder("unrelated-stale", { tool: "accept-unit", pid: gone, started: old });
  const opened = folder("accept-unit-opened", { tool: "accept-unit", pid: gone, started: old });
  // A live process whose cwd is inside the folder holds it, whatever the marker's pid says.
  const holder = spawn("sleep", ["30"], { cwd: join(opened, "head"), stdio: "ignore" });
  try {
    await new Promise(accept => setTimeout(accept, 200));
    const only = cleanStale({ root, tools: ["accept-unit"], now });
    assert.deepEqual(only.removed.map(entry => entry.name), ["accept-unit-stale1"], "this tool's prefix only");
    assert.ok(only.bytes >= 8192);
    assert.deepEqual(Object.fromEntries(only.kept.map(entry => [entry.name, entry.why])), {
      "accept-unit-elsewhere": "other-host",
      "accept-unit-live": "live-process",
      "accept-unit-opened": "held-open",
      "accept-unit-unmarked": "unmarked",
      "accept-unit-wrongtool": "unmarked",
      "accept-unit-young": "young",
    });
    const both = cleanStale({ root, now });
    assert.deepEqual(both.removed.map(entry => entry.name), ["pre-push-ratchet-stale2"]);
    assert.deepEqual(readdirSync(root).sort(), ["accept-unit-elsewhere", "accept-unit-live", "accept-unit-opened", "accept-unit-unmarked", "accept-unit-wrongtool", "accept-unit-young", "unrelated-stale"]);
  } finally { holder.kill(); }
});

test("the dist cache is held to a byte cap as well as a count, least recently used first, never the entry in use", () => {
  const cache = scratch("accept-unit-cachecap-");
  const entry = (name, ageMs, bytes = 64 * 1024) => {
    mkdirSync(join(cache, name, "pkg"), { recursive: true });
    writeFileSync(join(cache, name, "pkg", "index.mjs"), "x".repeat(bytes));
    const at = new Date(Date.now() - ageMs);
    utimesSync(join(cache, name), at, at);
  };
  entry("a-current", 5_000);
  entry("b-new", 1_000);
  entry("c-mid", 2_000);
  entry("d-old", 3_000);
  const size = diskUsage(join(cache, "b-new"));
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const stamp = Date.now() - STALE_AFTER_MS - 60_000;
  const abandoned = `d-old__pkg.tmp-${gone}-${stamp}`;
  mkdirSync(join(cache, abandoned));
  mkdirSync(join(cache, `d-old__pkg.tmp-${process.pid}-${stamp}`));
  const pruned = pruneCache(cache, { keep: 8, maxBytes: size * 2 + 1, current: "a-current" });
  assert.deepEqual(pruned.removed.sort(), [abandoned, "c-mid", "d-old"].sort(), "over the byte cap the least recently used go; an abandoned store goes");
  assert.deepEqual(readdirSync(cache).filter(name => !name.includes(".tmp-")).sort(), ["a-current", "b-new"], "the entry in use is kept even though it is the oldest");
  assert.equal(readdirSync(cache).filter(name => name.includes(`.tmp-${process.pid}-`)).length, 1, "a live process's unfinished store is left alone");
  const counted = pruneCache(cache, { keep: 1, maxBytes: Infinity, current: "a-current" });
  assert.deepEqual(counted.removed, ["b-new"], "the count cap still applies");
  const tiny = pruneCache(cache, { keep: 8, maxBytes: 1, current: "a-current" });
  assert.deepEqual(tiny.removed, []);
  assert.equal(existsSync(join(cache, "a-current")), true, "the entry in use stays even when it alone is over the cap");
});
