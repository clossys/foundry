import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateCiConventions } from "../../controller/src/conventions/ci-conventions.js";
import { evaluateStarter, isNormalizedRelativePath, validateStarterRequest } from "../../starter/src/core.js";
import { matchesPathPattern } from "./change-set-contract.js";
import {
  OWNED_PATH_PATTERNS,
  renderAdoptionEvidenceWorkflow,
  renderPathScopeScript,
  renderPathScopeWorkflow,
  renderSnapshotCollector,
} from "./setup-template-scripts.js";

// The renderers are pure. Everything below that runs a script writes it to a
// scratch directory and executes it with the real `node`; the path-scope
// script also runs against a real temporary git repository.

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const UPLOAD = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7";

// ---------------------------------------------------------------------------
// Owned patterns
// ---------------------------------------------------------------------------

describe("OWNED_PATH_PATTERNS", () => {
  it("is exactly the change-set contract's owned-pattern enum, in order", () => {
    const contract = JSON.parse(readFileSync(new URL("../../../docs/contracts/repository-change-set.json", import.meta.url), "utf8")) as {
      definitions: { ownedPattern: { allOf: Array<{ enum?: string[] }> } };
    };
    expect(contract.definitions.ownedPattern.allOf[1]?.enum).toBeDefined();
    expect([...OWNED_PATH_PATTERNS]).toEqual(contract.definitions.ownedPattern.allOf[1]!.enum);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("every renderer returns identical text on repeated calls", () => {
    for (const render of [renderSnapshotCollector, renderAdoptionEvidenceWorkflow, renderPathScopeScript, renderPathScopeWorkflow]) {
      const first = render();
      expect(typeof first).toBe("string");
      expect(render()).toBe(first);
      expect(render.length).toBe(0);
    }
  });

  it("the module has no import lines at all", () => {
    const source = readFileSync(new URL("./setup-template-scripts.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/mu);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bimport\s*\(/u);
  });
});

// ---------------------------------------------------------------------------
// The path-scope script: text
// ---------------------------------------------------------------------------

describe("renderPathScopeScript text", () => {
  const script = renderPathScopeScript();

  it("ends in exactly one LF", () => {
    expect(script.endsWith("\n")).toBe(true);
    expect(script.endsWith("\n\n")).toBe(false);
  });

  it("evaluates and loads nothing, and imports only node:child_process", () => {
    expect(script).not.toContain("require(");
    expect(script).not.toContain("import(");
    expect(script).not.toMatch(/\beval\b/u);
    expect(script).not.toContain("new Function");
    expect(script).not.toContain("${");
    expect(script).not.toContain("`");
    expect(script.match(/\bimport\b/gu)).toHaveLength(1);
    expect([...script.matchAll(/from\s+"([^"]+)"/gu)].map((m) => m[1])).toEqual(["node:child_process"]);
    expect(script).not.toContain("CLOSSYS_PATH_SCOPE");
  });

  it("embeds the owned patterns as JSON", () => {
    expect(script).toContain(JSON.stringify([...OWNED_PATH_PATTERNS], null, 2));
  });
});

// ---------------------------------------------------------------------------
// The path-scope script: the matcher port
// ---------------------------------------------------------------------------

// The script keeps its matcher between two marker comments at top level. This
// test evaluates just that block with `new Function` (test only) and compares
// it to the real matchesPathPattern on a corpus. That is simpler and far
// faster than deciding each pair through a git repository and an exit code;
// the end-to-end tests below cover the same matcher through the script's exit.

function extractMatcher(script: string): (path: string, pattern: string) => boolean {
  const begin = script.indexOf("// matcher:begin\n");
  const end = script.indexOf("// matcher:end\n");
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const block = script.slice(begin, end);
  return new Function(`${block}\nreturn matches;`)() as (path: string, pattern: string) => boolean;
}

const CORPUS = [
  "",
  "clossys",
  "clossys/",
  "clossys/a",
  "clossys/a/b/c.json",
  "clossys/.state/x",
  "clossys/.state/installed.json",
  "clossysx/a",
  "Clossys/a",
  ".agents/skills/clossys-writer/SKILL.md",
  ".agents/skills/clossys-writer",
  ".agents/skills/clossys-writer/deep/er/x",
  ".agents/skills/clossys-/x",
  ".agents/skills/clossys/x",
  ".agents/skills/other/x",
  ".agents/skills/clossys-writer/",
  ".claude/skills/clossys-writer",
  ".claude/skills/clossys-writer/x",
  ".claude/skills/clossys-",
  ".claude/skills/clossys",
  ".claude/skills/other",
  ".cursor/skills/clossys-reviewer",
  ".cursor/skills/clossys-reviewer/x",
  ".github/workflows/clossys-ci.yml",
  ".github/workflows/clossys-",
  ".github/workflows/clossys-x/y.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/other.yml",
  ".github/workflows/Clossys-ci.yml",
  ".github/scripts/clossys-collect-adoption-snapshot.mjs",
  ".github/scripts/other.mjs",
  ".github/scripts/clossys-x/y.mjs",
  "AGENTS.md",
  "CLAUDE.md",
  "agents.md",
  "docs/AGENTS.md",
  ".starter/request.json",
  ".starter/request.json/x",
  ".starter/other.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
  "apps/x/package.json",
  "a/repository-profile.json",
  "repository-profile.json",
  "x/y/repository-declaration.json",
  "repository-declaration.json",
  "a/b/c/repository-profile.json",
  "repository-profile.json/x",
  "my-repository-profile.json",
  "src/app.ts",
  "apps/x/index.ts",
  "clossys-evil.txt",
  "../x",
  "./a",
  "a/./b",
  "a//b",
  "a/../b",
  "/abs/path",
  "clossys\\a",
  "clossys/a\nb",
  "clossys/\u0001",
  "clossys/\u007f",
  "clossys/é/ü",
  "-clossys/x",
  "a/.../b",
  "**",
  "*",
];
const EXTRA_PATTERNS = ["**", "*", "**/*", "a/**b", "a**", "src/**/x.ts", "a/*/c", "*.md", "a/**/**/b", "", "../x", "/x", "clossys/*", "*/x", "**/x/**"];

describe("the script's matcher is a faithful port of matchesPathPattern", () => {
  const matches = extractMatcher(renderPathScopeScript());
  const patterns = [...OWNED_PATH_PATTERNS, ...EXTRA_PATTERNS];

  it("has a corpus of at least 60 paths", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(60);
  });

  it("agrees on every path against every owned pattern and the extra patterns", () => {
    const disagreements: string[] = [];
    let trueCount = 0;
    for (const path of CORPUS) {
      for (const pattern of patterns) {
        const expected = matchesPathPattern(path, pattern);
        if (expected) trueCount += 1;
        if (matches(path, pattern) !== expected) disagreements.push(JSON.stringify([path, pattern, expected]));
      }
    }
    expect(disagreements).toEqual([]);
    expect(trueCount).toBeGreaterThan(40);
  });

  it("matches the specific cases the contract cares about", () => {
    expect(matches("clossys/a", "clossys/**")).toBe(true);
    expect(matches("clossys", "clossys/**")).toBe(true);
    expect(matches("clossys/", "clossys/**")).toBe(false);
    expect(matches(".agents/skills/clossys-writer/SKILL.md", ".agents/skills/clossys-*/**")).toBe(true);
    expect(matches(".claude/skills/clossys-writer/x", ".claude/skills/clossys-*")).toBe(false);
    expect(matches("repository-profile.json", "**/repository-profile.json")).toBe(true);
    expect(matches("../x", "**/repository-profile.json")).toBe(false);
    expect(matches("", "clossys/**")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The path-scope script: end to end against a real git repository
// ---------------------------------------------------------------------------

const HEAD_REF = "clossys/apply-abc123def456";
const HEX40 = /^[0-9a-f]{40}$/u;

function cleanGitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

interface Repo {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
  git(...args: string[]): string;
  write(files: Record<string, string | null>): void;
  commit(message: string): string;
}

function newRepo(baseFiles: Record<string, string>): Repo {
  const dir = tempDir("scope-fixture-");
  const home = tempDir("scope-home-");
  const env = cleanGitEnv(home);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (files: Record<string, string | null>) => {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      if (content === null) {
        rmSync(full, { force: true });
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      rmSync(full, { force: true });
      writeFileSync(full, content);
    }
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  write(baseFiles);
  commit("base");
  return { dir, env, git, write, commit };
}

function ledgerText(files: readonly string[], extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ files: files.map((path) => ({ path })), keys: [], entries: [], ...extra }, null, 2)}\n`;
}
const LEDGER = "clossys/.state/installed.json";

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly all: string;
}

function runScope(cwd: string, env: Record<string, string | undefined>, home: string): Outcome {
  const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) clean[key] = value;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], { cwd, input: renderPathScopeScript(), env: clean, encoding: "utf8", timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, all: `${result.stdout}${result.stderr}` };
}

interface Scenario {
  readonly base?: Record<string, string>;
  /** Head changes, applied on the apply branch. null deletes. */
  readonly head: Record<string, string | null>;
  readonly ledgerNames?: readonly string[];
  /** Overrides the ledger file's text; null means no ledger in the head. */
  readonly ledger?: string | null;
  readonly advanceBase?: boolean;
  readonly env?: Record<string, string | undefined>;
}

function scenario(spec: Scenario): Outcome & { readonly base: string; readonly head: string; readonly repo: Repo } {
  const repo = newRepo({ "README.md": "base\n", ...(spec.base ?? {}) });
  const base = repo.git("rev-parse", "HEAD");
  repo.git("checkout", "-q", "-b", HEAD_REF);
  repo.write(spec.head);
  const ledger = spec.ledger === undefined ? ledgerText(spec.ledgerNames ?? []) : spec.ledger;
  repo.write({ [LEDGER]: ledger });
  const head = repo.commit("head");
  let baseForDiff = base;
  if (spec.advanceBase === true) {
    repo.git("checkout", "-q", "main");
    repo.write({ "src/main-only.ts": "main only\n" });
    baseForDiff = repo.commit("main advances");
    repo.git("checkout", "-q", HEAD_REF);
  }
  const outcome = runScope(repo.dir, { HEAD_REF, BASE_SHA: baseForDiff, HEAD_SHA: head, ...(spec.env ?? {}) }, tempDir("scope-run-home-"));
  return { ...outcome, base: baseForDiff, head, repo };
}

describe("path-scope script, end to end", () => {
  it("passes when every changed path is owned and named", () => {
    const result = scenario({
      head: { "clossys/brief.json": "{}\n", "clossys/notes/a.md": "a\n", ".starter/request.json": "{}\n", "AGENTS.md": "pointer\n" },
      ledgerNames: ["clossys/brief.json", "clossys/notes/a.md", ".starter/request.json", "AGENTS.md"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("path-scope: 5 path(s) checked");
  });

  it("does not require the ledger, package.json or the lockfiles to be named", () => {
    const result = scenario({
      base: { "package.json": "{}\n", "package-lock.json": "{}\n", "pnpm-lock.yaml": "a: 1\n" },
      head: { "package.json": '{"a":1}\n', "package-lock.json": '{"a":1}\n', "pnpm-lock.yaml": "a: 2\n" },
      ledgerNames: [],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("path-scope: 4 path(s) checked");
  });

  it("still requires yarn.lock, .yarnrc.yml and pnpm-workspace.yaml to be named", () => {
    const unnamed = scenario({ head: { "yarn.lock": "x\n", ".yarnrc.yml": "x\n", "pnpm-workspace.yaml": "x\n" }, ledgerNames: [] });
    expect(unnamed.status).toBe(1);
    for (const path of ["yarn.lock", ".yarnrc.yml", "pnpm-workspace.yaml"]) expect(unnamed.all).toContain(`not-named-by-ledger: ${path}`);
    const named = scenario({ head: { "yarn.lock": "x\n", ".yarnrc.yml": "x\n", "pnpm-workspace.yaml": "x\n" }, ledgerNames: ["yarn.lock", ".yarnrc.yml", "pnpm-workspace.yaml"] });
    expect(named.status).toBe(0);
  });

  it("names a path through the ledger's entries and keys rows too", () => {
    const result = scenario({
      head: { "pnpm-workspace.yaml": "x\n", ".yarnrc.yml": "x\n" },
      ledger: ledgerText([], { entries: [{ file: "pnpm-workspace.yaml", key: "k", value: "v" }], keys: [{ file: ".yarnrc.yml", pointer: "/p", value: "1" }] }),
    });
    expect(result.status).toBe(0);
  });

  it("reports every unowned path with outside-owned-scope and exits 1", () => {
    const unowned = ["src/app.ts", ".github/workflows/ci.yml", ".github/workflows/other.yml", "clossys-evil.txt", "apps/x/index.ts"];
    const head: Record<string, string> = {};
    for (const path of unowned) head[path] = "x\n";
    const result = scenario({ head, ledgerNames: unowned });
    expect(result.status).toBe(1);
    for (const path of unowned) expect(result.all).toContain(`outside-owned-scope: ${path}`);
    expect(result.all).toContain("5 finding(s) in 6 changed path(s)");
  });

  it("reports an owned path the ledger does not name with not-named-by-ledger", () => {
    const result = scenario({
      head: { "clossys/brief.json": "{}\n", "clossys/named.json": "{}\n", ".agents/skills/clossys-writer/SKILL.md": "s\n" },
      ledgerNames: ["clossys/named.json", ".agents/skills/clossys-writer/SKILL.md"],
    });
    expect(result.status).toBe(1);
    expect(result.all).toContain("not-named-by-ledger: clossys/brief.json");
    expect(result.all).not.toContain("not-named-by-ledger: clossys/named.json");
    expect(result.all).not.toContain("outside-owned-scope");
  });

  it("handles a discovery link (a symlink) named or not", () => {
    const build = (names: readonly string[]) => {
      const repo = newRepo({ "README.md": "base\n" });
      const base = repo.git("rev-parse", "HEAD");
      repo.git("checkout", "-q", "-b", HEAD_REF);
      repo.write({ ".agents/skills/clossys-writer/SKILL.md": "s\n", [LEDGER]: ledgerText(names) });
      mkdirSync(join(repo.dir, ".claude/skills"), { recursive: true });
      symlinkSync("../../.agents/skills/clossys-writer", join(repo.dir, ".claude/skills/clossys-writer"));
      const head = repo.commit("head");
      return runScope(repo.dir, { HEAD_REF, BASE_SHA: base, HEAD_SHA: head }, tempDir("scope-run-home-"));
    };
    const unnamed = build([".agents/skills/clossys-writer/SKILL.md"]);
    expect(unnamed.status).toBe(1);
    expect(unnamed.all).toContain("not-named-by-ledger: .claude/skills/clossys-writer");
    const named = build([".agents/skills/clossys-writer/SKILL.md", ".claude/skills/clossys-writer"]);
    expect(named.status).toBe(0);
  });

  it("AGENTS.md is owned: named passes, unnamed fails", () => {
    expect(scenario({ head: { "AGENTS.md": "a\n" }, ledgerNames: ["AGENTS.md"] }).status).toBe(0);
    const unnamed = scenario({ head: { "AGENTS.md": "a\n" }, ledgerNames: [] });
    expect(unnamed.status).toBe(1);
    expect(unnamed.all).toContain("not-named-by-ledger: AGENTS.md");
  });

  it("counts a deletion outside scope", () => {
    const result = scenario({ base: { "src/app.ts": "x\n" }, head: { "src/app.ts": null }, ledgerNames: [] });
    expect(result.status).toBe(1);
    expect(result.all).toContain("outside-owned-scope: src/app.ts");
  });

  it("refuses a path with a newline and never prints the newline raw", () => {
    const result = scenario({ head: { "src/evil\nname.ts": "x\n" }, ledgerNames: [] });
    expect(result.status).toBe(1);
    expect(result.all).toContain("outside-owned-scope: src/evil?name.ts");
    expect(result.all).not.toContain("evil\n");
    expect(result.all).not.toContain("\nname.ts");
  });

  it("sanitises other control characters and refuses a leading-dash path", () => {
    const result = scenario({ head: { "-rf.txt": "x\n", "src/esc\u001b[31m.ts": "x\n" }, ledgerNames: [] });
    expect(result.status).toBe(1);
    expect(result.all).toContain("outside-owned-scope: -rf.txt");
    expect(result.all).toContain("outside-owned-scope: src/esc?[31m.ts");
    expect(result.all).not.toContain("\u001b");
  });

  it("caps the printed findings at 50 and prints a count line", () => {
    const head: Record<string, string> = {};
    for (let index = 0; index < 60; index += 1) head[`src/f${String(index).padStart(2, "0")}.ts`] = "x\n";
    const result = scenario({ head, ledgerNames: [] });
    expect(result.status).toBe(1);
    // 60 unowned and unnamed paths give 120 findings; only 50 lines print.
    expect(result.stderr.split("\n").filter((line) => line.startsWith("outside-owned-scope: ") || line.startsWith("not-named-by-ledger: "))).toHaveLength(50);
    expect(result.stderr).toContain("120 finding(s) in 61 changed path(s); first 50 shown");
  });

  it("passes an empty diff on an apply head", () => {
    const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
    const sha = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "-b", HEAD_REF);
    const result = runScope(repo.dir, { HEAD_REF, BASE_SHA: sha, HEAD_SHA: sha }, tempDir("scope-run-home-"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("path-scope: 0 path(s) checked");
  });

  it("still refuses an empty diff when the ledger is unreadable", () => {
    const repo = newRepo({ "README.md": "base\n" });
    const sha = repo.git("rev-parse", "HEAD");
    const result = runScope(repo.dir, { HEAD_REF, BASE_SHA: sha, HEAD_SHA: sha }, tempDir("scope-run-home-"));
    expect(result.status).toBe(2);
  });

  it("diffs three-dot: a base that advanced does not add the base's own changes", () => {
    const result = scenario({ head: { "clossys/brief.json": "{}\n" }, ledgerNames: ["clossys/brief.json"], advanceBase: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("path-scope: 2 path(s) checked");
    expect(result.all).not.toContain("main-only");
  });

  it("lists both sides of a rename to an unowned path", () => {
    const result = scenario({ base: { "clossys/x.md": "same content\nsecond line\nthird line\n" }, head: { "clossys/x.md": null, "src/x.md": "same content\nsecond line\nthird line\n" }, ledgerNames: ["clossys/x.md"] });
    expect(result.status).toBe(1);
    expect(result.all).toContain("outside-owned-scope: src/x.md");
    expect(result.all).toContain("3 changed path(s)");
  });

  it("checks the edited workflow files as unowned unless named clossys-*", () => {
    const result = scenario({ head: { ".github/workflows/clossys-ci.yml": "a\n", ".github/workflows/ci.yml": "b\n" }, ledgerNames: [".github/workflows/clossys-ci.yml"] });
    expect(result.status).toBe(1);
    expect(result.all).toContain("outside-owned-scope: .github/workflows/ci.yml");
    expect(result.all).not.toContain("outside-owned-scope: .github/workflows/clossys-ci.yml");
  });

  describe("head ledger refusals exit 2 and never read as empty", () => {
    const cases: Array<[string, string | null]> = [
      ["absent", null],
      ["not JSON", "not json{"],
      ["empty", ""],
      ["a JSON array", "[]\n"],
      ["JSON null", "null\n"],
      ["files not an array", '{"files":{}}\n'],
      ["files missing", "{}\n"],
      ["a row with a non-string path", '{"files":[{"path":1}]}\n'],
      ["a row that is not an object", '{"files":["clossys/a"]}\n'],
      ["entries present but not an array", '{"files":[],"entries":{}}\n'],
      ["keys present but not an array", '{"files":[],"keys":"x"}\n'],
      ["entries null", '{"files":[],"entries":null}\n'],
      ["an entries row with no string file", '{"files":[],"entries":[{"file":3}]}\n'],
      ["a keys row with no string file", '{"files":[],"keys":[{}]}\n'],
      ["a UTF-8 byte-order mark", `﻿${ledgerText([])}`],
    ];
    for (const [label, text] of cases) {
      it(label, () => {
        const result = scenario({ head: { "clossys/brief.json": "{}\n" }, ledger: text, ledgerNames: ["clossys/brief.json"] });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("path-scope: refused");
        expect(result.stderr).not.toMatch(/\n\s+at /u);
      });
    }

    it("a ledger that is a symlink", () => {
      const repo = newRepo({ "README.md": "base\n", "elsewhere.json": ledgerText([]) });
      const base = repo.git("rev-parse", "HEAD");
      repo.git("checkout", "-q", "-b", HEAD_REF);
      mkdirSync(join(repo.dir, "clossys/.state"), { recursive: true });
      symlinkSync("../../elsewhere.json", join(repo.dir, LEDGER));
      const head = repo.commit("head");
      const result = runScope(repo.dir, { HEAD_REF, BASE_SHA: base, HEAD_SHA: head }, tempDir("scope-run-home-"));
      expect(result.status).toBe(2);
    });

    it("a ledger present in the base but deleted in the head", () => {
      const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
      const base = repo.git("rev-parse", "HEAD");
      repo.git("checkout", "-q", "-b", HEAD_REF);
      repo.write({ [LEDGER]: null });
      const head = repo.commit("head");
      const result = runScope(repo.dir, { HEAD_REF, BASE_SHA: base, HEAD_SHA: head }, tempDir("scope-run-home-"));
      expect(result.status).toBe(2);
    });
  });

  describe("input refusals", () => {
    const shaInputs: Array<[string, string]> = [
      ["uppercase hex", "A".repeat(40)],
      ["39 characters", "a".repeat(39)],
      ["41 characters", "a".repeat(41)],
      ["a ref name", "HEAD"],
      ["empty", ""],
      ["trailing newline", `${"a".repeat(40)}\n`],
      ["a range", `${"a".repeat(40)}..${"b".repeat(40)}`],
    ];
    for (const [label, bad] of shaInputs) {
      it(`BASE_SHA ${label} exits 2`, () => {
        const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
        const sha = repo.git("rev-parse", "HEAD");
        expect(runScope(repo.dir, { HEAD_REF, BASE_SHA: bad, HEAD_SHA: sha }, tempDir("scope-run-home-")).status).toBe(2);
      });
      it(`HEAD_SHA ${label} exits 2`, () => {
        const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
        const sha = repo.git("rev-parse", "HEAD");
        expect(runScope(repo.dir, { HEAD_REF, BASE_SHA: sha, HEAD_SHA: bad }, tempDir("scope-run-home-")).status).toBe(2);
      });
    }

    it("unset SHAs exit 2", () => {
      const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
      expect(runScope(repo.dir, { HEAD_REF }, tempDir("scope-run-home-")).status).toBe(2);
    });

    it("well-formed SHAs that name no commit exit 2", () => {
      const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
      expect(runScope(repo.dir, { HEAD_REF, BASE_SHA: "1".repeat(40), HEAD_SHA: "2".repeat(40) }, tempDir("scope-run-home-")).status).toBe(2);
    });

    it("commits with no merge base exit 2", () => {
      const repo = newRepo({ "README.md": "base\n", [LEDGER]: ledgerText([]) });
      const base = repo.git("rev-parse", "HEAD");
      repo.git("checkout", "-q", "--orphan", "unrelated");
      repo.write({ "other.txt": "x\n", [LEDGER]: ledgerText([]) });
      const head = repo.commit("unrelated root");
      expect(runScope(repo.dir, { HEAD_REF, BASE_SHA: base, HEAD_SHA: head }, tempDir("scope-run-home-")).status).toBe(2);
    });

    it("an apply head outside a git repository exits 2", () => {
      const dir = tempDir("scope-nogit-");
      expect(runScope(dir, { HEAD_REF, BASE_SHA: "a".repeat(40), HEAD_SHA: "b".repeat(40) }, tempDir("scope-run-home-")).status).toBe(2);
    });

    it("unset HEAD_REF exits 2, and so does an empty one", () => {
      const dir = tempDir("scope-nogit-");
      const home = tempDir("scope-run-home-");
      const unset = runScope(dir, {}, home);
      expect(unset.status).toBe(2);
      expect(unset.stderr).toContain("HEAD_REF");
      expect(runScope(dir, { HEAD_REF: "" }, home).status).toBe(2);
    });
  });

  describe("head references that are not apply branches", () => {
    it("feature/x passes with a notice and needs no git or SHAs", () => {
      const dir = tempDir("scope-nogit-");
      const result = runScope(dir, { HEAD_REF: "feature/x" }, tempDir("scope-run-home-"));
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(result.stdout).toContain("not a Clossys apply pull request");
      expect(result.stderr).toBe("");
    });

    it("does not echo the branch name", () => {
      const dir = tempDir("scope-nogit-");
      const result = runScope(dir, { HEAD_REF: "evil\n::error::injected" }, tempDir("scope-run-home-"));
      expect(result.status).toBe(0);
      expect(result.all).not.toContain("injected");
    });

    // The match is a plain, case-sensitive startsWith("clossys/apply-").
    for (const ref of ["clossys/apply", "Clossys/apply-x", "clossys-apply-x", "xclossys/apply-x", " clossys/apply-x", "refs/heads/clossys/apply-x", "clossys/Apply-x", "main"]) {
      it(`${JSON.stringify(ref)} is not an apply branch`, () => {
        const result = runScope(tempDir("scope-nogit-"), { HEAD_REF: ref }, tempDir("scope-run-home-"));
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("not a Clossys apply pull request");
      });
    }

    for (const ref of ["clossys/apply-", "clossys/apply-x", "clossys/apply-abc/def", "clossys/apply-../x"]) {
      it(`${JSON.stringify(ref)} is checked, and refuses without SHAs`, () => {
        const result = runScope(tempDir("scope-nogit-"), { HEAD_REF: ref }, tempDir("scope-run-home-"));
        expect(result.status).toBe(2);
        expect(result.stdout).not.toContain("not a Clossys apply pull request");
      });
    }
  });

  it("built repositories use real 40-hex commits", () => {
    const result = scenario({ head: {}, ledgerNames: [] });
    expect(result.base).toMatch(HEX40);
    expect(result.head).toMatch(HEX40);
  });
});

// ---------------------------------------------------------------------------
// The snapshot collector
// ---------------------------------------------------------------------------

const ALLOWED_ENV_NAMES = ["BASE_SHA", "HEAD_SHA", "PR_NUMBER", "REPOSITORY", "RUN_ID"];
const SHA_BASE = "b".repeat(40);
const SHA_HEAD = "c".repeat(40);
const integrity = `sha512-${"a".repeat(85)}A==`;
const starterPackage = { name: "@clossys/starter", version: "0.1.0", integrity, bin: "foundry-starter" };
const advisorPackage = { name: "@clossys/advisor", version: "0.1.3", integrity, bin: "advisor-execution-readiness" };
const targetPackage = { name: "@fixture/starter-target", version: "1.2.3", integrity, bin: "target-check", invocation: "single-json-input" };
const ASSESSMENT = "evidence/assessment.json";
const TARGET_INPUT = "evidence/target-input.json";

function starterRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    phase: "activation",
    packageManager: "npm",
    snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 },
    starter: starterPackage,
    advisor: advisorPackage,
    target: targetPackage,
    evidence: { assessment: ASSESSMENT, targetInput: TARGET_INPUT },
    ...overrides,
  };
}

const ASSESSMENT_BYTES = Buffer.from([0x7b, 0x22, 0xc3, 0xa9, 0x22, 0x3a, 0x31, 0x7d, 0x0a]);
const TARGET_BYTES = Buffer.from('{"target":true}\r\n', "utf8");

interface Workspace {
  readonly dir: string;
  readonly out: string;
  readonly script: string;
}

function workspace(options: { request?: unknown; requestText?: string; evidence?: Record<string, Buffer | null> } = {}): Workspace {
  const dir = tempDir("collect-");
  mkdirSync(join(dir, ".starter"), { recursive: true });
  writeFileSync(join(dir, ".starter/request.json"), options.requestText ?? `${JSON.stringify(options.request ?? starterRequest(), null, 2)}\n`);
  const evidence = options.evidence ?? { [ASSESSMENT]: ASSESSMENT_BYTES, [TARGET_INPUT]: TARGET_BYTES };
  for (const [path, content] of Object.entries(evidence)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const script = join(tempDir("collect-script-"), "clossys-collect-adoption-snapshot.mjs");
  writeFileSync(script, renderSnapshotCollector());
  return { dir, out: join(dir, "out", "snapshot"), script };
}

const GOOD_ENV: Record<string, string> = {
  REPOSITORY: "consumer/repository",
  PR_NUMBER: "42",
  BASE_SHA: SHA_BASE,
  HEAD_SHA: SHA_HEAD,
  RUN_ID: "123456789",
};

function runCollector(ws: Workspace, options: { args?: string[]; env?: Record<string, string | undefined>; extraEnv?: Record<string, string> } = {}): Outcome {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...(options.extraEnv ?? {}) };
  for (const [key, value] of Object.entries({ ...GOOD_ENV, ...(options.env ?? {}) })) if (value !== undefined) env[key] = value;
  const args = options.args ?? [".starter/request.json", ws.out];
  const result = spawnSync(process.execPath, [ws.script, ...args], { cwd: ws.dir, env, encoding: "utf8", timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, all: `${result.stdout}${result.stderr}` };
}

function listTree(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const child = relative === "" ? name : `${relative}/${name}`;
      if (lstatSync(join(root, child)).isDirectory()) walk(child);
      else found.push(child);
    }
  };
  walk("");
  return found;
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

describe("renderSnapshotCollector text", () => {
  const script = renderSnapshotCollector();

  it("is an ESM script that ends in one LF and imports only node: builtins", () => {
    expect(script.endsWith("\n")).toBe(true);
    expect(script.endsWith("\n\n")).toBe(false);
    const specifiers = [...script.matchAll(/^import\s[^;]*?from\s+"([^"]+)";$/gmu)].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:[a-z/]+$/u);
    expect(script.match(/\bimport\b/gu)).toHaveLength(specifiers.length);
    expect(script).not.toContain("require(");
    expect(script).not.toContain("import(");
    expect(script).not.toMatch(/\beval\b/u);
    expect(script).not.toContain("new Function");
  });

  it("starts no process, makes no network call, and reads exactly five environment names", () => {
    expect(script).not.toMatch(/child_process|spawn|exec\(|execFile|fetch\(|node:https?|node:net|node:dns/u);
    expect(script.match(/process\.env/gu)).toHaveLength(1);
    expect([...script.matchAll(/\benv\("([A-Z_]+)"\)/gu)].map((m) => m[1]!).sort()).toEqual(ALLOWED_ENV_NAMES);
    expect(script).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|GH_[A-Z_]*TOKEN|GITHUB_TOKEN|secrets\./u);
    expect(script).not.toContain("${");
  });

  it("says it is consumer-owned, uncredentialed, and never trusted by the decision job", () => {
    const header = script.split("\n").filter((line) => line.startsWith("//")).join("\n");
    expect(header).toMatch(/consumer-owned/iu);
    expect(header).toMatch(/uncredentialed/iu);
    expect(header).toMatch(/never reads or trusts/iu);
    expect(header).toMatch(/pull request controls/iu);
  });
});

describe("snapshot collector, executed", () => {
  it("copies exactly the two evidence files and writes a manifest in the specified order", () => {
    const ws = workspace();
    const before = Date.now();
    const result = runCollector(ws);
    const after = Date.now();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(listTree(ws.out)).toEqual([ASSESSMENT, TARGET_INPUT, "snapshot.json"]);
    expect(readFileSync(join(ws.out, ASSESSMENT)).equals(ASSESSMENT_BYTES)).toBe(true);
    expect(readFileSync(join(ws.out, TARGET_INPUT)).equals(TARGET_BYTES)).toBe(true);

    const text = readFileSync(join(ws.out, "snapshot.json"), "utf8");
    const manifest = JSON.parse(text) as Record<string, unknown> & { files: Array<{ path: string; size: number; sha256: string }> };
    expect(text).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(Object.keys(manifest)).toEqual([
      "schemaVersion",
      "provider",
      "eventName",
      "repository",
      "pullRequestNumber",
      "baseSha",
      "headSha",
      "workflowRunId",
      "artifactName",
      "digest",
      "capturedAt",
      "files",
    ]);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      provider: "github-actions",
      eventName: "pull_request",
      repository: "consumer/repository",
      pullRequestNumber: 42,
      baseSha: SHA_BASE,
      headSha: SHA_HEAD,
      workflowRunId: "123456789",
      artifactName: "adoption-snapshot-123456789",
    });
    const captured = Date.parse(manifest.capturedAt as string);
    expect(new Date(captured).toISOString()).toBe(manifest.capturedAt);
    expect(captured).toBeGreaterThanOrEqual(before - 1000);
    expect(captured).toBeLessThanOrEqual(after + 1000);

    expect(manifest.files).toEqual([
      { path: ASSESSMENT, size: ASSESSMENT_BYTES.length, sha256: sha256(ASSESSMENT_BYTES) },
      { path: TARGET_INPUT, size: TARGET_BYTES.length, sha256: sha256(TARGET_BYTES) },
    ]);
    for (const file of manifest.files) expect(Object.keys(file)).toEqual(["path", "size", "sha256"]);

    // The digest is the SHA-256 of the two-space JSON of the manifest without
    // its digest member, in the same member order.
    const { digest, ...rest } = manifest;
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest).toBe(sha256(JSON.stringify(rest, null, 2)));
  });

  it("sorts files by path regardless of the order the request names them", () => {
    const request = starterRequest({ evidence: { assessment: "z/assessment.json", targetInput: "a/target-input.json" } });
    const ws = workspace({ request, evidence: { "z/assessment.json": Buffer.from("{}\n"), "a/target-input.json": Buffer.from("{}\n") } });
    expect(runCollector(ws).status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(ws.out, "snapshot.json"), "utf8")) as { files: Array<{ path: string }> };
    expect(manifest.files.map((file) => file.path)).toEqual(["a/target-input.json", "z/assessment.json"]);
  });

  it("accepts a pre-existing empty output directory and evidence of exactly 524288 bytes", () => {
    const ws = workspace({ evidence: { [ASSESSMENT]: Buffer.alloc(524_288, 0x20), [TARGET_INPUT]: TARGET_BYTES } });
    mkdirSync(ws.out, { recursive: true });
    const result = runCollector(ws);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(ws.out, "snapshot.json"), "utf8")) as { files: Array<{ path: string; size: number }> };
    expect(manifest.files.find((file) => file.path === ASSESSMENT)?.size).toBe(524_288);
  });

  it("produces a directory Starter's own snapshot checks accept", () => {
    // node-runtime.ts cannot be imported here (it needs a generated file this
    // package does not build), and its snapshot reader is not exported. So the
    // manifest goes through Starter's real pure evaluator, and the directory
    // read replicates snapshotFromDirectory: normalized path, regular
    // non-symlink file, bounded size, size and SHA-256 agreement.
    const ws = workspace();
    expect(runCollector(ws).status).toBe(0);
    const request = starterRequest();
    const parsed = validateStarterRequest(request);
    expect(parsed.findings).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(ws.out, "snapshot.json"), "utf8")) as { capturedAt: string; files: Array<{ path: string; size: number; sha256: string }>; baseSha: string; headSha: string; workflowRunId: string; artifactName: string };
    for (const path of [ASSESSMENT, TARGET_INPUT]) {
      const entry = manifest.files.find((file) => file.path === path);
      expect(isNormalizedRelativePath(path)).toBe(true);
      expect(lstatSync(join(ws.out, path)).isFile()).toBe(true);
      expect(lstatSync(join(ws.out, path)).isSymbolicLink()).toBe(false);
      const content = readFileSync(join(ws.out, path));
      expect(content.length).toBeLessThanOrEqual(524_288);
      expect(entry?.size).toBe(content.length);
      expect(entry?.sha256).toBe(sha256(content));
    }
    const process = (state: "satisfied", at?: string) => ({ attempted: true, exitCode: 0, stdout: JSON.stringify({ state }), ...(at === undefined ? {} : { currentAsOf: at }) });
    const event = {
      schemaVersion: 1,
      provider: "github-actions",
      eventName: "workflow_run",
      repository: "consumer/repository",
      baseSha: manifest.baseSha,
      sourceWorkflowRunId: manifest.workflowRunId,
      sourceHeadSha: manifest.headSha,
      artifactName: manifest.artifactName,
      sourceConclusion: "success",
    };
    const report = evaluateStarter({
      request,
      snapshot: manifest,
      trustedEvent: event,
      install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 0 },
      now: manifest.capturedAt,
      advisor: process("satisfied", manifest.capturedAt),
      target: process("satisfied"),
    } as unknown as Parameters<typeof evaluateStarter>[0]);
    expect(report.findings.filter((finding) => finding.rule.startsWith("snapshot"))).toEqual([]);
    expect(report.state).toBe("satisfied");
  });

  describe("refusals exit 2, name the cause, print no stack, and leave nothing half-written", () => {
    function expectRefused(ws: Workspace, result: Outcome, mention: RegExp, outExisted = false): void {
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(mention);
      expect(result.stderr).not.toMatch(/\n\s+at /u);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      if (outExisted) expect(listTree(ws.out)).toEqual([]);
      else expect(existsSync(ws.out)).toBe(false);
    }

    it("a symlink evidence file", () => {
      const ws = workspace({ evidence: { [ASSESSMENT]: null, [TARGET_INPUT]: TARGET_BYTES } });
      writeFileSync(join(ws.dir, "real.json"), "{}\n");
      symlinkSync("../real.json", join(ws.dir, ASSESSMENT));
      expectRefused(ws, runCollector(ws), /evidence\/assessment\.json.*(symlink|symbolic|regular)/iu);
    });

    it("a symlink to a file outside the working directory", () => {
      const outside = join(tempDir("collect-outside-"), "secret.json");
      writeFileSync(outside, '{"secret":true}\n');
      const ws = workspace({ evidence: { [ASSESSMENT]: null, [TARGET_INPUT]: TARGET_BYTES } });
      symlinkSync(outside, join(ws.dir, ASSESSMENT));
      const result = runCollector(ws);
      expectRefused(ws, result, /evidence\/assessment\.json/u);
      expect(result.all).not.toContain("secret");
    });

    it("a symlinked parent directory", () => {
      const ws = workspace({ evidence: { [TARGET_INPUT]: TARGET_BYTES } });
      const real = join(ws.dir, "elsewhere");
      mkdirSync(real);
      writeFileSync(join(real, "assessment.json"), "{}\n");
      writeFileSync(join(real, "target-input.json"), "{}\n");
      rmSync(join(ws.dir, "evidence"), { recursive: true });
      symlinkSync(real, join(ws.dir, "evidence"));
      expectRefused(ws, runCollector(ws), /evidence\/(assessment|target-input)\.json.*symbolic link/u);
    });

    it("an oversize evidence file (524289 bytes)", () => {
      const ws = workspace({ evidence: { [ASSESSMENT]: Buffer.alloc(524_289, 0x20), [TARGET_INPUT]: TARGET_BYTES } });
      expectRefused(ws, runCollector(ws), /evidence\/assessment\.json.*524288/u);
    });

    it("a missing evidence file", () => {
      const ws = workspace({ evidence: { [ASSESSMENT]: ASSESSMENT_BYTES } });
      expectRefused(ws, runCollector(ws), /evidence\/target-input\.json.*(missing|unreadable)/iu);
    });

    it("an evidence path that is a directory", () => {
      const ws = workspace({ evidence: { [TARGET_INPUT]: TARGET_BYTES } });
      mkdirSync(join(ws.dir, ASSESSMENT), { recursive: true });
      expectRefused(ws, runCollector(ws), /evidence\/assessment\.json.*regular/iu);
    });

    for (const [label, path] of [
      ["dot-dot", "../evil.json"],
      ["embedded dot-dot", "evidence/../../evil.json"],
      ["absolute", "/etc/passwd"],
      ["backslash", "evidence\\a.json"],
      ["drive letter", "C:evil.json"],
      ["leading dot segment", "./evidence/a.json"],
      ["empty segment", "evidence//a.json"],
      ["empty", ""],
      ["over 240 characters", `${"a".repeat(241)}.json`],
      ["a newline", "evidence/a\nb.json"],
      ["the manifest's own name", "snapshot.json"],
    ] as const) {
      it(`a ${label} evidence path in the request`, () => {
        const ws = workspace({ request: starterRequest({ evidence: { assessment: path, targetInput: TARGET_INPUT } }) });
        const result = runCollector(ws);
        expectRefused(ws, result, /evidence path|assessment/iu);
        expect(result.stderr).not.toContain("\nb.json");
      });
    }

    it("two identical evidence paths", () => {
      const ws = workspace({ request: starterRequest({ evidence: { assessment: ASSESSMENT, targetInput: ASSESSMENT } }) });
      expectRefused(ws, runCollector(ws), /distinct|same/iu);
    });

    it("evidence paths that collide as file and directory", () => {
      const ws = workspace({ request: starterRequest({ evidence: { assessment: "a", targetInput: "a/b" } }), evidence: { a: Buffer.from("{}\n") } });
      const result = runCollector(ws);
      expect(result.status).toBe(2);
      expect(existsSync(ws.out)).toBe(false);
    });

    for (const [label, bad] of [
      ["uppercase hex", "B".repeat(40)],
      ["39 characters", "b".repeat(39)],
      ["a ref name", "main"],
      ["empty", ""],
    ] as const) {
      it(`BASE_SHA ${label}`, () => {
        const ws = workspace();
        expectRefused(ws, runCollector(ws, { env: { BASE_SHA: bad } }), /BASE_SHA/u);
      });
      it(`HEAD_SHA ${label}`, () => {
        const ws = workspace();
        expectRefused(ws, runCollector(ws, { env: { HEAD_SHA: bad } }), /HEAD_SHA/u);
      });
    }

    for (const bad of ["0", "-1", "1.5", "abc", "", "007", "1e3", " 4", "9007199254740993"]) {
      it(`PR_NUMBER ${JSON.stringify(bad)}`, () => {
        const ws = workspace();
        expectRefused(ws, runCollector(ws, { env: { PR_NUMBER: bad } }), /PR_NUMBER/u);
      });
    }

    it("PR_NUMBER unset", () => {
      const ws = workspace();
      expectRefused(ws, runCollector(ws, { env: { PR_NUMBER: undefined } }), /PR_NUMBER/u);
    });

    for (const bad of ["", "12a", "-5", "1 2"]) {
      it(`RUN_ID ${JSON.stringify(bad)}`, () => {
        const ws = workspace();
        expectRefused(ws, runCollector(ws, { env: { RUN_ID: bad } }), /RUN_ID/u);
      });
    }

    it("RUN_ID unset", () => {
      const ws = workspace();
      expectRefused(ws, runCollector(ws, { env: { RUN_ID: undefined } }), /RUN_ID/u);
    });

    it("a REPOSITORY that differs from the request", () => {
      const ws = workspace();
      expectRefused(ws, runCollector(ws, { env: { REPOSITORY: "other/repository" } }), /REPOSITORY/u);
    });

    it("REPOSITORY unset", () => {
      const ws = workspace();
      expectRefused(ws, runCollector(ws, { env: { REPOSITORY: undefined } }), /REPOSITORY/u);
    });

    it("a non-empty output directory, left unchanged", () => {
      const ws = workspace();
      mkdirSync(ws.out, { recursive: true });
      writeFileSync(join(ws.out, "keep.txt"), "keep\n");
      const result = runCollector(ws);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/output/iu);
      expect(result.stderr).toMatch(/not empty/iu);
      expect(listTree(ws.out)).toEqual(["keep.txt"]);
      expect(readFileSync(join(ws.out, "keep.txt"), "utf8")).toBe("keep\n");
    });

    it("an output path that is a file", () => {
      const ws = workspace();
      mkdirSync(dirname(ws.out), { recursive: true });
      writeFileSync(ws.out, "file\n");
      const result = runCollector(ws);
      expect(result.status).toBe(2);
      expect(readFileSync(ws.out, "utf8")).toBe("file\n");
    });

    it("a pre-existing empty output directory stays empty when a check fails", () => {
      const ws = workspace({ evidence: { [ASSESSMENT]: ASSESSMENT_BYTES } });
      mkdirSync(ws.out, { recursive: true });
      expectRefused(ws, runCollector(ws), /target-input/u, true);
    });

    for (const [label, args] of [
      ["no arguments", []],
      ["one argument", [".starter/request.json"]],
      ["three arguments", [".starter/request.json", "out", "extra"]],
      ["an empty request argument", ["", "out"]],
    ] as const) {
      it(label, () => {
        const ws = workspace();
        const result = runCollector(ws, { args: [...args] });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/usage/iu);
        expect(result.stderr).not.toMatch(/\n\s+at /u);
        expect(existsSync(join(ws.dir, "out"))).toBe(false);
      });
    }

    for (const [label, requestText] of [
      ["a request that is not JSON", "not json"],
      ["a request that is a JSON array", "[]"],
      ["a request without snapshot", JSON.stringify({ evidence: { assessment: ASSESSMENT, targetInput: TARGET_INPUT } })],
      ["a request with an empty repository", JSON.stringify({ snapshot: { repository: "" }, evidence: { assessment: ASSESSMENT, targetInput: TARGET_INPUT } })],
      ["a request without evidence", JSON.stringify({ snapshot: { repository: "consumer/repository" } })],
      ["a request with non-string evidence paths", JSON.stringify({ snapshot: { repository: "consumer/repository" }, evidence: { assessment: 1, targetInput: 2 } })],
    ] as const) {
      it(label, () => {
        const ws = workspace({ requestText });
        const result = runCollector(ws);
        expectRefused(ws, result, /request/iu);
      });
    }

    it("a request file that is a symlink, without echoing its target's contents", () => {
      const ws = workspace();
      writeFileSync(join(ws.dir, "hostile.txt"), "root:x:0:0:secret-marker\n");
      rmSync(join(ws.dir, ".starter/request.json"));
      symlinkSync("../hostile.txt", join(ws.dir, ".starter/request.json"));
      const result = runCollector(ws);
      expectRefused(ws, result, /request/iu);
      expect(result.all).not.toContain("secret-marker");
    });

    it("an unreadable request never echoes the parser's message or the file's text", () => {
      const ws = workspace({ requestText: "secret-marker-not-json" });
      const result = runCollector(ws);
      expectRefused(ws, result, /request/iu);
      expect(result.all).not.toContain("secret-marker");
    });

    it("a request that does not exist", () => {
      const ws = workspace();
      const result = runCollector(ws, { args: ["missing/request.json", ws.out] });
      expectRefused(ws, result, /request/iu);
    });
  });

  it("ignores credential variables in its environment and never echoes them", () => {
    const ws = workspace();
    const result = runCollector(ws, { extraEnv: { NODE_AUTH_TOKEN: "token-marker", NPM_TOKEN: "token-marker", GH_TOKEN: "token-marker" } });
    expect(result.status).toBe(0);
    expect(result.all).not.toContain("token-marker");
    expect(readFileSync(join(ws.out, "snapshot.json"), "utf8")).not.toContain("token-marker");
  });
});

// ---------------------------------------------------------------------------
// The workflows
// ---------------------------------------------------------------------------

function runBodies(text: string): string[] {
  const lines = text.split("\n");
  const bodies: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opener = /^(\s*)(?:- )?run:\s*[|>][-+]?\s*$/u.exec(lines[index]!);
    if (opener === null) {
      expect(lines[index]).not.toMatch(/^\s*(?:- )?run:\s*\S/u);
      continue;
    }
    const indent = opener[1]!.length;
    const body: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.trim() !== "" && line.length - line.trimStart().length <= indent) {
        index -= 1;
        break;
      }
      body.push(line);
    }
    bodies.push(body.join("\n"));
  }
  return bodies;
}

function expectHardenedWorkflow(text: string): void {
  expect(text.endsWith("\n")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(text).not.toContain("pull_request_target");
  expect(text).not.toContain("workflow_run:");
  expect(text).not.toMatch(/\bsecrets\./u);
  expect(text.match(/^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]\n\npermissions:\n {2}contents: read\n/mu)).not.toBeNull();
  expect(text.match(/^permissions:/gmu)).toHaveLength(1);
  expect(text.match(/^[ \t]+permissions:/gmu)).toBeNull();
  const uses = text.split("\n").filter((line) => /^\s*(?:- )?uses:/u.test(line));
  expect(uses.length).toBeGreaterThan(0);
  for (const line of uses) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v[\d.]+$/u);
  for (const body of runBodies(text)) expect(body).not.toContain("${{");
  expect(text).not.toMatch(/persist-credentials:\s*(?!false\b)\S/u);
  expect(text).not.toMatch(/\btoken:/u);
}

const EVIDENCE_GOLDEN = [
  "# Clossys adoption evidence, written by Clossys Launcher.",
  "#",
  "# This is the uncredentialed half of the adoption check. It runs on",
  "# pull_request, checks out the pull request head with no persisted credential,",
  "# and uploads a small snapshot of two evidence files as an artifact. It holds no",
  "# secret, installs nothing, and runs no package, Advisor or target command.",
  "#",
  "# The artifact this workflow uploads is NOT read by the trusted decision job.",
  "# A pull request controls this workflow and can edit it, so what it produces is",
  "# not evidence the decision trusts.",
  "#",
  "# The collector is a plain script in this repository:",
  "# .github/scripts/clossys-collect-adoption-snapshot.mjs. It reads the two",
  "# evidence paths named by .starter/request.json and copies exactly those files.",
  "name: Clossys adoption evidence",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened]",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  collect-adoption-evidence:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - name: Check out the pull request head",
  `        uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "          persist-credentials: false",
  "",
  "      # Values reach the script only through the environment, never through its",
  "      # text. The script runs no package, Advisor or target command.",
  "      - name: Collect the snapshot",
  "        env:",
  "          REPOSITORY: ${{ github.repository }}",
  "          PR_NUMBER: ${{ github.event.pull_request.number }}",
  "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "          RUN_ID: ${{ github.run_id }}",
  "        run: |",
  "          node .github/scripts/clossys-collect-adoption-snapshot.mjs \\",
  "            .starter/request.json \\",
  '            "$RUNNER_TEMP/adoption-snapshot"',
  "",
  "      - name: Upload the snapshot",
  `        uses: ${UPLOAD}`,
  "        with:",
  "          name: adoption-snapshot-${{ github.run_id }}",
  "          path: ${{ runner.temp }}/adoption-snapshot",
  "          if-no-files-found: error",
  "          retention-days: 7",
  "",
].join("\n");

describe("renderAdoptionEvidenceWorkflow", () => {
  const text = renderAdoptionEvidenceWorkflow();

  it("is the golden text", () => {
    expect(text).toBe(EVIDENCE_GOLDEN);
  });

  it("is hardened: one pull_request trigger, contents read only, pinned actions, no expressions in run bodies", () => {
    expectHardenedWorkflow(text);
    expect(text).not.toMatch(/^\s*(?:- )?if:/mu);
    expect(text.match(/persist-credentials: false/gu)).toHaveLength(1);
    expect(text.match(/^\s*(?:- )?uses:/gmu)).toHaveLength(2);
    expect(text).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0");
    expect(text).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7");
    expect(text).not.toMatch(/download-artifact|setup-node|npm |pnpm |npx /u);
  });

  it("names the same artifact the collector writes and Starter expects", () => {
    expect(text).toContain("name: adoption-snapshot-${{ github.run_id }}");
    expect(text).toContain("RUN_ID: ${{ github.run_id }}");
  });

  it("says in its header that the trusted decision job does not read the artifact", () => {
    const header = text.slice(0, text.indexOf("\nname:")).replace(/\n# /gu, " ");
    expect(header).toContain("NOT read by the trusted decision job");
    expect(header).not.toMatch(/#\d+/u);
  });
});

const SCOPE_HEADER = [
  "# Clossys path scope, written by Clossys Launcher.",
  "#",
  "# This applies to pull requests whose head branch starts with clossys/apply-.",
  "# For those it lists every file the pull request changes, deletions included,",
  "# and fails unless each one matches a path Clossys may own and, apart from the",
  "# ledger, package.json and the lockfiles, is named by the pull request's own",
  "# clossys/.state/installed.json. Any other pull request passes with a notice.",
  "# That decision is made inside the script, not by a job condition, so this job",
  "# and its check always run.",
  "#",
  "# This workflow runs in the pull request's own context, so a pull request can",
  "# edit it. It catches an agent's mistakes, not a hostile author. The trusted",
  "# admission job is the separate workflow_run workflow, which runs from the",
  "# protected base.",
  "#",
  "# The script only runs git diff and git show. It never runs, loads or evaluates",
  "# anything from the checked-out files, and the branch name reaches it only",
  "# through the environment.",
];

const SCOPE_BEFORE = [
  ...SCOPE_HEADER,
  "name: Clossys path scope",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened]",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  path-scope:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - name: Check out the pull request head",
  `        uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "          fetch-depth: 0",
  "          persist-credentials: false",
  "",
  "      # The branch name and both commits reach the script only through the",
  "      # environment, never through its text.",
  "      - name: Check the changed paths",
  "        env:",
  "          HEAD_REF: ${{ github.event.pull_request.head.ref }}",
  "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "        run: |",
  "          node --input-type=module - <<'CLOSSYS_PATH_SCOPE'",
];
const SCOPE_AFTER = ["          CLOSSYS_PATH_SCOPE", ""];

describe("renderPathScopeWorkflow", () => {
  const text = renderPathScopeWorkflow();
  const script = renderPathScopeScript();

  it("is the golden text", () => {
    const indented = script
      .slice(0, -1)
      .split("\n")
      .map((line) => (line === "" ? "" : `          ${line}`));
    expect(text).toBe([...SCOPE_BEFORE, ...indented, ...SCOPE_AFTER].join("\n"));
  });

  it("is hardened, has no job-level or step-level condition, and keeps expressions out of the run body", () => {
    expectHardenedWorkflow(text);
    expect(text).not.toMatch(/^\s*(?:- )?if:/mu);
    expect(text.match(/persist-credentials: false/gu)).toHaveLength(1);
    expect(text.match(/^\s*(?:- )?uses:/gmu)).toHaveLength(1);
    expect(Object.keys(Object.fromEntries([...text.matchAll(/^ {2}([a-z-]+):$/gmu)].map((m) => [m[1], true])))).toEqual(["path-scope"]);
    const bodies = runBodies(text);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("${{");
    expect(bodies[0]).not.toContain("HEAD_REF: ");
  });

  it("uses one heredoc terminator, exactly twice, and never inside the script", () => {
    expect(text.match(/CLOSSYS_PATH_SCOPE/gu)).toHaveLength(2);
    expect(script).not.toContain("CLOSSYS_PATH_SCOPE");
  });

  it("round-trips: the script extracted from the run body equals renderPathScopeScript()", () => {
    const lines = text.split("\n");
    const open = lines.indexOf("          node --input-type=module - <<'CLOSSYS_PATH_SCOPE'");
    const close = lines.indexOf("          CLOSSYS_PATH_SCOPE");
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    const body = lines.slice(open + 1, close).map((line) => {
      if (line === "") return "";
      expect(line.startsWith("          ")).toBe(true);
      return line.slice(10);
    });
    expect(`${body.join("\n")}\n`).toBe(script);
  });

  it("passes the branch name and both commits through env only", () => {
    expect(text).toContain("HEAD_REF: ${{ github.event.pull_request.head.ref }}");
    expect(text).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(text).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(text.match(/\$\{\{/gu)).toHaveLength(4);
  });

  it("says who it protects against and where the trusted check lives", () => {
    const header = text.slice(0, text.indexOf("\nname:")).replace(/\n# /gu, " ");
    expect(header).toContain("can edit it");
    expect(header).toContain("not a hostile author");
    expect(header).toContain("workflow_run");
    expect(header).not.toMatch(/#\d+/u);
  });
});

// ---------------------------------------------------------------------------
// Measurement: the repository's own CI conventions checker over both files
// ---------------------------------------------------------------------------

describe("evaluateCiConventions over the rendered workflows", () => {
  it("reports on both workflows", () => {
    const result = evaluateCiConventions({
      workflowFiles: [
        { path: ".github/workflows/clossys-adoption-evidence.yml", content: renderAdoptionEvidenceWorkflow() },
        { path: ".github/workflows/clossys-path-scope.yml", content: renderPathScopeWorkflow() },
      ],
      // No required contexts: which checks a consumer requires is the consumer's
      // choice, and requiring one adds rules about merge_group triggers and gate
      // naming that a job id fixed by the template cannot answer.
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.0.0-test",
    });
    // Measured, not assumed: any error-severity finding fails this test and names the rule.
    expect(result.findings.filter((finding) => finding.severity === "error").map((finding) => `${finding.rule} ${finding.path ?? ""}`)).toEqual([]);
    expect(result.verdict).toBe("satisfied");
  });
});
