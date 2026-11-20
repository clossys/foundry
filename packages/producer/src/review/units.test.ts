import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forbiddenFindings, FORBIDDEN_RULES, type Change } from "./changes.js";
import { REVIEW_DOC, reviewDoc } from "./doc.js";
import { normalizeOutput, scratch, tailSha } from "./exec.js";
import { buildSet } from "./graph.js";
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

  it("digests output tails with roots, temp folders and digits normalized", () => {
    expect(normalizeOutput("\u001b[32mok\u001b[0m 12ms in /work/tree/a\r\n", ["/work/tree"])).toBe("ok 0ms in <root>/a\n");
    expect(tailSha("passed in 31ms\n", [])).toBe(tailSha("passed in 7ms\n\n", []));
    expect(tailSha("1 failed\n", [])).not.toBe(tailSha("passed\n", []));
  });
});

describe("build set", () => {
  it("orders by manifest edges only: a test-dist-closure edge adds a package but never builds it first", () => {
    const tree = scratch("review-graph-");
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
});

describe("docs/review.md", () => {
  it(`is generated from the code (${REVIEW_DOC}, clossys review --write-doc)`, () => {
    const committed = readFileSync(new URL("../../docs/review.md", import.meta.url), "utf8");
    expect(committed).toBe(reviewDoc());
  });
});
