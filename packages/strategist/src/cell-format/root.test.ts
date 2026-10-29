import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as publicCellFormat from "@clossys/strategist/cell-format";
import { resolveCellRoot } from "./index.js";
import type { CellAgent, ResolveCellRootOptions } from "./index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function temp() { const root = mkdtempSync(join(tmpdir(), "cell-root-")); roots.push(root); return root; }
const agents = ["designer", "writer", "publisher", "strategist"] as const satisfies readonly CellAgent[];

describe("consumer cell root resolution", () => {
  it("defaults every role to the repository's clossys/agents directory", () => {
    const repo = temp(); mkdirSync(join(repo, ".git"));
    for (const agent of agents) expect(resolveCellRoot(agent, { cwd: repo })).toBe(join(repo, "clossys", "agents", agent));
    expect(readdirSync(repo)).toEqual([".git"]);
  });

  it.each(["directory", "worktree file"])("finds the repository from nested apps/admin with a .git %s", kind => {
    const repo = temp(); const cwd = join(repo, "apps", "admin"); mkdirSync(cwd, { recursive: true });
    if (kind === "directory") mkdirSync(join(repo, ".git"));
    else writeFileSync(join(repo, ".git"), "gitdir: ../neutral-git-worktree\n");
    for (const agent of agents) expect(resolveCellRoot(agent, { cwd })).toBe(join(repo, "clossys", "agents", agent));
    if (kind === "worktree file") expect(readFileSync(join(repo, ".git"), "utf8")).toBe("gitdir: ../neutral-git-worktree\n");
  });

  it("uses the nearest repository marker", () => {
    const outer = temp(); const nested = join(outer, "nested"); const cwd = join(nested, "apps", "admin");
    mkdirSync(cwd, { recursive: true }); mkdirSync(join(outer, ".git")); mkdirSync(join(nested, ".git"));
    expect(resolveCellRoot("writer", { cwd })).toBe(join(nested, "clossys", "agents", "writer"));
  });

  it("accepts explicit absolute or cwd-relative repository roots without a git marker", () => {
    const repo = temp(); const cwd = join(repo, "apps", "admin"); mkdirSync(cwd, { recursive: true });
    expect(resolveCellRoot("publisher", { cwd, repoRoot: repo })).toBe(join(repo, "clossys", "agents", "publisher"));
    expect(resolveCellRoot("publisher", { cwd, repoRoot: "../.." })).toBe(join(repo, "clossys", "agents", "publisher"));
    expect(resolveCellRoot("publisher", { cwd })).toBe(join(cwd, "clossys", "agents", "publisher"));
  });

  it("keeps explicit relative and absolute root overrides based on cwd, including old layouts", () => {
    const repo = temp(); const cwd = join(repo, "apps", "admin"); mkdirSync(cwd, { recursive: true }); mkdirSync(join(repo, ".git"));
    for (const root of ["custom-cells", "../shared cells", "clossys/writer", "../../strategist", "../../packages/writer/clossys/writer"]) {
      expect(resolveCellRoot("writer", { cwd, repoRoot: repo, root })).toBe(resolve(cwd, root));
    }
    const absolute = join(repo, "override cells");
    expect(resolveCellRoot("writer", { cwd, root: absolute })).toBe(absolute);
  });

  it("does not choose an existing legacy or package-local root as a default", () => {
    const repo = temp(); const cwd = join(repo, "apps", "admin"); mkdirSync(join(repo, ".git"));
    for (const path of ["clossys/writer", "apps/admin/clossys/writer", "packages/writer/clossys/writer", "strategist"]) mkdirSync(join(repo, path), { recursive: true });
    expect(resolveCellRoot("writer", { cwd })).toBe(join(repo, "clossys", "agents", "writer"));
    expect(resolveCellRoot("strategist", { cwd })).toBe(join(repo, "clossys", "agents", "strategist"));
  });

  it("uses process.cwd when cwd is omitted", () => {
    expect(resolveCellRoot("designer", { repoRoot: "." })).toBe(resolve("clossys", "agents", "designer"));
    expect(resolveCellRoot("designer", { root: "custom-cells" })).toBe(resolve("custom-cells"));
  });

  it.each(["", " writer", "WRITER", "writer/../designer", "admin", "toString", undefined, null, 1])("rejects an unsupported agent %j even with an explicit root", agent => {
    expect(() => resolveCellRoot(agent as CellAgent, { root: "custom-cells" })).toThrow(/agent/i);
  });

  it.each(["root", "repoRoot", "cwd"] as const)("refuses empty, non-string or NUL-containing %s rather than defaulting", field => {
    for (const value of ["", "   ", "\u0000", null, 42]) {
      expect(() => resolveCellRoot("writer", { [field]: value } as ResolveCellRootOptions)).toThrow(new RegExp(field));
    }
  });

  it.each([null, [], "root"])("rejects invalid options %j", options => {
    expect(() => resolveCellRoot("writer", options as ResolveCellRootOptions)).toThrow(/options/i);
  });

  it("exports the resolver through the installed public cell-format subpath", () => {
    const repo = temp();
    expect(publicCellFormat.resolveCellRoot("writer", { repoRoot: repo })).toBe(join(repo, "clossys", "agents", "writer"));
  });

  it("lets public store readers consume all four canonical roots from nested cwd without altering input bytes", async () => {
    const repo = temp(); const cwd = join(repo, "apps", "admin"); mkdirSync(cwd, { recursive: true }); mkdirSync(join(repo, ".git"));
    const source = "---\nid: example.current\nversion: 1\nstatus: active\nupdated: 2026-10-29\nconfirmed: migration:2026-10-29\n---\n## Example\n- Neutral fixture.\n";
    const tree = JSON.stringify({ schemaVersion: 1, active: { "example.current": 1 } });
    for (const agent of agents) {
      const root = join(repo, "clossys", "agents", agent);
      const cell = join(root, "cells", "example.current", "v1.md"); mkdirSync(join(root, "cells", "example.current"), { recursive: true });
      writeFileSync(cell, source); writeFileSync(join(root, "tree.json"), tree);
      const resolved = publicCellFormat.resolveCellRoot(agent, { cwd });
      expect(resolved).toBe(root);
      expect((await publicCellFormat.readActive(resolved)).map(record => [record.id, record.version])).toEqual([["example.current", 1]]);
      expect(readFileSync(cell, "utf8")).toBe(source); expect(readFileSync(join(root, "tree.json"), "utf8")).toBe(tree);
    }
  });
});
