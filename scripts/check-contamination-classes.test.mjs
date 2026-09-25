// Regression coverage for #1328: check-contamination-classes.mjs used to
// read only positional[0] and silently ignore every other directory
// argument. A merge-train invocation like
// `check-contamination-classes.mjs packages/a packages/b …` reported a
// clean pass across every package while only `packages/a` had actually been
// scanned — "success over unexamined ground" (#914).
//
// These tests spawn the real CLI (never the exported internals — it has
// none; it is a top-level script) against small fixture directories, the
// same way scripts/check-foreign-references.test.mjs and
// scripts/test-gates.mjs's own CONTAM assertions do.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { spawnCapture } from "./lib/spawn-capture.mjs";
import { loadPackedCopies } from "./lib/packed-copies.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDir, "check-contamination-classes.mjs");

async function run(args) {
  const result = await spawnCapture(process.execPath, [checker, ...args]);
  return { code: result.status, out: result.stdout + result.stderr };
}

function cleanDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), "nothing to see here\n");
  return dir;
}

// A CLASS 1 finding: a dangling internal doc citation that resolves nowhere
// in this repository. Cheap and deterministic to trigger, unlike the other
// classes which need real package.json/npm-pack machinery.
function dirtyDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), "See KIT-CONVENTIONS.md for the house rules.\n");
  return dir;
}

// A directory carrying BOTH a CLASS 1 finding (note.md, as above) and a
// CLASS 2 finding (an internal-convention data-* attribute in a .ts file) —
// used to prove `--class N`'s VALUE actually reached the class filter
// (only the requested class is reported) rather than merely "the process
// didn't crash," which a directory-mistaken-for-a-flag-value bug could
// still pass by accident.
function dualClassDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), "See KIT-CONVENTIONS.md for the house rules.\n");
  writeFileSync(join(dir, "component.ts"), 'export const markup = "data-xxq-value";\n');
  return dir;
}

