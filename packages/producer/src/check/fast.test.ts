/**
 * `clossys check --fast` (check/fast.ts, cli/fast.ts) on real throwaway git repositories: real typecheck scripts, real
 * vitest and node --test runs, a real merge-base tree for base results. Nothing outside the temp folders is written.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli/main.js";
import { runFastCli } from "../cli/fast.js";
import { formatFast, runFast, type FastRecord } from "./fast.js";

// Each test spawns git, npm, vitest and node processes; at shared load they take several seconds each.
vi.setConfig({ testTimeout: 180_000 });

const NODE_MODULES = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function write(repo: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), text); }
}
function commit(repo: string, message: string, files: Record<string, string>) {
  write(repo, files);
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=fast", "-c", "user.email=fast@example.invalid", "commit", "--quiet", "-m", message);
}

const SUM = "export const sum = (a: number, b: number): number => a + b;\n";
const SUM_TEST = "import { expect, test } from \"vitest\";\nimport { sum } from \"./sum.js\";\ntest(\"adds\", () => { expect(sum(1, 2)).toBe(3); });\n";

/** A repository with one vitest workspace package (typecheck fails on a TYPE_ERROR marker) on main, then a work branch. */
function world(extra: Record<string, string> = {}) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "fast-check-")));
  roots.push(top);
  const repo = join(top, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  symlinkSync(NODE_MODULES, join(repo, "node_modules"), "dir");
  commit(repo, "base", {
    ".gitignore": "node_modules\n",
    "README.md": "# fixture\n",
    "package.json": JSON.stringify({ name: "fx-root", private: true, type: "module", workspaces: ["packages/*"], scripts: { "check:tool": "node scripts/check-tool.mjs" } }, null, 2),
    "packages/demo/package.json": JSON.stringify({ name: "@fx/demo", private: true, type: "module", scripts: { typecheck: "node typecheck.mjs", test: "vitest run" }, devDependencies: { vitest: "*" } }, null, 2),
    "packages/demo/typecheck.mjs": "import { readdirSync, readFileSync } from \"node:fs\";\nfor (const file of readdirSync(\"src\")) if (readFileSync(`src/${file}`, \"utf8\").includes(\"TYPE_ERROR\")) { console.error(`src/${file}: TYPE_ERROR`); process.exit(2); }\n",
    "packages/demo/skill/SKILL.md": "---\nname: clossys-demo\n---\n# demo\n",
    "packages/demo/src/sum.ts": SUM,
    "packages/demo/src/sum.test.ts": SUM_TEST,
    "scripts/tool.mjs": "export const twice = (n) => n * 2;\n",
    "scripts/tool.test.mjs": "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { twice } from \"./tool.mjs\";\ntest(\"twice\", () => assert.equal(twice(2), 4));\n",
    "scripts/check-tool.mjs": "import { readFileSync } from \"node:fs\";\nconst doc = JSON.parse(readFileSync(\"docs/contracts/tool.json\", \"utf8\"));\nprocess.exit(doc.ok === true ? 0 : 1);\n",
    "docs/contracts/tool.json": "{ \"ok\": true }\n",
    ...extra,
  });
  git(repo, "checkout", "--quiet", "-b", "work");
  return { top, repo };
}

const ran = (record: FastRecord, step: string) => record.commands.filter(command => command.step === step);

