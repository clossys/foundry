import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewConfig } from "./config.js";
import { jsonOf } from "./config.js";
import { scratch } from "./exec.js";
import { readReceipt, receiptDir, takeReceipt } from "./receipt.js";
import { failingTests, formatReview, ReviewArgumentError, runReview, type ReviewOptions } from "./review.js";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

/** A small repository: a tested module, a rule-count probe, a generated fixture and a receipt command. */
const BASE: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "fixture-checkout", version: "1.0.0", private: true })}\n`,
  "src/math.mjs": "export function isAdult(age) {\n  return age >= 18;\n}\n",
  "src/math.test.mjs": [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { isAdult } from \"./math.mjs\";",
    "test(\"isAdult\", () => { assert.equal(isAdult(18), true); assert.equal(isAdult(17), false); });", "",
  ].join("\n"),
  "violations.txt": "a\n",
  "probe.mjs": "import { existsSync, readFileSync } from \"node:fs\";\nif (existsSync(\"crash\")) process.exit(5);\nconst lines = readFileSync(\"violations.txt\", \"utf8\").split(\"\\n\").filter(Boolean);\nconsole.log(JSON.stringify({ findings: lines.map(() => ({ rule: \"demo.rule\" })) }));\n",
  "src/data.txt": "hello\n",
  "fixture/data.txt": "HELLO\n",
  // The generator writes its own mark file into the output, as seed-pinned-world.mjs does; the review removes it.
  "gen.mjs": "import { mkdirSync, readFileSync, writeFileSync } from \"node:fs\";\nconst out = process.argv[process.argv.indexOf(\"--out\") + 1];\nconst data = readFileSync(\"src/data.txt\", \"utf8\");\nif (data.startsWith(\"boom\")) throw new Error(\"generator failed\");\nmkdirSync(out, { recursive: true });\nwriteFileSync(`${out}/data.txt`, data.toUpperCase());\nwriteFileSync(`${out}/.mark`, \"seeded\\n\");\n",
  "check.mjs": "import { readFileSync } from \"node:fs\";\nconsole.log(`data ${readFileSync(\"src/data.txt\", \"utf8\").trim()}`);\n",
};

const CONFIG: ReviewConfig = {
  install: null,
  probePackages: [],
  counts: [{ id: "demo", counts: "lines of violations.txt", argv: ["node", "probe.mjs"], parse: stdout => {
    const out: Record<string, number> = {};
    for (const finding of jsonOf(stdout).findings as { rule: string }[]) out[finding.rule] = (out[finding.rule] ?? 0) + 1;
    return out;
  } }],
  fixtures: [{ id: "demo-fixture", fixture: "fixture", generator: "gen.mjs", args: ["--out", "{out}"], cwd: ".", needs: [], outputMarks: [".mark"], triggers: ["src/"] }],
  e2e: null,
  leakScan: null,
  typecheck: ["npx", "tsc", "--noEmit", "-p", "{pkg}"],
  timeoutMs: 60_000,
};

function write(dir: string, files: Record<string, string | null>) {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) rmSync(join(dir, path), { force: true });
    else { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  }
}

/** A repository with base committed, then head's edits committed on top: [repo, base sha, head sha]. */
function repoOf(baseFiles: Record<string, string | null>, head: Record<string, string | null>): [string, string, string] {
  const dir = scratch("review-test-");
  roots.push(dir);
  sh(dir, "init", "--quiet", "--initial-branch=main");
  write(dir, baseFiles);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "-m", "base");
  const base = sh(dir, "rev-parse", "HEAD");
  write(dir, head);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "--allow-empty", "-m", "head");
  return [dir, base, sh(dir, "rev-parse", "HEAD")];
}

/** BASE (plus baseExtra) committed, then head's edits. */
const fixture = (head: Record<string, string | null>, baseExtra: Record<string, string | null> = {}) => repoOf({ ...BASE, ...baseExtra }, head);

