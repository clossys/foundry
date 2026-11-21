import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { forbiddenFindings, FORBIDDEN_RULES, packageOf, type Change } from "./changes.js";
import { FOUNDRY_CONFIG } from "./config.js";
import { REVIEW_DOC, reviewDoc } from "./doc.js";
import { exitText, normalizeOutput, scratch, tailSha } from "./exec.js";
import { buildSet, coveringTests } from "./graph.js";
import { applyMutant, lineMutants, mask, selectMutants, type Mutant } from "./mutate.js";
import { CLOSSYS_CLI, commandOf, parsePacket, validationItems } from "./receipt.js";

describe("mutation operators", () => {
  it("flips comparisons, negates conditions, drops returns and throws, swaps literals", () => {
    const ops = (line: string, file = "a.ts") => lineMutants(file, 1, line).map(mutant => `${mutant.operator}: ${mutant.to.trim()}`);
    expect(ops("  if (a === b) return true;")).toEqual([
      "negate-condition: if (!(a === b)) return true;",
      "flip-comparison: if (a !== b) return true;",
      "swap-literal: if (a === b) return false;",
    ]);
    expect(ops("  return count >= 2;", "a.mjs")).toEqual(["drop-return: return undefined;", "flip-comparison: return count < 2;", "swap-literal: return count >= 3;"]);
    expect(ops("  throw new Error(\"x\");")).toEqual(["drop-throw: void (new Error(\"x\"));"]);
    expect(ops("  return value;")).toEqual(["drop-return: return undefined as never;"]);
  });

  it("never fires inside strings, templates, comments, imports or type declarations", () => {
    expect(mask("const a = \"x === y\"; // 1 < 2")).toBe("const a = \"       \";         ");
    expect(lineMutants("a.ts", 1, "const a = `${'1 < 2'}`; // true")).toEqual([]);
    expect(lineMutants("a.ts", 1, "import { a } from \"./b.js\";")).toEqual([]);
    expect(lineMutants("a.ts", 1, "type A = { n: 1 };")).toEqual([]);
  });

  it("selects the same capped mutants for the same seed, in source order", () => {
    const all: Mutant[] = Array.from({ length: 60 }, (_, index) => ({ id: `f.ts:${index + 1}:1:swap-literal`, file: "f.ts", line: index + 1, column: 0, operator: "swap-literal", from: "1", to: "2" }));
    const once = selectMutants(all, "7"), twice = selectMutants(all, "7");
    expect(once).toHaveLength(40);
    expect(once).toEqual(twice);
    expect(once.map(mutant => mutant.line)).toEqual([...once.map(mutant => mutant.line)].sort((a, b) => a - b));
    expect(selectMutants(all, "8")).not.toEqual(once);
    expect(selectMutants(all.slice(0, 10), "7")).toHaveLength(10);
  });

  it("applies a mutant only to the line it was made from", () => {
    const [mutant] = lineMutants("a.ts", 2, "  return 1;");
    expect(applyMutant("x\n  return 1;\n", mutant!)).toBe("x\n  return undefined as never;\n");
    expect(() => applyMutant("x\n  return 2;\n", mutant!)).toThrow(/no longer matches/);
  });
});