describe("clossys check --fast", () => {
  it("fast fails on a new related red and names the test", async () => {
    const { repo } = world();
    commit(repo, "break sum", { "packages/demo/src/sum.ts": "export const sum = (a: number, b: number): number => a - b;\n" });
    const result = await runCli(["check", "--fast", "--base", "main"], repo);
    const record = result.output as FastRecord;
    expect(result.exitCode).toBe(1);
    expect(record.verdict).toBe("FAST FAIL");
    expect(record.red.map(item => item.id)).toEqual(["packages/demo/src/sum.test.ts"]);
    expect(record.red[0]!.messages.join(" ")).toContain("passes alone at base");
    expect(ran(record, "alone")).toHaveLength(1);
    expect(ran(record, "base")).toHaveLength(1);
    expect(result.message).toContain("alone: 1 re-run, 1 red (packages/demo/src/sum.test.ts)");
    expect(result.message.split("\n").at(-1)).toBe(`FAST FAIL ${git(repo, "rev-parse", "HEAD")}`);
  });

  it("fast passes when the only red also fails alone at base", async () => {
    const marker = join(realpathSync(mkdtempSync(join(tmpdir(), "fast-marker-"))), "ran-once");
    roots.push(dirname(marker));
    const { repo } = world({
      // Red at the merge-base already: base-red, never failing the run.
      "packages/demo/src/broken.test.ts": "import { expect, test } from \"vitest\";\nimport { sum } from \"./sum.js\";\ntest(\"wrong\", () => { expect(sum(2, 2)).toBe(5); });\n",
      // Fails the first time it runs (the related step), passes after: load noise the alone run clears.
      "packages/demo/src/noisy.test.ts": `import { existsSync, writeFileSync } from "node:fs";\nimport { expect, test } from "vitest";\nimport { sum } from "./sum.js";\ntest("noisy", () => { const first = !existsSync(${JSON.stringify(marker)}); writeFileSync(${JSON.stringify(marker)}, "1"); expect(first ? 0 : sum(1, 1)).toBe(2); });\n`,
    });
    commit(repo, "touch sum", { "packages/demo/src/sum.ts": `// sum two numbers\n${SUM}` });
    const result = await runCli(["check", "--fast", "--base", "main"], repo);
    const record = result.output as FastRecord;
    expect(record.steps.find(step => step.step === "related")!.status).toBe("fail");
    expect(record.baseRed.map(item => item.id)).toEqual(["packages/demo/src/broken.test.ts"]);
    expect(record.noise.map(item => item.id)).toEqual(["packages/demo/src/noisy.test.ts"]);
    expect(record.red).toEqual([]);
    expect(record.verdict).toBe("FAST PASS");
    expect(result.exitCode).toBe(0);
  });

  it("fast stops at typecheck and runs no tests", async () => {
    const { repo } = world();
    commit(repo, "type error", { "packages/demo/src/sum.ts": `${SUM}// TYPE_ERROR\n` });
    const record = await runFast({ repo, base: "main" });
    expect(record.verdict).toBe("FAST FAIL");
    expect(record.steps.map(step => `${step.step}:${step.status}`)).toEqual(["typecheck:fail", "related:skipped", "alone:skipped"]);
    expect(record.commands.map(command => command.step)).toEqual(["typecheck"]);
    expect(record.steps[0]!.line).toContain("packages/demo (exit 2: src/sum.ts: TYPE_ERROR)");
  });

  it("fast refuses with no base", async () => {
    const { repo } = world();
    commit(repo, "change", { "packages/demo/src/sum.ts": `// x\n${SUM}` });
    const result = await runCli(["check", "--fast"], repo);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("no base: this branch has no upstream; pass --base <ref> (there is no fallback base)");
    await expect(runFast({ repo })).rejects.toThrow(/no base/);
  });

  it("slow test is listed and files one request with file-requests", async () => {
    const { repo } = world({
      "packages/demo/src/slow.test.ts": "import { expect, test } from \"vitest\";\nimport { sum } from \"./sum.js\";\ntest(\"slow\", async () => { await new Promise(done => setTimeout(done, 1200)); expect(sum(1, 1)).toBe(2); });\n",
      "clossys/clossys.config.ts": "export default {};\n",
    });
    commit(repo, "touch sum", { "packages/demo/src/sum.ts": `// slow\n${SUM}` });
    const result = await runFastCli(["check", "--fast", "--base", "main", "--file-requests"], repo, { slowMs: 600 });
    const record = result.output as FastRecord;
    expect(record.verdict).toBe("FAST PASS");
    expect(record.slow.map(item => [item.id, item.owner])).toEqual([["packages/demo/src/slow.test.ts", "demo"]]);
    expect(record.slow[0]!.seconds).toBeGreaterThan(0.6);
    expect(result.message).toMatch(/^slow:\n {2}packages\/demo\/src\/slow\.test\.ts \d+(\.\d)?s alone \(owner demo\)$/m);
    const entries = readdirSync(join(repo, "clossys", "agents", "producer", "queue.report", "entries"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("report-agent-demo-gap");
    expect(record.requests).toHaveLength(1);
    expect(result.exitCode).toBe(0);
  });

  it("fast json record matches the printed verdict", async () => {
    const { repo } = world();
    commit(repo, "touch sum", { "packages/demo/src/sum.ts": `// json\n${SUM}` });
    const result = await runCli(["check", "--fast", "--base", "main", "--json"], repo);
    const record = result.output as FastRecord;
    expect(record.schema).toBe("clossys.fast-check/1");
    expect(record.owner_agent).toBe("reviewer");
    expect(record.verdict).toBe("FAST PASS");
    expect(record.line).toBe(`FAST PASS ${git(repo, "rev-parse", "HEAD")}`);
    expect(result.message).toBe(formatFast(record));
    expect(result.message.split("\n").at(-1)).toBe(record.line);
    expect(record.steps.map(step => step.line)).toEqual(result.message.split("\n").filter(line => /^(typecheck|related|alone):/.test(line)));
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it("fast runs root node tests for a scripts-only diff", async () => {
    const { repo } = world();
    const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    manifest.scripts["check:tool-strict"] = "node scripts/check-tool.mjs --strict";
    commit(repo, "scripts", { "scripts/tool.mjs": "// doubled\nexport const twice = (n) => n * 2;\n", "docs/contracts/tool.json": "{ \"ok\": true, \"v\": 2 }\n", "package.json": JSON.stringify(manifest, null, 2) });
    const record = await runFast({ repo, base: "main" });
    expect(record.packages).toEqual([]);
    expect(ran(record, "typecheck")).toEqual([]);
    // The sibling test of the changed script, the root check that reads the changed contract, and the npm script the
    // manifest change added.
    expect(ran(record, "related").map(command => command.run).sort()).toEqual(["node --test scripts/tool.test.mjs", "node scripts/check-tool.mjs", "node scripts/check-tool.mjs --strict"]);
    expect(record.verdict).toBe("FAST PASS");
  });

  it("fast fails a non-empty diff that ran nothing", async () => {
    const { repo } = world();
    commit(repo, "docs", { "README.md": "# fixture, reworded\n" });
    const record = await runFast({ repo, base: "main" });
    expect(record.changed).toEqual(["README.md"]);
    expect(record.commands).toEqual([]);
    expect(record.verdict).toBe("FAST FAIL");
    expect(record.reason).toContain("nothing checked is never a pass");
  });

  it("check --help documents --fast, --base, --json and --file-requests", async () => {
    const result = await runCli(["check", "--help"], tmpdir());
    expect(result.exitCode).toBe(0);
    for (const flag of ["check --fast", "--base <ref>", "--json", "--file-requests"]) expect(result.message).toContain(flag);
    expect(result.message).toContain("FAST INCOMPLETE <sha>");
  });

  it("fast is incomplete past its budget and lists the files left unrun", async () => {
    const { repo } = world();
    commit(repo, "touch both", { "packages/demo/src/sum.ts": `// budget\n${SUM}`, "scripts/tool.mjs": "// budget\nexport const twice = (n) => n * 2;\n" });
    const record = await runFast({ repo, base: "main", budgetMs: 1 });
    expect(record.verdict).toBe("FAST INCOMPLETE");
    expect(record.unrun.length).toBeGreaterThan(0);
    expect(record.steps.find(step => step.step === "related")!.status).toBe("incomplete");
    expect(record.line).toBe(`FAST INCOMPLETE ${git(repo, "rev-parse", "HEAD")}`);
  });
});
