import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/cli/index.js");
const proof = "advantage.proposition.proof";
const voice = "identity.verbal.voice";
let root: string;
let director: string;
function cell(id: string, version: number, status: "active" | "draft", direction: string): void {
  mkdirSync(join(director, "cells", id), { recursive: true });
  writeFileSync(join(director, "cells", id, `v${version}.md`), `---
id: ${id}
version: ${version}
status: ${status}
updated: 2026-10-29
cites: []
feeds: []
functions: []
${status === "active" ? "confirmed: msg:2026-10-29-1#U1\n" : ""}---

## Direction
- ${direction}

## Because
- A stated reason.

## Watch
- A measurable signal.
`);
}
function run(args = ["--check", "--json"], cwd = root) {
  return spawnSync(process.execPath, [entry, "direct", ...args], { cwd, encoding: "utf8" });
}
function snapshot(dir = root): unknown[] {
  return readdirSync(dir).sort().flatMap((name): unknown[] => {
    const path = join(dir, name); const stat = statSync(path);
    const item = { path: relative(root, path), mtimeMs: stat.mtimeMs };
    return stat.isDirectory() ? [item, ...snapshot(path)] : [{ ...item, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "producer-direct-"));
  director = join(root, "clossys", "agents", "director");
  mkdirSync(join(director, "findings"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "throw new Error('Config must not execute');\n");
  cell(proof, 1, "active", 'Never-claim: "Guaranteed results"');
  cell(voice, 1, "active", 'Never: "Flawless service"');
  cell(voice, 2, "draft", 'Never: "Draft-only prohibition" TODO-OWNER');
  writeFileSync(join(director, "tree.json"), JSON.stringify({ schemaVersion: 1, active: { [proof]: 1, [voice]: 1 }, meta: { archetype: "service" } }));
  writeFileSync(join(director, "findings", "service-scale.md"), "---\nid: service-scale\nsource: user\nobserved: 2026-10-29\nby: user\nvalue: 50\nunit: users\n---\n- A measured service size.\n");
  writeFileSync(join(root, "page.md"), "Tools for useful work.\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys direct native checks", () => {
  it("checks a native shared tree, reports draft/TODO state and preserves every input byte and mtime", () => {
    const before = snapshot();
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 0, verb: "direct", root, check: true,
      summary: { active: 2, draft: 1, todoOwner: 1 }, grounding: { findings: [] }, wontClaim: { state: "clean" }, limits: [] });
    expect(snapshot()).toEqual(before);
    expect(run([]).status).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("returns native grounding findings and traces recorded values", () => {
    writeFileSync(join(root, "page.md"), "We support 100 users.\n");
    const hit = run();
    expect(hit.status).toBe(1);
    expect(JSON.parse(hit.stdout)).toMatchObject({ grounding: { findings: [{ rule: "untraced-numeric-claim", file: "page.md", line: 1 }] } });
    writeFileSync(join(root, "page.md"), "We support 50 users.\n");
    expect(run().status).toBe(0);
  });

  it("checks active prohibitions, excludes Director source and leaves draft prohibitions informational", () => {
    writeFileSync(join(root, "page.md"), "Draft-only prohibition\n");
    expect(run().status).toBe(0);
    writeFileSync(join(root, "page.md"), "We offer GUARANTEED RESULTS.\n");
    const before = snapshot(); const hit = run();
    expect(hit.status).toBe(1);
    expect(JSON.parse(hit.stdout)).toMatchObject({ wontClaim: { state: "hit", findings: [{ file: "page.md", line: 1 }] } });
    const human = run(["--check"]);
    expect(human.stderr).toContain("[wont-claim] page.md:1");
    expect(snapshot()).toEqual(before);
  });

  it("reports missing evidence as incomplete even when a prohibition finding is present", () => {
    rmSync(join(director, "findings"), { recursive: true });
    writeFileSync(join(root, "page.md"), "Guaranteed results\n");
    const result = run();
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ wontClaim: { state: "hit" }, limits: ["findings/: no valid findings to read"] });
  });

  it("fails closed for missing roots, missing active targets and symbolic links", () => {
    const tree = join(director, "tree.json");
    writeFileSync(tree, JSON.stringify({ schemaVersion: 1, active: { [proof]: 9 } }));
    expect(run().status).toBe(2);
    rmSync(tree); symlinkSync(join(root, "page.md"), tree);
    expect(run().status).toBe(2);
    rmSync(tree);
    expect(JSON.parse(run().stdout).message).toContain("tree.json is missing");
  });

  it("requires surface coverage and honors --root from another working directory", () => {
    rmSync(join(root, "page.md"));
    const incomplete = run();
    expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout).limits).toContain("no files scanned");
    writeFileSync(join(root, "page.md"), "Useful tools.\n");
    const nested = join(root, "nested"); mkdirSync(nested);
    const result = run(["--root", "..", "--check", "--json"], nested);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).root).toBe(root);
  });
});
