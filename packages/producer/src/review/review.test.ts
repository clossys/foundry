import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewConfig } from "./config.js";
import { jsonOf } from "./config.js";
import { scratch } from "./exec.js";
import { readReceipt, receiptDir, takeReceipt } from "./receipt.js";
import { formatReview, runReview } from "./review.js";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

/** A small repository: a tested module, a rule-count probe, a generated fixture and a receipt command. */
const BASE: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "fixture-repo", version: "1.0.0", private: true })}\n`,
  "src/math.mjs": "export function isAdult(age) {\n  return age >= 18;\n}\n",
  "src/math.test.mjs": [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { isAdult } from \"./math.mjs\";",
    "test(\"isAdult\", () => { assert.equal(isAdult(18), true); assert.equal(isAdult(17), false); });", "",
  ].join("\n"),
  "violations.txt": "a\n",
  "probe.mjs": "import { readFileSync } from \"node:fs\";\nconst lines = readFileSync(\"violations.txt\", \"utf8\").split(\"\\n\").filter(Boolean);\nconsole.log(JSON.stringify({ findings: lines.map(() => ({ rule: \"demo.rule\" })) }));\n",
  "src/data.txt": "hello\n",
  "fixture/data.txt": "HELLO\n",
  "gen.mjs": "import { mkdirSync, readFileSync, writeFileSync } from \"node:fs\";\nconst out = process.argv[process.argv.indexOf(\"--out\") + 1];\nmkdirSync(out, { recursive: true });\nwriteFileSync(`${out}/data.txt`, readFileSync(\"src/data.txt\", \"utf8\").toUpperCase());\n",
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
  fixtures: [{ id: "demo-fixture", fixture: "fixture", generator: "gen.mjs", args: ["--out", "{out}"], cwd: ".", triggers: ["src/"] }],
  e2e: null,
  leakScan: null,
  timeoutMs: 60_000,
};

function write(dir: string, files: Record<string, string | null>) {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) rmSync(join(dir, path), { force: true });
    else { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  }
}

/** A repository with BASE committed, then head's edits committed on top: [repo, base sha, head sha]. */
function fixture(head: Record<string, string | null>): [string, string, string] {
  const dir = scratch("review-test-");
  roots.push(dir);
  sh(dir, "init", "--quiet", "--initial-branch=main");
  write(dir, BASE);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "-m", "base");
  const base = sh(dir, "rev-parse", "HEAD");
  write(dir, head);
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "--allow-empty", "-m", "head");
  return [dir, base, sh(dir, "rev-parse", "HEAD")];
}

const review = (repo: string, base: string, head: string, extra: { packet?: string } = {}) => runReview({ repo, base, head, config: CONFIG, ...extra });
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

  it("passes the same commit as base and head with no findings and no steps run", () => {
    const [repo, , head] = fixture(GUARDED);
    const report = review(repo, head, head);
    expect(report.verdict).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(report.changed.files).toEqual([]);
  });

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
    expect(fails(review(repo, base, head, { packet }))).toEqual(["receipt.mismatch"]);
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
    expect(readFileSync(join(receiptDir(packet), "receipt.md"), "utf8")).toContain("| c1 | `node check.mjs` | 0 |");
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
