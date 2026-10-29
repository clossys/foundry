import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { stageCell, stageFinding, stageWontClaimCells } from "./ground/fixtures.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const projects: string[] = [];
const id = "context.customer.need";
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function strategy(root: string) {
  mkdirSync(root, { recursive: true });
  stageFinding(root); stageWontClaimCells(root);
  const tree = JSON.parse(readFileSync(join(root, "tree.json"), "utf8"));
  tree.active[id] = 1;
  put(root, "tree.json", JSON.stringify(tree));
  stageCell(root, id, 1, "Need", "Fictional studio scheduling.");
  for (const activeId of [id, "advantage.proposition.proof", "identity.verbal.voice"]) {
    const path = `cells/${activeId}/v1.md`;
    put(root, path, readFileSync(join(root, path), "utf8").replace("- Review.\n", "- If active-customers > 4000 customers by 2026-10-29, then review.\n"));
  }
  put(root, "contracts/fixture.json", JSON.stringify({ schemaVersion: 1, id: "fixture.brief", owner: "fixture", requires: [id], optional: [] }));
}
function project(marker: "directory" | "file" = "directory") {
  const repo = mkdtempSync(join(tmpdir(), "strategist-root-layout-")); projects.push(repo);
  if (marker === "directory") mkdirSync(join(repo, ".git"));
  else put(repo, ".git", "gitdir: fixture-worktree-metadata\n");
  const nested = join(repo, "apps/admin"); mkdirSync(nested, { recursive: true });
  put(repo, "surfaces/page.md", "We serve 4,200 customers.\n");
  return { repo, nested, root: join(repo, "clossys/agents/director"), old: join(repo, "clossys/strategist") };
}
function run(cwd: string, ...args: string[]) {
  const child = spawnSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" });
  expect(child.error).toBeUndefined();
  return { code: child.status, output: child.stdout, error: child.stderr };
}
afterEach(() => projects.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

it.each(["directory", "file"] as const)("compiled CLI shares repository-root reads and writes from nested cwd with .git %s", marker => {
  const { repo, nested, root, old } = project(marker); strategy(root);
  expect(run(repo, "ground", "surfaces").code).toBe(0);
  expect(run(nested, "ground", "../../surfaces").code).toBe(0);
  const status = run(nested, "status");
  expect(status.code).toBe(1); // Valid but incomplete strategy remains findings, not could-not-run.
  expect(JSON.parse(status.output).result.cells).toContainEqual(expect.objectContaining({ id }));
  expect(run(nested, "propose", "focus.segment.core").code).toBe(0);
  expect(readFileSync(join(root, "cells/focus.segment.core/v1.md"), "utf8")).toContain("status: draft");
  expect(run(nested, "activate", "focus.segment.core@1").code).toBe(2);
  expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8")).active["focus.segment.core"]).toBeNull();
  expect(run(nested, "brief", "fixture.brief", "--write").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "briefs/index.json"), "utf8")).briefs[0].contract).toBe("fixture.brief");
  expect(run(nested, "index").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "citations.json"), "utf8")).entries).toContainEqual(expect.objectContaining({ ref: { cell: id, version: 1 } }));
  expect(run(nested, "wont-claim", "../../surfaces").code).toBe(0);
  expect(existsSync(join(root, "reports/wont-claim.json"))).toBe(true);
  expect([0, 1]).toContain(run(nested, "check").code);
  expect(existsSync(join(root, "reports/cell-quality.json"))).toBe(true);
  expect(run(nested, "review", "--today", "2026-10-29").code).toBe(1);
  expect(JSON.parse(readFileSync(join(root, "requests/REQ-0001.json"), "utf8")).kind).toBe("tripwire");
  expect(existsSync(old)).toBe(false);
  expect(existsSync(join(nested, "clossys"))).toBe(false);
});

function snapshot(root: string): Record<string, string> {
  const bytes: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { bytes[path] = "directory"; walk(path); }
      else bytes[path] = readFileSync(path).toString("base64");
    }
  };
  walk(root); return bytes;
}

