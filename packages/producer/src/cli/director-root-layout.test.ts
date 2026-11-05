import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
// Director's own fixtures (test-only source import; @clossys/director ships them in no export).
import { stageCell, stageFinding, stageWontClaimCells } from "../../../director/src/ground/fixtures.js";

/**
 * `clossys director check …` end to end through the compiled clossys CLI: @clossys/director is a
 * library, and this verb injects the slot-model reader and writer, so every read and write here
 * goes through records/slots.ts and records/slot-write.ts.
 */
const cli = fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));
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
  const repo = mkdtempSync(join(tmpdir(), "director-root-layout-")); projects.push(repo);
  if (marker === "directory") mkdirSync(join(repo, ".git"));
  else put(repo, ".git", "gitdir: fixture-worktree-metadata\n");
  const nested = join(repo, "apps/admin"); mkdirSync(nested, { recursive: true });
  put(repo, "surfaces/page.md", "We serve 4,200 customers.\n");
  return { repo, nested, root: join(repo, "clossys/agents/director"), old: join(repo, "clossys/director") };
}
function run(cwd: string, ...args: string[]) {
  const child = spawnSync(process.execPath, [cli, "director", "check", ...args, "--json"], { cwd, encoding: "utf8" });
  expect(child.error).toBeUndefined();
  return { code: child.status, output: child.stdout, error: child.stderr };
}
afterEach(() => projects.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

it.each(["directory", "file"] as const)("compiled clossys director check shares repository-root reads and writes from nested cwd with .git %s", marker => {
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
}, 30_000);

it("compiled clossys director check never selects populated old roots or creates a missing default during reads", () => {
  const { repo, nested, root, old } = project(); strategy(old); strategy(join(repo, "director"));
  expect(run(nested, "ground", "../../surfaces").code).toBe(2);
  expect(run(nested, "status").code).toBe(2);
  expect(existsSync(root)).toBe(false);
  expect(run(nested, "ground", "../../surfaces", "--root", "../../clossys/director").code).toBe(0);
  expect(run(nested, "propose", "focus.segment.core", "--root", "../../clossys/director").code).toBe(0);
  expect(existsSync(join(old, "cells/focus.segment.core/v1.md"))).toBe(true);
  expect(existsSync(root)).toBe(false);
}, 30_000);

it("compiled clossys director check reports the prescribed empty product-saas interview tree as incomplete", () => {
  const { repo, nested, root } = project();
  const tree = { schemaVersion: 1, catalog: "@clossys/director#strategy-v1", archetype: "product-saas", core: "archetype", active: {} };
  put(root, "tree.json", JSON.stringify(tree));
  const result = run(nested, "status");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.output)).toMatchObject({ command: "status", code: 1, result: { scope: "core" } });
  expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8"))).toEqual(tree);
  expect(existsSync(join(root, "cells"))).toBe(false);
  expect(existsSync(join(repo, "clossys/director"))).toBe(false);
}, 30_000);