describe("receipt commands", () => {
  it("reads the Validation list up to the next heading of its level", () => {
    const md = "# U\n## Validation\n- `git diff` one\n  continued `node a.mjs`\n### Sub\n1. `npm test -w x`\n## Output\n- `node out.mjs`\n";
    expect(validationItems(md)).toEqual(["- `git diff` one continued `node a.mjs`", "1. `npm test -w x`"]);
    expect(parsePacket(md, "U.md").commands.map(command => command.run)).toEqual(["git diff", "node a.mjs", "npm test -w x"]);
  });

  it("unwraps wt run, maps clossys to the checkout's CLI and skips the review verbs", () => {
    expect(commandOf("wt run --kind build --tool claude --session s -- npm run build -w @clossys/producer")).toEqual({ run: "npm run build -w @clossys/producer" });
    expect(commandOf("clossys check --e2e")).toEqual({ run: `${CLOSSYS_CLI} check --e2e` });
    expect(commandOf("clossys review a b")).toEqual({ reason: "clossys review runs the receipt itself" });
    expect(commandOf("receipt.json")).toEqual({ reason: "not a command" });
    expect(commandOf("npm")).toEqual({ reason: "not a command" });
  });

  it("digests output tails with roots, temp folders, times and sizes normalized, and every count kept", () => {
    expect(normalizeOutput("\u001b[32mok\u001b[0m 12ms in /work/tree/a\r\n", ["/work/tree"])).toBe("ok <duration> in <root>/a\n");
    expect(normalizeOutput("at 2026-11-20T10:01:02.5Z, 10:01:02, 1.5 s, 13Gi free, 47%, 3 failed, 12 passed")).toBe("at <date>, <clock>, <duration>, <size> free, <percent>, 3 failed, 12 passed");
    expect(tailSha("passed in 31ms\n", [])).toBe(tailSha("passed in 7ms\n\n", []));
    expect(tailSha("/dev/disk 228Gi 13Gi 15Gi 47%\n", [])).toBe(tailSha("/dev/disk 228Gi 12Gi 16Gi 44%\n", []));
    expect(tailSha("1 failed\n", [])).not.toBe(tailSha("passed\n", []));
    expect(tailSha("Tests 3 failed | 9 passed\n", [])).not.toBe(tailSha("Tests 0 failed | 12 passed\n", []));
  });

  it("reads the exit code a packet line expects, 0 unless it says otherwise", () => {
    const md = "## Validation\n- `node a.mjs` exits 1 (red by design).\n- `node b.mjs` must exit 2\n- `node c.mjs` (exit code 3)\n- `node d.mjs` is green; it never exits 1\n- `node e.mjs`\n";
    expect(parsePacket(md, "U.md").commands.map(command => [command.run, command.expect])).toEqual([["node a.mjs", 1], ["node b.mjs", 2], ["node c.mjs", 3], ["node d.mjs", 0], ["node e.mjs", 0]]);
    expect(() => parsePacket("## Validation\n- `node a.mjs` exits 1\n- `node a.mjs`\n", "U.md")).toThrow(/expecting exit 1 and exit 0/);
  });

  it("states the exit code and a timeout in a failed run", () => {
    expect(exitText({ exit: 2, ms: 10, timedOut: false })).toBe("exit 2");
    expect(exitText({ exit: 1, ms: 600_000, timedOut: true })).toBe("exit 1 (timed out after 600s)");
  });
});

describe("build set", () => {
  it("orders by manifest edges only: a test-dist-closure edge adds a package but never builds it first", () => {
    const tree = scratch("review-graph-");
    onTestFinished(() => rmSync(tree, { recursive: true, force: true }));
    const manifest = (dir: string, body: Record<string, unknown>) => { mkdirSync(join(tree, dir), { recursive: true }); writeFileSync(join(tree, dir, "package.json"), JSON.stringify(body)); };
    manifest(".", { name: "ws", workspaces: ["packages/*"] });
    manifest("packages/base", { name: "base", scripts: { build: "x" } });
    manifest("packages/ui", { name: "ui", dependencies: { base: "*" }, scripts: { build: "x" } });
    manifest("packages/pages", { name: "pages", dependencies: { ui: "*", base: "*" }, scripts: { build: "x" } });
    manifest("packages/app", { name: "app", dependencies: { ui: "*", pages: "*" }, scripts: { build: "x" } });
    manifest("packages/types", { name: "types" });
    manifest("packages/tool", { name: "tool", devDependencies: { types: "*" }, scripts: { build: "x" } });
    writeFileSync(join(tree, "packages/ui/test-dist-closure.json"), JSON.stringify({ requires: [{ path: "packages/pages/dist/a.js", builtBy: "pages" }, { path: "packages/tool/dist/b.js", builtBy: "tool (generate)" }] }));
    const { order, prerequisites } = buildSet(tree, ["packages/app"]);
    expect(order.map(workspace => workspace.name)).toEqual(["base", "ui", "pages", "app", "tool"]);
    expect([...prerequisites].sort()).toEqual(["packages/base", "packages/pages", "packages/tool", "packages/types", "packages/ui"]);
    expect(buildSet(tree, ["packages/base"]).order.map(workspace => workspace.name)).toEqual(["base"]);
  });
});

describe("covering tests", () => {
  it("follow the import graph transitively, across packages by workspace name, and report changed sources no test reaches", () => {
    const tree = scratch("review-cover-");
    onTestFinished(() => rmSync(tree, { recursive: true, force: true }));
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", exports: { ".": "./dist/index.js", "./b": { import: "./dist/b.js" } } }),
      "packages/lib/src/a.ts": "export const a = 1;\n",
      "packages/lib/src/b.ts": "import { a } from \"./a.js\";\nexport const b = a + 1;\n",
      "packages/lib/src/b.test.ts": "import { b } from \"./b.js\";\n",
      "packages/lib/src/c.ts": "export const c = 3;\n",
      "packages/lib/src/types.d.ts": "export type T = 1;\n",
      "packages/lib/src/gone.test.ts": "import { gone } from \"./gone.js\";\n",
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { lib: "*" } }),
      "packages/app/src/view.ts": "export { b } from \"lib/b\";\n",
      "packages/app/src/view.test.ts": "import { b } from \"./view.js\";\n",
    };
    for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(tree, path)), { recursive: true }); writeFileSync(join(tree, path), text); }
    execFileSync("git", ["init", "--quiet"], { cwd: tree });
    execFileSync("git", ["add", "-A"], { cwd: tree });
    const covering = coveringTests(tree, [
      { path: "packages/lib/src/a.ts", status: "M" }, { path: "packages/lib/src/c.ts", status: "A" },
      { path: "packages/lib/src/types.d.ts", status: "M" }, { path: "packages/lib/src/gone.ts", status: "D" },
    ], file => packageOf(tree, file));
    expect(covering.all).toEqual(["packages/app/src/view.test.ts", "packages/lib/src/b.test.ts", "packages/lib/src/gone.test.ts"]);
    expect(covering.uncovered).toEqual(["packages/lib/src/c.ts"]);
    expect(covering.bySource.get("packages/lib/src/a.ts")).toEqual(["packages/lib/src/b.test.ts"]);
  });
});