const legacyPaths = ["clossys/agents/strategist", "clossys/strategist", "strategy"];
const writes = [
  ["propose", "focus.segment.core"], ["activate", "focus.segment.core@1", "--confirm", "msg:2026-10-29-1#U1"],
  ["brief", "fixture.brief", "--write"], ["brief", "fixture.brief", "--request"],
  ["request", "new", "--raised-by", "researcher", "--kind", "change", "--cells", id, "--detail", "Review"],
  ["request", "resolve", "REQ-0001", "--ref", "context.customer.need@1", "--confirm", "msg:2026-10-29-1#U1"],
  ["review", "--today", "2026-10-29"], ["index"],
];
it.each(legacyPaths)("compiled CLI reads %s with notice and preserves all legacy bytes", legacy => {
  const { repo, nested, root } = project(); const old = join(repo, legacy); strategy(old);
  const before = snapshot(old);
  for (const args of [["ground", "../../surfaces"], ["status"], ["cell", id, "--verb", "create"],
    ["brief", "fixture.brief"], ["handoff", "fixture.brief"], ["check"], ["cohere"], ["complete"],
    ["wont-claim", "../../surfaces"], ["index", "--check"], ["request", "list"]]) {
    const result = run(nested, ...args);
    expect([0, 1], args.join(" ")).toContain(result.code);
    expect(() => JSON.parse(result.output)).not.toThrow();
    expect(result.error).toContain("retired");
    expect(result.error).toContain("read-only");
    expect(result.error).toContain(root);
  }
  expect(snapshot(old)).toEqual(before);
  expect(existsSync(root)).toBe(false);
  for (const args of writes) {
    for (const explicit of [[], ["--root", old]]) {
      const result = run(nested, ...args, ...explicit);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.output).toContain("retired");
      expect(snapshot(old)).toEqual(before);
      expect(existsSync(root)).toBe(false);
    }
  }
  expect(run(nested, "ground", "../../surfaces", "--root", old).code).toBe(0);
  expect(run(nested, old, "../../surfaces").code).toBe(0);
  expect([0, 1]).toContain(run(nested, "check", "--root", old).code);
  expect(snapshot(old)).toEqual(before);
});

const candidates = ["clossys/agents/director", ...legacyPaths];
const pairs = candidates.flatMap((path, index) => candidates.slice(index + 1).map(other => [path, other]));
it.each(pairs)("compiled CLI refuses competing defaults %s and %s", (left, right) => {
  const { repo, nested } = project(); strategy(join(repo, left!)); strategy(join(repo, right!));
  const before = snapshot(repo);
  for (const args of [["ground", "../../surfaces"], ["status"], ["check"], ["propose", "focus.segment.core"], ["index"], ["review"]]) {
    const result = run(nested, ...args);
    expect(result.code).toBe(2);
    expect(result.output + result.error).toContain("refusing to silently pick");
  }
  expect(snapshot(repo)).toEqual(before);
});

it("compiled CLI preserves explicit custom roots even when defaults are ambiguous", () => {
  const { repo, nested, root, old } = project(); strategy(root); strategy(old);
  const custom = join(nested, "custom-root"); strategy(custom);
  const before = snapshot(old);
  expect(run(nested, "ground", "../../surfaces", "--root", "custom-root").code).toBe(0);
  expect(run(nested, "status", "--root", "custom-root").code).toBe(1);
  expect(run(nested, "propose", "focus.segment.core", "--root", "custom-root").code).toBe(0);
  expect(run(nested, "brief", "fixture.brief", "--write", "--root", "custom-root").code).toBe(0);
  expect(run(nested, "index", "--root", "custom-root").code).toBe(0);
  expect([0, 1]).toContain(run(nested, "check", "--root", "custom-root").code);
  expect(existsSync(join(custom, "reports/cell-quality.json"))).toBe(true);
  expect(snapshot(old)).toEqual(before);
});

it("help does not resolve ambiguous defaults", () => {
  const { repo, nested, root, old } = project(); strategy(root); strategy(old);
  for (const command of ["ground", "status", "propose", "index", "review"]) {
    expect(run(nested, command, "--help").code).toBe(0);
  }
});

it("compiled CLI reports the prescribed empty product-saas interview tree as incomplete", () => {
  const { repo, nested, root } = project();
  const tree = { schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "product-saas", core: "archetype", active: {} };
  put(root, "tree.json", JSON.stringify(tree));
  const result = run(nested, "status");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.output)).toMatchObject({ command: "status", code: 1, result: { scope: "core" } });
  expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8"))).toEqual(tree);
  expect(existsSync(join(root, "cells"))).toBe(false);
  expect(existsSync(join(repo, "clossys/strategist"))).toBe(false);
});

it.each(legacyPaths)("compiled CLI protects explicit %s selected outside its repository", legacy => {
  const { repo, root } = project(); const old = join(repo, legacy); strategy(old);
  const outside = mkdtempSync(join(tmpdir(), "strategist-outside-")); projects.push(outside);
  mkdirSync(join(outside, ".git"));
  const alias = join(outside, "selected-root"); symlinkSync(old, alias);
  const before = snapshot(old);
  for (const selected of [old, alias]) {
    expect(run(outside, "ground", join(repo, "surfaces"), "--root", selected).code).toBe(selected === old ? 0 : 2);
    const status = run(outside, "status", "--root", selected);
    expect(status.code).toBe(selected === old ? 1 : 2);
    expect(status.error).toContain(root);
    expect(selected === old ? [0, 1] : [2]).toContain(run(outside, "check", "--root", selected).code);
    for (const args of writes) {
      const result = run(outside, ...args, "--root", selected);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.output).toContain("retired");
    }
    expect(snapshot(old)).toEqual(before);
  }
  const custom = join(repo, "records/strategy"); strategy(custom);
  expect(run(outside, "propose", "focus.segment.core", "--root", custom).code).toBe(0);
  expect(snapshot(old)).toEqual(before);
});
