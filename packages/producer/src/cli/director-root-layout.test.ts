import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
// Director's own fixtures (test-only source import; @clossys/director ships them in no export).
import { stageFinding, stageSlot } from "../../../director/src/__fixtures__/slot-model.js";

/**
 * `clossys director check …` end to end through the compiled clossys CLI: @clossys/director is a
 * library, and this verb injects the slot-model reader and writer, so every read and write here
 * goes through records/slots.ts and records/slot-write.ts. Slots are flat folders with a pin;
 * findings are the consumer's evidence/director records.
 */
const cli = fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));
const projects: string[] = [];
const id = "context.customer.need";
const watch = ["If active-customers > 4000 customers by 2026-10-29, then review."];
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
/** Stages pinned slots (and, for a `<consumer>/agents/director` root, its evidence). */
function strategy(root: string, evidence = true) {
  mkdirSync(root, { recursive: true });
  if (evidence) stageFinding(root);
  stageSlot(root, "advantage.proposition.proof", 1, 'Never-claim: "guaranteed results"', { watch });
  stageSlot(root, "identity.verbal.voice", 1, "Never: “risk-free”", { watch });
  stageSlot(root, id, 1, "Need: Fictional studio scheduling.", { watch });
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
  expect(JSON.parse(status.output).result.cells).toContainEqual(expect.objectContaining({ id, version: 1 }));
  // The store-only commands are retired: pins are made by `clossys pin`.
  for (const retired of [["propose", "focus.segment.core"], ["activate", "focus.segment.core@1"]]) expect(run(nested, ...retired).code).toBe(2);
  expect(existsSync(join(root, "focus.segment.core"))).toBe(false);
  expect(run(nested, "brief", "fixture.brief", "--write").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "briefs/index.json"), "utf8")).briefs[0].contract).toBe("fixture.brief");
  expect(run(nested, "index").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "citations.json"), "utf8")).entries).toContainEqual(expect.objectContaining({ ref: { cell: id, version: 1 } }));
  expect(run(nested, "wont-claim", "../../surfaces").code).toBe(0);
  expect(existsSync(join(root, "reports/wont-claim.json"))).toBe(true);
  expect([0, 1]).toContain(run(nested, "check").code);
  expect(existsSync(join(root, "reports/cell-quality.json"))).toBe(true);
  // Review plans the tripped watch and persists nothing.
  expect(run(nested, "review", "--today", "2026-10-29").code).toBe(1);
  expect(existsSync(join(root, "requests"))).toBe(false);
  expect(existsSync(join(root, "tree.json"))).toBe(false);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(join(nested, "clossys"))).toBe(false);
}, 30_000);

it("compiled clossys director check never selects populated old roots or creates a missing default during reads", () => {
  const { repo, nested, root, old } = project(); strategy(old, false); strategy(join(repo, "director"), false);
  expect(run(nested, "ground", "../../surfaces").code).toBe(2);
  expect(run(nested, "status").code).toBe(2);
  expect(existsSync(root)).toBe(false);
  // An explicit old root is read, but only a `<consumer>/agents/director` root reaches evidence, so it cannot ground.
  const ground = run(nested, "ground", "../../surfaces", "--root", "../../clossys/director");
  expect(ground.code).toBe(2);
  expect(JSON.parse(ground.output)).toMatchObject({ state: "indeterminate", findings: [] });
  expect(run(nested, "status", "--root", "../../clossys/director").code).toBe(1);
  expect(existsSync(root)).toBe(false);
}, 30_000);

it("compiled clossys director check reports an empty default root as incomplete without writing", () => {
  const { repo, nested, root } = project();
  mkdirSync(root, { recursive: true });
  const result = run(nested, "status");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.output)).toMatchObject({ command: "status", code: 1, result: { scope: "core" } });
  expect(readdirSync(root)).toEqual([]);
  expect(existsSync(join(repo, "clossys/director"))).toBe(false);
}, 30_000);