describe("count probes", () => {
  it("read the top-level --json reports of clossys check, --constitution, --side-door and ia.orphans", () => {
    const parse = (id: string, doc: unknown) => FOUNDRY_CONFIG.counts.find(item => item.id === id)!.parse(`progress line\n${JSON.stringify(doc)}\n`);
    expect(parse("check", { findings: [{ rule: "a" }, { rule: "b" }, { rule: "a" }] })).toEqual({ a: 2, b: 1 });
    expect(parse("constitution", { ok: false, rules: [{ id: "R1", rows: 3 }, { id: "R2", rows: 0 }] })).toEqual({ R1: 3, R2: 0 });
    expect(parse("side-door", { ok: false, findings: [{ file: "x" }, { file: "y" }] })).toEqual({ "engine.side-door": 2 });
    expect(parse("ia-orphans", { n: 4 })).toEqual({ "ia.orphans": 4 });
    expect(() => parse("constitution", { output: { rules: [] } })).toThrow(/no rules/);
    expect(() => parse("side-door", { output: { findings: [] } })).toThrow(/no findings/);
  });
});

describe("forbidden paths", () => {
  const change = (path: string, extra: Partial<Change> = {}): Change => ({ status: "M", path, added: 1, deleted: 0, ...extra });
  const ids = (changes: Change[]) => forbiddenFindings(".", "HEAD", "HEAD", changes.filter(item => !item.path.endsWith("package.json"))).map(finding => finding.id);

  it("matches changelogs, changesets, release catalogs, retired leaves and baseline additions", () => {
    expect(ids([change("packages/x/CHANGELOG.md"), change(".changeset/brave-fox.md"), change(".changeset/README.md")])).toEqual(["forbidden.changelog", "forbidden.changelog"]);
    expect(ids([change("governance/release-catalog.json")])).toEqual(["forbidden.release-catalog"]);
    expect(ids([change("src/leaves/retired-leaves-moved.ts", { status: "R", from: "src/leaves/retired-leaves.ts" })])).toEqual(["forbidden.retired-leaves"]);
    expect(ids([change("scripts/lint-baseline.json"), change("governance/known-gaps.json"), change("scripts/allowlist.txt", { added: 0, deleted: 3 })])).toEqual(["forbidden.baseline", "forbidden.baseline"]);
    expect(FORBIDDEN_RULES.map(rule => rule.id)).toEqual(["forbidden.changelog", "forbidden.release-catalog", "forbidden.retired-leaves", "forbidden.baseline"]);
  });

  it("matches exemption and ceiling lists, binary baselines and renames away of a changelog or release catalog", () => {
    expect(ids([change("governance/opaque-content-exemptions.json"), change("scripts/check-orphan-checks.exemptions.json"), change("scripts/size-ceilings.yaml")])).toEqual(["forbidden.baseline", "forbidden.baseline", "forbidden.baseline"]);
    expect(ids([change("packages/x/baseline.png", { added: 0, binary: true })])).toEqual(["forbidden.baseline"]);
    expect(ids([change("scripts/rules.json", { status: "R", from: "scripts/old.json", added: 0 }), change("scripts/new-allowlist.json", { status: "R", from: "scripts/old.json", added: 0 })])).toEqual(["forbidden.baseline"]);
    expect(ids([change("docs/old-notes.md", { status: "R", from: "packages/x/CHANGELOG.md", added: 0 }), change("governance/catalog.json", { status: "R", from: "governance/release-catalog.json", added: 0 })])).toEqual(["forbidden.changelog", "forbidden.release-catalog"]);
    // Not lists: a component named for exemptions, a removed baseline line, a deleted baseline.
    expect(ids([change("packages/x/src/AssetExemptions.tsx"), change("scripts/lint-baseline.json", { added: 0, deleted: 2 }), change("scripts/x-allowlist.json", { status: "D", added: 0 })])).toEqual([]);
  });
});

describe("docs/review.md", () => {
  it(`is generated from the code (${REVIEW_DOC}, clossys review --write-doc)`, () => {
    const committed = readFileSync(new URL("../../docs/review.md", import.meta.url), "utf8");
    expect(committed).toBe(reviewDoc());
  });
});