test("check-contamination-classes: multi-directory / non-existent-path regression (#1328)", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "contam-multiarg-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  await t.test("single directory: unchanged baseline behavior", async () => {
    const clean = cleanDir(work, "solo-clean");
    const r = await run([clean]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.match(r.out, /PASS — no contamination-class findings\./);

    const dirty = dirtyDir(work, "solo-dirty");
    const rd = await run([dirty]);
    assert.equal(rd.code, 1, `expected exit 1, got ${rd.code}: ${rd.out}`);
    assert.match(rd.out, /FAIL — 1 finding\(s\)/);
  });

  await t.test("two directories, second one planted with a finding: both are scanned, not just positional[0]", async () => {
    const first = cleanDir(work, "two-a-clean");
    const second = dirtyDir(work, "two-b-dirty");

    const r = await run([first, second]);
    // The pre-fix defect: this used to read only positional[0] (`first`,
    // clean) and report a bare PASS, silently never looking at `second` at
    // all. The fix must scan every positional argument, so the planted
    // finding in the second directory must surface as a failure.
    assert.equal(r.code, 1, `expected exit 1 (finding in the second directory), got ${r.code}: ${r.out}`);
    assert.match(r.out, new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "output should mention the first (clean) directory");
    assert.match(r.out, new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "output should mention the second (dirty) directory");
    assert.match(r.out, /KIT-CONVENTIONS\.md/, "the second directory's finding must actually be reported");
  });

  await t.test("order independence: a finding planted in the FIRST of several directories is still caught", async () => {
    const first = dirtyDir(work, "order-a-dirty");
    const second = cleanDir(work, "order-b-clean");
    const third = cleanDir(work, "order-c-clean");

    const r = await run([first, second, third]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.match(r.out, /KIT-CONVENTIONS\.md/);
  });

  await t.test("several clean directories together still pass", async () => {
    const a = cleanDir(work, "allclean-a");
    const b = cleanDir(work, "allclean-b");
    const c = cleanDir(work, "allclean-c");

    const r = await run([a, b, c]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });

  await t.test("--json with several directories: one report object per directory, in order, none silently dropped", async () => {
    const a = cleanDir(work, "json-a-clean");
    const b = dirtyDir(work, "json-b-dirty");
    const c = cleanDir(work, "json-c-clean");

    const r = await run([a, b, c, "--json"]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(r.out);
    }, `--json output should be valid JSON: ${r.out}`);
    assert.ok(Array.isArray(parsed), "multi-directory --json output should be an array, one entry per directory");
    assert.equal(parsed.length, 3, "every positional directory must produce its own report, none dropped");
    assert.equal(parsed[0].root, a);
    assert.equal(parsed[0].findings.length, 0);
    assert.equal(parsed[1].root, b);
    assert.ok(parsed[1].findings.some((f) => f.file === "note.md"), "the middle directory's finding must be present, not dropped");
    assert.equal(parsed[2].root, c);
    assert.equal(parsed[2].findings.length, 0);
  });

  await t.test("--json with a single directory keeps the original flat-object shape (no breaking change for existing callers)", async () => {
    const clean = cleanDir(work, "json-solo-clean");
    const r = await run([clean, "--json"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.out);
    assert.ok(!Array.isArray(parsed), "a single-directory --json report must stay a flat object, not an array");
    assert.ok("findings" in parsed && "root" in parsed);
  });

  await t.test("a non-existent directory anywhere in the argument list fails closed with exit 2 and names the path", async () => {
    const real = cleanDir(work, "exists-clean");
    const missing = join(work, "definitely-does-not-exist-xyz");

    for (const args of [[missing, real], [real, missing]]) {
      const r = await run(args);
      assert.equal(r.code, 2, `expected exit 2 for args ${JSON.stringify(args)}, got ${r.code}: ${r.out}`);
      assert.match(r.out, /no such directory/);
      assert.ok(r.out.includes(missing), `error output should name the missing path: ${r.out}`);
      assert.doesNotMatch(r.out, /PASS/, "must never report a bare PASS when a positional argument could not be scanned");
    }
  });

  await t.test("no positional arguments at all still prints usage and exits 2", async () => {
    const r = await run([]);
    assert.equal(r.code, 2);
    assert.match(r.out, /usage: check-contamination-classes\.mjs/);
  });

  // Regression coverage for the independent review's BLOCKING finding on
  // e2595098: `--class N` and `--allowlist <file>` both take a bare,
  // non-`--`-prefixed value. The multi-directory dispatch's
  // `positional = argv.filter(a => !a.startsWith("--"))` couldn't tell that
  // value apart from a real directory argument, so `dir --class 1` left
  // `"1"` in the positional pool and the script tried to scan it as a
  // second directory (`no such directory: 1`, exit 2) — a real defect in
  // the script's own documented usage banner, not a hypothetical.

  await t.test("directory then --class N: the value is consumed as the class filter, not a second directory", async () => {
    const dir = dualClassDir(work, "class-after-dir");
    const r = await run([dir, "--class", "1"]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.doesNotMatch(r.out, /no such directory/, "the \"1\" must never be treated as a directory argument");
    assert.match(r.out, /CLASS 1/, "the class-1 finding must still be reported");
    assert.doesNotMatch(r.out, /CLASS 2/, "the class-2 finding must be filtered out by --class 1, proving the value actually reached the filter");
  });

  await t.test("--class N then directory: same behavior regardless of flag/positional order", async () => {
    const dir = dualClassDir(work, "class-before-dir");
    const r = await run(["--class", "2", dir]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.doesNotMatch(r.out, /no such directory/);
    assert.match(r.out, /CLASS 2/, "the class-2 finding must be reported under --class 2");
    assert.doesNotMatch(r.out, /CLASS 1 —/, "the class-1 finding must be filtered out by --class 2");
  });

  await t.test("--allowlist then path: the value is used as the allowlist file, not treated as a second directory", async () => {
    const dir = dirtyDir(work, "allowlist-target");
    const allowlistPath = join(work, "custom-allowlist.json");
    writeFileSync(
      allowlistPath,
      JSON.stringify({ issue: "#1", packages: { "allowlist-target": { "note.md": ["KIT-CONVENTIONS.md"] } } }),
    );

    const withoutAllowlist = await run([dir]);
    assert.equal(withoutAllowlist.code, 1, "sanity check: the citation is a live finding without the allowlist");

    const withAllowlist = await run([dir, "--allowlist", allowlistPath]);
    assert.equal(withAllowlist.code, 0, `expected exit 0 (waived), got ${withAllowlist.code}: ${withAllowlist.out}`);
    assert.match(withAllowlist.out, /KNOWN, WAIVED/);
    assert.doesNotMatch(withAllowlist.out, /no such directory/, "the allowlist path must never be treated as a directory argument");
  });

  await t.test("multiple directories mixed with flags: every directory is scanned and the class filter still applies to each", async () => {
    const a = cleanDir(work, "mixed-a-clean");
    const b = dualClassDir(work, "mixed-b-dual");
    const c = cleanDir(work, "mixed-c-clean");

    const r = await run([a, "--class", "1", b, "--json", c]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const parsed = JSON.parse(r.out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 3, "all three directories must be scanned, none swallowed as a flag value");
    assert.equal(parsed[0].root, a);
    assert.equal(parsed[1].root, b);
    assert.ok(parsed[1].findings.some((f) => f.class === 1), "the class-1 finding in the middle directory must be reported");
    assert.ok(!parsed[1].findings.some((f) => f.class === 2), "the class-2 finding must be filtered out by --class 1, even inside multi-directory dispatch");
    assert.equal(parsed[2].root, c);
  });

  await t.test("a value-taking flag missing its value is a clear error, not a crash or a silent wrong answer", async () => {
    const dir = cleanDir(work, "missing-value-dir");

    const atEnd = await run([dir, "--class"]);
    assert.equal(atEnd.code, 2, `expected exit 2, got ${atEnd.code}: ${atEnd.out}`);
    assert.match(atEnd.out, /--class requires a value/);

    const beforeAnotherFlag = await run([dir, "--class", "--json"]);
    assert.equal(beforeAnotherFlag.code, 2, `expected exit 2, got ${beforeAnotherFlag.code}: ${beforeAnotherFlag.out}`);
    assert.match(beforeAnotherFlag.out, /--class requires a value/);

    const allowlistMissing = await run([dir, "--allowlist"]);
    assert.equal(allowlistMissing.code, 2, `expected exit 2, got ${allowlistMissing.code}: ${allowlistMissing.out}`);
    assert.match(allowlistMissing.out, /--allowlist requires a value/);
  });

  // Issue #1342: the equals form (`--class=N`, `--allowlist=<path>`) was
  // silently ignored — flagValue()'s old exact-string `argv.indexOf("--class")`
  // lookup could never match the literal token `"--class=1"`, so the value
  // was never read: `classFilter`/`explicit` stayed `undefined`, no error
  // printed, and the flag had no effect (every class scanned, or the
  // default allowlist used instead of the one named).

  await t.test("--class=N (equals form): the value is consumed as the class filter, same as the space form", async () => {
    const dir = dualClassDir(work, "class-equals-dir");
    const r = await run([dir, "--class=1"]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.doesNotMatch(r.out, /no such directory/, "\"--class=1\" must never be treated as a directory argument");
    assert.match(r.out, /CLASS 1/, "the class-1 finding must still be reported");
    assert.doesNotMatch(r.out, /CLASS 2/, "the class-2 finding must be filtered out by --class=1, proving the value actually reached the filter");
  });

  await t.test("--class=N before the directory: same behavior regardless of order", async () => {
    const dir = dualClassDir(work, "class-equals-before-dir");
    const r = await run(["--class=2", dir]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.doesNotMatch(r.out, /no such directory/);
    assert.match(r.out, /CLASS 2/, "the class-2 finding must be reported under --class=2");
    assert.doesNotMatch(r.out, /CLASS 1 —/, "the class-1 finding must be filtered out by --class=2");
  });

  await t.test("--allowlist=<path> (equals form): the value is used as the allowlist file, not the default", async () => {
    const dir = dirtyDir(work, "allowlist-equals-target");
    const allowlistPath = join(work, "custom-allowlist-equals.json");
    writeFileSync(
      allowlistPath,
      JSON.stringify({ issue: "#1", packages: { "allowlist-equals-target": { "note.md": ["KIT-CONVENTIONS.md"] } } }),
    );

    const withoutAllowlist = await run([dir]);
    assert.equal(withoutAllowlist.code, 1, "sanity check: the citation is a live finding without the allowlist");

    const withAllowlist = await run([dir, `--allowlist=${allowlistPath}`]);
    assert.equal(withAllowlist.code, 0, `expected exit 0 (waived), got ${withAllowlist.code}: ${withAllowlist.out}`);
    assert.match(withAllowlist.out, /KNOWN, WAIVED/);
    assert.doesNotMatch(withAllowlist.out, /no such directory/, "the allowlist path must never be treated as a directory argument");
  });

  await t.test("--class= (equals form, empty value) fails closed with exit 2, never silently 'no filter'", async () => {
    const dir = cleanDir(work, "class-equals-empty-dir");
    const r = await run([dir, "--class="]);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /--class requires a value/);
  });

  await t.test("--allowlist= (equals form, empty value) fails closed with exit 2, never silently falls back to the default allowlist", async () => {
    const dir = cleanDir(work, "allowlist-equals-empty-dir");
    const r = await run([dir, "--allowlist="]);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /--allowlist requires a value/);
  });

  await t.test("multiple directories mixed with the equals form: the class filter still applies inside multi-directory dispatch", async () => {
    const a = cleanDir(work, "mixed-equals-a-clean");
    const b = dualClassDir(work, "mixed-equals-b-dual");
    const c = cleanDir(work, "mixed-equals-c-clean");

    const r = await run([a, "--class=1", b, "--json", c]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const parsed = JSON.parse(r.out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 3, "all three directories must be scanned, none swallowed as a flag value");
    assert.equal(parsed[1].root, b);
    assert.ok(parsed[1].findings.some((f) => f.class === 1), "the class-1 finding in the middle directory must be reported");
    assert.ok(!parsed[1].findings.some((f) => f.class === 2), "the class-2 finding must be filtered out by --class=1, even inside multi-directory dispatch");
  });
});

// Issue #1500: a package's build copies files in verbatim from elsewhere in
// the repository -- another package's skill, a shared contract -- and a
// citation in a package's skill was written to resolve from its SOURCE's
// position. The package declares its copies in scripts/packed-copies.json,
// the same data its pack step copies from, and CLASS 1 judges a declared
// copy of another package's file exactly as its source would be judged. A
// copy of a repository document has no source package to be judged as, and
// is judged at its own position.
test("check-contamination-classes: declared packed copies are judged from their source's position (#1500)", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "contam-packed-copies-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  const TEMPLATE_DECLARATION = {
    copies: [
      { copy: "skill-catalogue/{package}/SKILL.md", source: "packages/{package}/skill/SKILL.md" },
      { copy: "contracts/shared.md", source: "docs/contracts/shared.md" },
    ],
  };

  function write(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  // A small repository shaped like this one: a copying package, two source
  // packages, and a repository-level contract. `designerSkill` is the skill
  // text under test; `designer` ships `skill/` and `templates/` but not
  // `internal/`, and `writer` ships only `skill/`.
  function fixture(
    name,
    {
      designerSkill,
      writerSkill = "# writer\n\nNothing cited here.\n",
      contract = "# Shared\n\nNothing cited here.\n",
      declaration = TEMPLATE_DECLARATION,
    },
  ) {
    const repo = join(work, name);
    const launcher = join(repo, "packages", "launcher");
    const manifest = (pkg, files) => JSON.stringify({ name: `fixture-${pkg}`, version: "1.0.0", files }, null, 2) + "\n";
    write(join(launcher, "package.json"), manifest("launcher", ["skill-catalogue", "contracts"]));
    write(join(repo, "packages", "designer", "package.json"), manifest("designer", ["skill", "templates"]));
    write(join(repo, "packages", "designer", "skill", "SKILL.md"), designerSkill);
    write(join(repo, "packages", "designer", "templates", "brand-type.template.json"), "{}\n");
    write(join(repo, "packages", "designer", "internal", "notes.md"), "# notes\n");
    write(join(repo, "packages", "writer", "package.json"), manifest("writer", ["skill"]));
    write(join(repo, "packages", "writer", "skill", "SKILL.md"), writerSkill);
    write(join(repo, "docs", "contracts", "shared.md"), contract);
    write(join(repo, "docs", "contracts", "sibling.json"), "{}\n");
    write(join(repo, "docs", "LIFECYCLE.md"), "# Lifecycle\n");
    write(join(repo, "scripts", "check-public-safety.mjs"), "export {};\n");
    // The build: copy what the TRUE declaration lists, as the pack step does.
    write(join(launcher, "scripts", "packed-copies.json"), JSON.stringify(TEMPLATE_DECLARATION, null, 2) + "\n");
    for (const { copy, source } of loadPackedCopies(launcher, repo)) {
      mkdirSync(dirname(join(launcher, copy)), { recursive: true });
      cpSync(join(repo, source), join(launcher, copy));
    }
    // Then the declaration under test, which may differ from what was built.
    write(join(launcher, "scripts", "packed-copies.json"), JSON.stringify(declaration, null, 2) + "\n");
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
    return { repo, launcher, designer: join(repo, "packages", "designer") };
  }

  async function scan(dir, extra = []) {
    const r = await run([dir, "--class", "1", "--json", ...extra]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      assert.fail(`--json output did not parse (exit ${r.code}): ${r.out}`);
    }
    const cites = (file, path) => report.findings.some((f) => f.file === file && f.detail.includes(`cites "${path}"`));
    return { ...r, report, cites };
  }

  const RESOLVING_SKILL = "# designer\n\nAuthor the record from `templates/brand-type.template.json`.\n";

  await t.test("a copied SKILL.md whose citation resolves from its source package passes", async () => {
    const { launcher } = fixture("resolves", { designerSkill: RESOLVING_SKILL });
    const r = await scan(launcher);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.deepEqual(r.report.findings, []);
  });

  // A repository document has no published file set, and no package scan
  // runs CLASS 1 on it, so "judged as its source" would mean "exists
  // somewhere in this checkout" -- a lower bar than any other shipped file
  // meets. A copy of one is judged where it ships.
  await t.test("a citation in a copied repository contract that resolves only beside its source fails at the copy's position", async () => {
    const { launcher } = fixture("contract", {
      designerSkill: RESOLVING_SKILL,
      contract: "# Shared\n\nThe stages are in `contracts/sibling.json`.\n",
    });
    const r = await scan(launcher);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.ok(r.cites("contracts/shared.md", "contracts/sibling.json"), `judged from the source's directory: ${r.out}`);
    assert.ok(
      r.report.findings.every((f) => !f.detail.includes("Judged as its source")),
      `a copy of a repository document must not be reported as judged from its source: ${r.out}`,
    );
  });

  await t.test("a byte-identical docs/ file plus a declaration cannot route repository paths past the gate", async () => {
    const { launcher } = fixture("docs-route", {
      designerSkill: RESOLVING_SKILL,
      contract: "# Shared\n\nRun `scripts/check-public-safety.mjs` first, and read `docs/LIFECYCLE.md`.\n",
    });
    const r = await scan(launcher);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.ok(r.cites("contracts/shared.md", "scripts/check-public-safety.mjs"), r.out);
    assert.ok(r.cites("contracts/shared.md", "docs/LIFECYCLE.md"), r.out);
  });

  await t.test("the same copy with a truly dangling citation still fails, as its source does", async () => {
    const skill =
      RESOLVING_SKILL +
      "\nThe house rules are in `docs/GONE-PLAYBOOK.md`.\n\nThe checklist is `internal/notes.md`.\n";
    const { launcher, designer } = fixture("dangling", { designerSkill: skill });
    const r = await scan(launcher);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.ok(r.cites("skill-catalogue/designer/SKILL.md", "docs/GONE-PLAYBOOK.md"), `rot in the copy was not reported: ${r.out}`);
    assert.ok(
      r.cites("skill-catalogue/designer/SKILL.md", "internal/notes.md"),
      `a path the source package does not ship was not reported: ${r.out}`,
    );
    assert.ok(!r.cites("skill-catalogue/designer/SKILL.md", "templates/brand-type.template.json"), r.out);
    assert.ok(
      r.report.findings.every((f) => f.detail.includes('Judged as its source, "packages/designer/skill/SKILL.md"')),
      `a copy's finding should say it was judged from its source: ${r.out}`,
    );

    const source = await scan(designer);
    assert.equal(source.code, 1, `the source itself should fail the same way: ${source.out}`);
    assert.ok(source.cites("skill/SKILL.md", "docs/GONE-PLAYBOOK.md"), source.out);
    assert.ok(source.cites("skill/SKILL.md", "internal/notes.md"), source.out);
  });

  await t.test("an undeclared file at a copy-like path is judged at its own position", async () => {
    const { launcher } = fixture("undeclared", { designerSkill: RESOLVING_SKILL });
    write(join(launcher, "skill-catalogue", "orphan", "SKILL.md"), RESOLVING_SKILL);
    const r = await scan(launcher);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.ok(r.cites("skill-catalogue/orphan/SKILL.md", "templates/brand-type.template.json"), r.out);
    assert.ok(!r.cites("skill-catalogue/designer/SKILL.md", "templates/brand-type.template.json"), r.out);
  });

  await t.test("with no declaration at all, a copy is judged at its own position, as before", async () => {
    const { launcher } = fixture("no-declaration", { designerSkill: RESOLVING_SKILL });
    rmSync(join(launcher, "scripts", "packed-copies.json"));
    const r = await scan(launcher);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.ok(r.cites("skill-catalogue/designer/SKILL.md", "templates/brand-type.template.json"), r.out);
  });

  await t.test("a declaration pointing a copy at the wrong source fails", async () => {
    const wrong = { copies: [{ copy: "skill-catalogue/designer/SKILL.md", source: "packages/writer/skill/SKILL.md" }] };

    // A different file: the declaration is false, and says so.
    const differs = fixture("wrong-source-differs", { designerSkill: RESOLVING_SKILL, declaration: wrong });
    const r1 = await scan(differs.launcher);
    assert.equal(r1.code, 1, `expected exit 1, got ${r1.code}: ${r1.out}`);
    assert.ok(
      r1.report.findings.some(
        (f) => f.file === "skill-catalogue/designer/SKILL.md" && f.detail.includes("its bytes differ from that file"),
      ),
      `the false declaration was not reported: ${r1.out}`,
    );

    // The same bytes in a package that does not ship templates/: the
    // position really does come from the declaration, so the citation fails.
    const same = fixture("wrong-source-same-bytes", {
      designerSkill: RESOLVING_SKILL,
      writerSkill: RESOLVING_SKILL,
      declaration: wrong,
    });
    const r2 = await scan(same.launcher);
    assert.equal(r2.code, 1, `expected exit 1, got ${r2.code}: ${r2.out}`);
    assert.ok(r2.cites("skill-catalogue/designer/SKILL.md", "templates/brand-type.template.json"), r2.out);

    // A source that does not exist.
    const missing = fixture("wrong-source-missing", {
      designerSkill: RESOLVING_SKILL,
      declaration: { copies: [{ copy: "skill-catalogue/designer/SKILL.md", source: "packages/gone/skill/SKILL.md" }] },
    });
    const r3 = await scan(missing.launcher);
    assert.equal(r3.code, 1, `expected exit 1, got ${r3.code}: ${r3.out}`);
    assert.ok(r3.report.findings.some((f) => f.detail.includes("that file does not exist")), r3.out);
  });

  await t.test("a waiver the source holds carries over to its copy, keyed as the source is", async () => {
    const skill = RESOLVING_SKILL + "\nThe checklist is `internal/notes.md`.\n";
    const { launcher, designer } = fixture("waiver", { designerSkill: skill });
    const allowlist = join(work, "waiver-allowlist.json");
    writeFileSync(
      allowlist,
      JSON.stringify({ issue: "#1", packages: { designer: { "skill/SKILL.md": ["internal/notes.md"] } } }) + "\n",
    );

    const unwaived = await scan(launcher, ["--no-allowlist"]);
    assert.equal(unwaived.code, 1, `sanity check: the citation is a live finding without the waiver: ${unwaived.out}`);
    assert.ok(unwaived.cites("skill-catalogue/designer/SKILL.md", "internal/notes.md"), unwaived.out);

    const copy = await scan(launcher, ["--allowlist", allowlist]);
    assert.equal(copy.code, 0, `expected the source's waiver to apply to the copy, got ${copy.code}: ${copy.out}`);
    assert.ok(
      copy.report.waived.some((w) => w.file === "skill-catalogue/designer/SKILL.md" && w.cited === "internal/notes.md"),
      `the copy's citation should be listed as waived under its own path: ${copy.out}`,
    );

    const source = await scan(designer, ["--allowlist", allowlist]);
    assert.equal(source.code, 0, `the same waiver should still hold for the source: ${source.out}`);
  });

  await t.test("a malformed declaration cannot run (exit 2)", async () => {
    const { launcher } = fixture("malformed", {
      designerSkill: RESOLVING_SKILL,
      declaration: { copies: [{ copy: "skill-catalogue/{package}/SKILL.md", source: "docs/fixed.md" }] },
    });
    const r = await run([launcher, "--class", "1"]);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /cannot read the copy declaration/);
  });
});