const review = (repo: string, base: string, head: string, extra: Partial<ReviewOptions> = {}) => runReview({ repo, base, head, config: CONFIG, ...extra });
const finding = (report: ReturnType<typeof runReview>, id: string) => report.findings.find(item => item.id === id);
/** A packet file in a fresh folder; its receipt goes to <folder>/UNIT.receipt/. */
const packetOf = (markdown: string) => { const dir = scratch("review-packet-"); roots.push(dir); const file = join(dir, "UNIT.md"); writeFileSync(file, markdown); return file; };
const fails = (report: ReturnType<typeof runReview>) => report.findings.filter(finding => finding.level === "fail").map(finding => finding.id);

/** A guarded change with tests that pin every operator on it. */
const GUARDED = {
  "src/math.mjs": "export function isAdult(age) {\n  if (age < 0) {\n    throw new RangeError(\"age\");\n  }\n  return age >= 18;\n}\n",
  "src/math.test.mjs": BASE["src/math.test.mjs"]!.replace("assert.equal(isAdult(17), false); ", "assert.equal(isAdult(17), false); assert.equal(isAdult(0), false); assert.throws(() => isAdult(-1), RangeError); "),
};

describe("clossys review", () => {
  it("passes a clean diff: tests green, every mutant killed, counts flat, fixture regenerates", () => {
    const [repo, base, head] = fixture(GUARDED);
    const report = review(repo, base, head);
    expect(fails(report)).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.verdict).toBe("PASS");
    expect(report.mutants.map(mutant => mutant.operator).sort()).toEqual(["drop-throw", "flip-comparison", "negate-condition", "swap-literal"]);
    expect(report.mutants.every(mutant => mutant.status === "killed")).toBe(true);
    expect(report.counts["demo:demo.rule"]).toEqual({ base: 1, head: 1 });
    expect(report.steps.find(item => item.step === "fixtures")?.status).toBe("pass");
    expect(formatReview(report).split("\n").at(-1)).toBe(`MECHANICAL: PASS ${head} ${report.tree}`);
  }, 60_000);

  it("fails the same commit as base and head: no steps run, so nothing was checked", () => {
    const [repo, , head] = fixture(GUARDED);
    const report = review(repo, head, head);
    expect(report.verdict).toBe("FAIL");
    expect(fails(report)).toEqual(["review.no-commands"]);
    expect(report.ran).toEqual({ commands: 0, missing: [] });
    expect(report.changed.files).toEqual([]);
  }, 30_000);

  it("fails an increased rule count", () => {
    const [repo, base, head] = fixture({ "violations.txt": "a\nb\n" });
    const report = review(repo, base, head);
    expect(report.counts["demo:demo.rule"]).toEqual({ base: 1, head: 2 });
    expect(fails(report)).toEqual(["count.increase"]);
    expect(report.verdict).toBe("FAIL");
  }, 30_000);

  it("passes a decreased rule count", () => {
    const [repo, base, head] = fixture({ "violations.txt": "" });
    const report = review(repo, base, head);
    expect(report.counts["demo:demo.rule"]).toEqual({ base: 1, head: 0 });
    expect(report.verdict).toBe("PASS");
  }, 30_000);

  it("reports a surviving mutant as a note, by id", () => {
    const [repo, base, head] = fixture({ "src/math.mjs": `${BASE["src/math.mjs"]}export const VOTING_AGE = 18;\n` });
    const report = review(repo, base, head);
    const survived = report.mutants.filter(mutant => mutant.status === "survived");
    expect(survived.map(mutant => mutant.id)).toEqual(["src/math.mjs:4:27:swap-literal"]);
    expect(report.findings).toEqual([{ id: "mutation.survived", level: "note", subject: "src/math.mjs:4:27:swap-literal", detail: "export const VOTING_AGE = 18; -> export const VOTING_AGE = 19;" }]);
    expect(report.verdict).toBe("PASS");
  }, 30_000);

  it("fails fixture drift: an input changed and the committed copy was not regenerated", () => {
    const [repo, base, head] = fixture({ "src/data.txt": "world\n" });
    const report = review(repo, base, head);
    expect(fails(report)).toEqual(["fixture.drift"]);
    expect(report.findings[0]!.subject).toBe("fixture");
  }, 30_000);

  it("passes a regenerated fixture", () => {
    const [repo, base, head] = fixture({ "src/data.txt": "world\n", "fixture/data.txt": "WORLD\n" });
    expect(fails(review(repo, base, head))).toEqual([]);
  }, 30_000);

  it("fails a forbidden-path edit: a changelog entry and a version bump", () => {
    const [repo, base, head] = fixture({ "CHANGELOG.md": "# 1.0.1\n", "package.json": BASE["package.json"]!.replace("1.0.0", "1.0.1") });
    const report = review(repo, base, head);
    expect(fails(report).sort()).toEqual(["forbidden.changelog", "forbidden.version"]);
    expect(report.verdict).toBe("FAIL");
  }, 30_000);

  it("fails a receipt that does not match a re-run at the head, and passes one that does", () => {
    const [repo, base, head] = fixture({ "src/data.txt": "world\n", "fixture/data.txt": "WORLD\n" });
    const packets = scratch("review-packet-");
    roots.push(packets);
    const packet = join(packets, "UNIT.md");
    writeFileSync(packet, "# Unit\n\n## Validation\n\n- `node check.mjs` exits 0.\n- `wt run --kind build --tool t --session s -- node check.mjs` (same command, once).\n- `clossys review base head` is the reviewer's.\n\n## Output\n\n- `node nope.mjs` is not a validation.\n");
    const receipt = takeReceipt(packet, repo);
    expect(receipt.commands.map(entry => [entry.run, entry.exit])).toEqual([["node check.mjs", 0]]);
    expect(receipt.skipped.map(item => item.text)).toEqual(["clossys review base head"]);
    expect(receipt.head).toBe(head);
    expect(fails(review(repo, base, head, { packet }))).toEqual([]);

    const file = join(receiptDir(packet), "receipt.json");
    const forged = readReceipt(file);
    writeFileSync(file, JSON.stringify({ ...forged, commands: forged.commands.map(entry => ({ ...entry, tailSha256: "0".repeat(64) })) }));
    const report = review(repo, base, head, { packet });
    expect(fails(report)).toEqual(["receipt.mismatch"]);
    expect(report.verdict).toBe("FAIL");
    writeFileSync(file, JSON.stringify({ ...forged, commands: forged.commands.map(entry => ({ ...entry, exit: 1 })) }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.exit", "receipt.mismatch"]);
  }, 60_000);

  it("fails a missing receipt and a receipt taken at another head", () => {
    const [repo, base, head] = fixture({ "src/data.txt": "world\n", "fixture/data.txt": "WORLD\n" });
    const packets = scratch("review-packet-");
    roots.push(packets);
    const packet = join(packets, "UNIT.md");
    writeFileSync(packet, "## Validation\n\n- `node check.mjs`\n");
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.missing"]);
    takeReceipt(packet, repo);
    const file = join(receiptDir(packet), "receipt.json");
    writeFileSync(file, JSON.stringify({ ...readReceipt(file), head: base }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.head"]);
    expect(readFileSync(join(receiptDir(packet), "receipt.md"), "utf8")).toContain("| c1 | `node check.mjs` | 0 | 0 |");
  }, 60_000);

  it("builds the changed package after its prerequisites, and the base tree reuses an unchanged prerequisite's dist", () => {
    const dir = scratch("review-test-");
    roots.push(dir);
    const build = (out: string, needs?: string) => `import { existsSync, mkdirSync, writeFileSync } from "node:fs";\n${needs ? `if (!existsSync(${JSON.stringify(needs)})) throw new Error("prerequisite not built");\n` : ""}mkdirSync("dist", { recursive: true });\nwriteFileSync(${JSON.stringify(`dist/${out}`)}, "export const n = 1;\\n");\n`;
    sh(dir, "init", "--quiet", "--initial-branch=main");
    write(dir, {
      "package.json": `${JSON.stringify({ name: "ws", private: true, workspaces: ["packages/*"] })}\n`,
      "packages/lib/package.json": `${JSON.stringify({ name: "lib", version: "1.0.0", scripts: { build: "node build.mjs" } })}\n`,
      "packages/lib/build.mjs": build("lib.mjs"),
      "packages/app/package.json": `${JSON.stringify({ name: "app", version: "1.0.0", dependencies: { lib: "1.0.0" }, scripts: { build: "node build.mjs" } })}\n`,
      "packages/app/build.mjs": build("app.mjs", "../lib/dist/lib.mjs"),
      "packages/app/notes.txt": "one\n",
      "probe.mjs": "import { existsSync } from \"node:fs\";\nif (!existsSync(\"packages/app/dist/app.mjs\")) process.exit(3);\nconsole.log(JSON.stringify({ findings: [] }));\n",
    });
    sh(dir, "add", "-A");
    sh(dir, "commit", "--quiet", "-m", "base");
    const base = sh(dir, "rev-parse", "HEAD");
    write(dir, { "packages/app/notes.txt": "two\n" });
    sh(dir, "commit", "--quiet", "-am", "head");
    const config: ReviewConfig = { ...CONFIG, probePackages: ["packages/app"], fixtures: [], counts: [{ ...CONFIG.counts[0]! }] };
    const report = runReview({ repo: dir, base, head: sh(dir, "rev-parse", "HEAD"), config });
    expect(report.steps.filter(item => item.step === "build").map(item => item.detail)).toEqual([
      "head: lib (prerequisite), app",
      "base: lib (dist from head, unchanged), app",
    ]);
    expect(report.changed.packages).toEqual(["packages/app"]);
    expect(report.findings).toEqual([]);
    expect(report.verdict).toBe("PASS");
  }, 60_000);
});

describe("clossys review: arguments", () => {
  it("refuses swapped arguments (head an ancestor of base) and --receipt without --packet", () => {
    const [repo, base, head] = fixture({ "violations.txt": "" });
    expect(() => review(repo, head, base)).toThrow(ReviewArgumentError);
    expect(() => review(repo, head, base)).toThrow(/swapped/);
    expect(() => review(repo, base, head, { receipt: join(repo, "receipt.json") })).toThrow(/--receipt needs --packet/);
  }, 30_000);
});

describe("clossys review: leak scan (the merge base's scanner, unchanged, on the head tree)", () => {
  // A stand-in scanner: fails, printing the secret detail, when the tree it runs in has a non-empty leaks.txt.
  const SCAN = "import { existsSync, readFileSync } from \"node:fs\";\nconst text = existsSync(\"leaks.txt\") ? readFileSync(\"leaks.txt\", \"utf8\").trim() : \"\";\nif (text) { console.error(`leak: ${text}`); process.exit(1); }\nconsole.log(\"clean\");\n";
  const withScript = (script: string) => `${JSON.stringify({ name: "fixture-checkout", version: "1.0.0", private: true, scripts: { "check:safety": script } })}\n`;
  const SCANNED = { "package.json": withScript("node scan.mjs ."), "scan.mjs": SCAN };
  const scanned = (head: Record<string, string | null>, base: Record<string, string | null> = SCANNED) => {
    const [repo, b, h] = fixture(head, base);
    return review(repo, b, h, { config: { ...CONFIG, leakScan: { npmScript: "check:safety" } } });
  };

  it("passes a clean head and fails a head the scanner rejects, by exit code only, never printing its output", () => {
    const clean = scanned({ "notes.md": "x\n" });
    expect(fails(clean)).toEqual([]);
    expect(clean.steps.find(item => item.step === "leak-scan")).toMatchObject({ status: "pass" });
    const leaky = scanned({ "leaks.txt": "new.txt SECRETWORD\n" });
    expect(fails(leaky)).toEqual(["leak-scan"]);
    expect(finding(leaky, "leak-scan")!.detail).toMatch(/^exit 1; output withheld/);
    expect(JSON.stringify(leaky)).not.toContain("SECRETWORD");
    expect(formatReview(leaky)).not.toContain("SECRETWORD");
  }, 60_000);

  it("fails a head that only keeps a failure the merge base already had: no base-vs-head delta", () => {
    const report = scanned({ "notes.md": "x\n" }, { ...SCANNED, "leaks.txt": "old.txt SECRETWORD\n" });
    expect(fails(report)).toEqual(["leak-scan"]);
  }, 60_000);

  it("ignores a head that rewires the script or edits the scanner: the merge base's scanner judges it", () => {
    const rewired = scanned({ "leaks.txt": "SECRETWORD\n", "package.json": withScript("node -e 0") });
    expect(fails(rewired)).toContain("leak-scan");
    const edited = scanned({ "leaks.txt": "SECRETWORD\n", "scan.mjs": "process.exit(0);\n" });
    expect(fails(edited)).toContain("leak-scan");
  }, 60_000);

  it("fails when the merge base has no such script, or one that is not a plain node command", () => {
    const none = scanned({ "notes.md": "x\n" }, { "scan.mjs": SCAN });
    expect(fails(none)).toEqual(["leak-scan"]);
    expect(finding(none, "leak-scan")!.detail).toMatch(/no "check:safety" script/);
    const piped = scanned({ "notes.md": "x\n" }, { ...SCANNED, "package.json": withScript("node scan.mjs . || true") });
    expect(fails(piped)).toEqual(["leak-scan"]);
  }, 60_000);
});

describe("clossys review: receipts held to the packet", () => {
  const PACKET = "## Validation\n\n- `node check.mjs` exits 0.\n- `node fail.mjs` exits 1 (it reports the gap).\n";
  const take = (packet: string, repo: string) => { takeReceipt(packet, repo); return join(receiptDir(packet), "receipt.json"); };
  const ready = () => fixture({ "src/data.txt": "world\n", "fixture/data.txt": "WORLD\n" }, { "fail.mjs": "console.log(\"gap\");\nprocess.exit(1);\n" });

  it("passes a receipt whose every exit is the expected one, and fails a trimmed, padded or foreign receipt", () => {
    const [repo, base, head] = ready();
    const packet = packetOf(PACKET);
    const file = take(packet, repo);
    expect(readReceipt(file).commands.map(entry => [entry.run, entry.expect, entry.exit])).toEqual([["node check.mjs", 0, 0], ["node fail.mjs", 1, 1]]);
    expect(fails(review(repo, base, head, { packet }))).toEqual([]);
    const taken = readReceipt(file);
    writeFileSync(file, JSON.stringify({ ...taken, commands: taken.commands.slice(1) }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.command-missing"]);
    writeFileSync(file, JSON.stringify({ ...taken, commands: [...taken.commands, { ...taken.commands[0]!, id: "c3", run: "node extra.mjs" }] }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.command-extra"]);
    writeFileSync(file, JSON.stringify({ ...taken, packet: join(repo, "OTHER.md") }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.packet"]);
    writeFileSync(file, JSON.stringify({ ...taken, dirty: true }));
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.dirty"]);
  }, 90_000);

  it("fails a red command the packet expects to exit 0, even when the re-run agrees", () => {
    const [repo, base, head] = ready();
    const packet = packetOf("## Validation\n\n- `node check.mjs`\n- `node fail.mjs`\n");
    take(packet, repo);
    const report = review(repo, base, head, { packet });
    expect(fails(report)).toEqual(["receipt.exit"]);
    expect(finding(report, "receipt.exit")).toMatchObject({ subject: "node fail.mjs", detail: "exit 1 recorded, the packet expects 0" });
  }, 60_000);

  it("re-runs a branch-named command against the checkout's own local branches", () => {
    const [repo, base, head] = ready();
    sh(repo, "branch", "side", base);
    const packet = packetOf("## Validation\n\n- `git rev-parse --verify side`\n- `git merge-tree --write-tree side HEAD`\n");
    const file = take(packet, repo);
    expect(readReceipt(file).commands.map(entry => entry.exit)).toEqual([0, 0]);
    expect(fails(review(repo, base, head, { packet }))).toEqual([]);
  }, 60_000);
});

describe("clossys review: fail branches", () => {
  it("fails a red covering test, with its exit code", () => {
    const [repo, base, head] = fixture({ "src/math.mjs": "export function isAdult(age) {\n  return age > 18;\n}\n" });
    const report = review(repo, base, head);
    expect(fails(report)).toEqual(["tests"]);
    expect(finding(report, "tests")).toMatchObject({ subject: "src/math.test.mjs" });
    expect(finding(report, "tests")!.detail).toMatch(/^exit 1: /);
  }, 30_000);

  it("mutates against the green covering tests when another covering test is red", () => {
    const red = "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { isAdult } from \"./math.mjs\";\ntest(\"red\", () => assert.equal(isAdult(1), true));\n";
    const [repo, base, head] = fixture({ ...GUARDED, "src/zz.test.mjs": red });
    const report = review(repo, base, head);
    expect(fails(report)).toEqual(["tests"]);
    expect(finding(report, "tests")!.subject).toBe("src/zz.test.mjs");
    expect(report.mutants.length).toBeGreaterThan(0);
    expect(report.mutants.every(mutant => mutant.status === "killed" && mutant.by === "src/math.test.mjs")).toBe(true);
  }, 60_000);

  it("fails a changed source that no test reaches, and covers one reached only through another module", () => {
    const [repo, base, head] = fixture({
      "src/lonely.mjs": "export const lonely = 1;\n",
      "src/rule.mjs": "export const AGE = 18;\n",
      "src/math.mjs": "import { AGE } from \"./rule.mjs\";\nexport function isAdult(age) {\n  return age >= AGE;\n}\n",
    });
    const report = review(repo, base, head);
    expect(fails(report)).toEqual(["test.uncovered"]);
    expect(finding(report, "test.uncovered")!.subject).toBe("src/lonely.mjs");
    expect(report.mutants.find(mutant => mutant.file === "src/rule.mjs")).toMatchObject({ status: "killed", by: "src/math.test.mjs" });
  }, 60_000);

  it("fails a failed install, build, typecheck and e2e, each with its exit code", () => {
    const failing = (code: number) => ["node", "-e", `process.exit(${code})`];
    const [repo, base, head] = repoOf({
      "package.json": `${JSON.stringify({ name: "ws", private: true, workspaces: ["packages/*"] })}\n`,
      "packages/app/package.json": `${JSON.stringify({ name: "app", version: "1.0.0", scripts: { build: "node -e \"process.exit(2)\"" } })}\n`,
      "packages/app/tsconfig.json": "{}\n",
      "packages/app/notes.txt": "one\n",
    }, { "packages/app/notes.txt": "two\n" });
    const bare = { ...CONFIG, counts: [], fixtures: [] };
    const install = review(repo, base, head, { config: { ...bare, install: failing(3), typecheck: failing(0) } });
    expect(fails(install)).toEqual(["install"]);
    expect(finding(install, "install")!.detail).toMatch(/^exit 3/);
    const report = review(repo, base, head, { config: { ...bare, typecheck: failing(4), e2e: { packages: ["packages/app"], argv: failing(6) } } });
    expect(fails(report)).toEqual(["build", "types", "e2e"]);
    expect(finding(report, "build")).toMatchObject({ subject: "head: app" });
    expect(finding(report, "build")!.detail).toMatch(/^exit 2/);
    expect(finding(report, "types")).toMatchObject({ subject: "packages/app" });
    expect(finding(report, "types")!.detail).toMatch(/^exit 4/);
    expect(finding(report, "e2e")!.detail).toMatch(/^exit 6/);
  }, 60_000);

  it("fails a count probe that cannot run at the head, or at the merge base", () => {
    const [repo, base, head] = fixture({ crash: "1\n" });
    const atHead = review(repo, base, head);
    expect(fails(atHead)).toEqual(["count.probe"]);
    expect(finding(atHead, "count.probe")!.detail).toMatch(/^head: exit 5/);
    const [repo2, base2, head2] = fixture({ crash: null }, { crash: "1\n" });
    const atBase = review(repo2, base2, head2);
    expect(fails(atBase)).toEqual(["count.probe"]);
    expect(finding(atBase, "count.probe")!.detail).toMatch(/^base: exit 5/);
  }, 60_000);

  it("fails a generator that exits non-zero on the head's inputs", () => {
    const [repo, base, head] = fixture({ "src/data.txt": "boom\n" });
    const report = review(repo, base, head);
    expect(fails(report)).toEqual(["fixture.generate"]);
    expect(finding(report, "fixture.generate")!.detail).toMatch(/^exit 1/);
  }, 30_000);

  it("fails a registered generator the head deleted, or that was never there, even when no input changed", () => {
    const [repo, base, head] = fixture({ "gen.mjs": null, "notes.md": "x\n" });
    const deleted = review(repo, base, head);
    expect(fails(deleted)).toEqual(["fixture.generator-missing"]);
    expect(finding(deleted, "fixture.generator-missing")!.detail).toMatch(/the merge base has it/);
    const [repo2, base2, head2] = fixture({ "notes.md": "x\n" }, { "gen.mjs": null });
    const never = review(repo2, base2, head2);
    expect(fails(never)).toEqual(["fixture.generator-missing"]);
    expect(finding(never, "fixture.generator-missing")!.detail).not.toMatch(/merge base has it/);
  }, 60_000);
});

describe("clossys review: fail closed", () => {
  const bare: ReviewConfig = { ...CONFIG, counts: [], fixtures: [] };

  it("review fails when zero commands ran", () => {
    // A docs-only diff with nothing configured to run: every step skips, so no command runs at all.
    const [repo, base, head] = fixture({ "notes.md": "x\n" });
    const report = review(repo, base, head, { config: bare });
    expect(report.steps.every(item => item.status !== "fail")).toBe(true);
    expect(report.ran.commands).toBe(0);
    expect(fails(report)).toEqual(["review.no-commands"]);
    expect(report.verdict).toBe("FAIL");
    expect(report.line).toBe(`MECHANICAL: FAIL ${head} ${report.tree}`);
    expect(formatReview(report).split("\n").at(-1)).toBe(report.line);
    // The same diff with one probe configured runs a command, and passes.
    const probed = review(repo, base, head);
    expect(probed.ran.commands).toBeGreaterThan(0);
    expect(probed.verdict).toBe("PASS");
  }, 30_000);

  it("review fails on a missing install", () => {
    const [repo, base, head] = fixture({ "notes.md": "x\n" });
    const missing = review(repo, base, head, { config: { ...CONFIG, install: ["clossys-no-such-installer"] } });
    expect(missing.ran.missing).toEqual(["clossys-no-such-installer"]);
    expect(fails(missing)).toEqual(["install", "run.missing"]);
    expect(missing.verdict).toBe("FAIL");
    // A packet cannot make a 127 a pass by expecting it: the receipt agrees with the re-run, and it is still FAIL.
    const [repo2, base2, head2] = fixture({ "src/data.txt": "world\n", "fixture/data.txt": "WORLD\n" }, { "gone.mjs": "process.exit(127);\n" });
    const packet = packetOf("## Validation\n\n- `node gone.mjs` exits 127.\n");
    const receipt = takeReceipt(packet, repo2);
    expect(receipt.commands.map(entry => [entry.exit, entry.expect])).toEqual([[127, 127]]);
    expect(receipt.verdict).toBe("FAIL");
    expect(receipt.line).toBe(`RECEIPT: FAIL ${head2}`);
    const report = review(repo2, base2, head2, { packet });
    expect(fails(report)).toEqual(["run.missing"]);
    expect(report.verdict).toBe("FAIL");
  }, 60_000);

  it("a base-red test is not reported as new red", () => {
    // math.test.mjs is already red at the base; the head keeps it red and adds a new red test.
    const red = (name: string, body: string) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { isAdult } from "./math.mjs";\ntest(${JSON.stringify(name)}, () => { ${body} });\n`;
    const already = red("isAdult", "assert.equal(isAdult(17), true);");
    const [repo, base, head] = fixture(
      { "src/math.mjs": `${BASE["src/math.mjs"]}export const unused = 1;\n`, "src/zz.test.mjs": red("zz", "assert.equal(isAdult(1), true);") },
      { "src/math.test.mjs": already },
    );
    const report = review(repo, base, head);
    expect(report.baseRed).toEqual(["src/math.test.mjs"]);
    expect(report.newRed).toEqual(["src/zz.test.mjs"]);
    expect(fails(report)).toEqual(["tests"]);
    expect(finding(report, "tests")!.subject).toBe("src/zz.test.mjs");
    expect(report.findings.find(item => item.id === "tests.base-red")).toMatchObject({ level: "note", subject: "src/math.test.mjs", detail: "also fails run alone at the merge base" });
    // Only the base-red test red: the verdict is PASS.
    const [repo2, base2, head2] = fixture({ "src/math.mjs": `${BASE["src/math.mjs"]}export const unused = 1;\n` }, { "src/math.test.mjs": already });
    const only = review(repo2, base2, head2);
    expect(only.baseRed).toEqual(["src/math.test.mjs"]);
    expect(only.newRed).toEqual([]);
    expect(fails(only)).toEqual([]);
    expect(only.verdict).toBe("PASS");
  }, 90_000);

  it("names vitest failures by test, and holds a --fast record to the head and merge base", () => {
    const output = "\u001b[31m FAIL \u001b[39m src/a.test.ts > group > keeps one\n FAIL  src/a.test.ts > group > keeps two 12ms\n FAIL  src/other.test.ts > x\n";
    expect(failingTests("packages/p/src/a.test.ts", "packages/p", output)).toEqual(["packages/p/src/a.test.ts :: group > keeps one", "packages/p/src/a.test.ts :: group > keeps two"]);
    expect(failingTests("packages/p/src/a.test.ts", "packages/p", "Error: cannot load\n")).toEqual(["packages/p/src/a.test.ts"]);
    const [repo, base, head] = fixture({ "src/math.mjs": "export function isAdult(age) {\n  return age > 18;\n}\n" });
    const dir = scratch("review-fast-");
    roots.push(dir);
    const record = (at: string, over: string) => { const file = join(dir, `${at.slice(0, 7)}-${over.slice(0, 7)}.json`); writeFileSync(file, JSON.stringify({ schema: "clossys.fast-check/1", head: at, base: over, baseRed: [{ id: "src/math.test.mjs", messages: [] }] })); return file; };
    const listed = review(repo, base, head, { fast: record(head, base) });
    expect(listed.baseRed).toEqual(["src/math.test.mjs"]);
    expect(listed.findings.find(item => item.id === "tests.base-red")!.detail).toMatch(/--fast record/);
    const stale = review(repo, base, head, { fast: record(base, base) });
    expect(fails(stale)).toEqual(["fast.record", "tests"]);
    expect(stale.newRed).toEqual(["src/math.test.mjs"]);
  }, 60_000);
});
