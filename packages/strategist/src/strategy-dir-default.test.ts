import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrategyRoot } from "./strategy-dir-default.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "strategy-root-default-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveStrategyRoot", () => {
  it.each(["directory", "worktree-file"])("finds the repository from nested cwd with a .git %s", marker => {
    const repo = join(sandbox, "repo");
    const cwd = join(repo, "packages", "app", "src");
    mkdirSync(cwd, { recursive: true });
    if (marker === "directory") mkdirSync(join(repo, ".git"));
    else writeFileSync(join(repo, ".git"), "gitdir: ../metadata/worktrees/app\n");

    expect(resolveStrategyRoot(undefined, cwd)).toBe(join(repo, "clossys", "agents", "director"));
  });

  it("uses the repository root when invoked at that root", () => {
    mkdirSync(join(sandbox, ".git"));
    expect(resolveStrategyRoot(undefined, sandbox)).toBe(join(sandbox, "clossys", "agents", "director"));
  });

  it("selects the nearest repository boundary", () => {
    mkdirSync(join(sandbox, ".git"));
    const nestedRepo = join(sandbox, "nested");
    const cwd = join(nestedRepo, "src");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(nestedRepo, ".git"), "gitdir: ../metadata/worktrees/nested\n");
    expect(resolveStrategyRoot(undefined, cwd)).toBe(join(nestedRepo, "clossys", "agents", "director"));
  });

  it("falls back to cwd outside a repository", () => {
    const cwd = join(sandbox, "plain", "nested");
    mkdirSync(cwd, { recursive: true });
    expect(resolveStrategyRoot(undefined, cwd)).toBe(join(cwd, "clossys", "agents", "director"));
  });

  it("uses process cwd when no cwd is supplied", () => {
    const original = process.cwd();
    process.chdir(sandbox);
    try {
      expect(resolveStrategyRoot()).toBe(join(sandbox, "clossys", "agents", "director"));
    } finally {
      process.chdir(original);
    }
  });

  it("resolves explicit relative roots from cwd without repository rebasing", () => {
    mkdirSync(join(sandbox, ".git"));
    const cwd = join(sandbox, "packages", "app");
    mkdirSync(cwd, { recursive: true });
    expect(resolveStrategyRoot("../custom-root", cwd)).toBe(resolve(cwd, "../custom-root"));
    expect(resolveStrategyRoot("clossys/strategist", cwd)).toBe(join(cwd, "clossys", "strategist"));
    expect(resolveStrategyRoot("", cwd)).toBe(cwd);
  });

  it("preserves explicit absolute root resolution", () => {
    const explicit = join(sandbox, "custom-root");
    expect(resolveStrategyRoot(explicit, join(sandbox, "other"))).toBe(explicit);
  });

  it("does not create a missing default", () => {
    const expected = join(sandbox, "clossys", "agents", "director");
    expect(resolveStrategyRoot(undefined, sandbox)).toBe(expected);
    expect(existsSync(expected)).toBe(false);
  });

  it.each(["clossys/agents/strategist", "clossys/strategist", "strategy"])("reads only legacy %s with a notice", legacy => {
    const root = join(sandbox, legacy);
    mkdirSync(root, { recursive: true });
    const notice = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(resolveStrategyRoot(undefined, sandbox)).toBe(root);
      expect(notice).toHaveBeenCalledWith(expect.stringContaining("read-only"));
      expect(notice).toHaveBeenCalledWith(expect.stringContaining("clossys/agents/director"));
      expect(() => resolveStrategyRoot(undefined, sandbox, "write")).toThrow(/retired/);
      expect(() => resolveStrategyRoot(root, sandbox, "write")).toThrow(/retired/);
    } finally { notice.mockRestore(); }
  });

  const paths = ["clossys/agents/director", "clossys/agents/strategist", "clossys/strategist", "strategy"];
  const pairs = paths.flatMap((path, index) => paths.slice(index + 1).map(other => [path, other]));
  it.each(pairs)("refuses competing defaults %s and %s", (left, right) => {
    mkdirSync(join(sandbox, left!), { recursive: true });
    mkdirSync(join(sandbox, right!), { recursive: true });
    expect(() => resolveStrategyRoot(undefined, sandbox)).toThrow(/refusing to silently pick/);
    expect(resolveStrategyRoot("custom-root", sandbox)).toBe(join(sandbox, "custom-root"));
  });
});
