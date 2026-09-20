import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { composeSkills } from "./skills.js";
import type { WorkspaceHost } from "./types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "launcher-skills-"));
  roots.push(root);
  return root;
}

function host(directory: string): WorkspaceHost {
  return {
    cwd: directory,
    env: {},
    isTTY: false,
    now: () => "2026-09-20T00:00:00.000Z",
    exists: (path) => existsSync(path),
    isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
    isSymlink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch {
        return false;
      }
    },
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeText: (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    },
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    symlink: (relativeTarget, linkPath) => {
      mkdirSync(dirname(linkPath), { recursive: true });
      if (existsSync(linkPath)) rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(relativeTarget, linkPath, "dir");
    },
    readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    run: () => ({ status: 1, stdout: "", stderr: "unmocked" }),
    prompt: () => null,
  };
}

describe("composeSkills", () => {
  it("leaves composed SKILL.md intact when .claude/skills is a directory-symlink onto .agents/skills", () => {
    const hub = tempDir();
    mkdirSync(join(hub, ".agents", "skills"), { recursive: true });
    mkdirSync(join(hub, ".claude"), { recursive: true });
    symlinkSync(join("..", ".agents", "skills"), join(hub, ".claude", "skills"), "dir");

    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    writeFileSync(
      join(catalogue, "advisor", "SKILL.md"),
      "---\nname: clossys-advisor\ndescription: test skill for advisor\ndisable-model-invocation: true\n---\n\n# advisor\n",
    );
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });

    const result = composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    expect(result.composed).toEqual(["advisor"]);

    const skillDir = join(hub, ".agents", "skills", "clossys-advisor");
    const skillPath = join(skillDir, "SKILL.md");
    expect(lstatSync(skillDir).isSymbolicLink()).toBe(false);
    expect(lstatSync(skillDir).isDirectory()).toBe(true);
    expect(lstatSync(skillPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(skillPath).isFile()).toBe(true);
    expect(readFileSync(skillPath, "utf8")).toContain("name: clossys-advisor");

    const cursorLink = join(hub, ".cursor", "skills", "clossys-advisor");
    expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);
  });
});
