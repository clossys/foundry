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
    remove: (path) => {
      rmSync(path, { recursive: true, force: true });
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

  it("prefers an installed package skill body over the catalogue", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillFixture("advisor", "catalogue-voice-marker"));
    const installedSkill = join(hub, "node_modules", "@clossys", "advisor", "skill", "SKILL.md");
    mkdirSync(dirname(installedSkill), { recursive: true });
    writeFileSync(installedSkill, skillFixture("advisor", "installed-voice-marker"));
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });

    composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    expect(readFileSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"), "utf8")).toContain(
      "installed-voice-marker",
    );
    expect(readFileSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"), "utf8")).not.toContain(
      "catalogue-voice-marker",
    );
  });

  it("falls back to the catalogue when node_modules is absent", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillFixture("advisor", "catalogue-only-marker"));
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });

    composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    expect(readFileSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"), "utf8")).toContain(
      "catalogue-only-marker",
    );
  });

  const CONTRACT_DOC = [
    "# Conversation contract",
    "",
    "Provenance prose, never injected.",
    "",
    "## How we work together",
    "",
    "1. **Where we are** — status.",
    "2. **Your call** — a question.",
    "",
  ].join("\n");

  function skillWithLegacySections(name: string): string {
    return [
      "---",
      `name: clossys-${name}`,
      `description: test skill for ${name}`,
      "disable-model-invocation: true",
      "---",
      `# ${name}`,
      "",
      "Role content.",
      "",
      "## How we work together",
      "",
      "1. **Status** — old text.",
      "",
      "## One question at a time",
      "",
      "Old text.",
      "",
      "## When this package is installed",
      "",
      "Installed guidance.",
      "",
    ].join("\n");
  }

  it("injects the shared conversation contract in place of a skill's own legacy sections", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillWithLegacySections("advisor"));
    const launcherPackageRoot = tempDir();
    mkdirSync(join(launcherPackageRoot, "contracts"), { recursive: true });
    writeFileSync(join(launcherPackageRoot, "contracts", "conversation-contract.md"), CONTRACT_DOC);

    composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    const composed = readFileSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"), "utf8");
    expect(composed.split("## How we work together").length - 1).toBe(1);
    expect(composed).toContain("2. **Your call** — a question.");
    expect(composed).not.toContain("## One question at a time");
    expect(composed).not.toContain("1. **Status** — old text.");
    expect(composed).toContain("## When this package is installed");
  });

  it("leaves a skill untouched when no conversation contract source resolves", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillWithLegacySections("advisor"));
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });

    composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    const composed = readFileSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"), "utf8");
    expect(composed).toContain("## One question at a time");
  });

  it("writes clossys/.state/skills.json with source, version, and a content digest per composed skill", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    mkdirSync(join(catalogue, "designer"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillFixture("advisor", "catalogue-marker"));
    // Candidate discovery only looks at the catalogue/monorepo; an installed
    // node_modules skill overrides the body once a package is already a
    // candidate, so designer still needs a (unused) catalogue placeholder.
    writeFileSync(join(catalogue, "designer", "SKILL.md"), skillFixture("designer", "unused-catalogue-marker"));
    const installedSkill = join(hub, "node_modules", "@clossys", "designer", "skill", "SKILL.md");
    mkdirSync(dirname(installedSkill), { recursive: true });
    writeFileSync(installedSkill, skillFixture("designer", "installed-marker"));
    writeFileSync(
      join(hub, "node_modules", "@clossys", "designer", "package.json"),
      JSON.stringify({ name: "@clossys/designer", version: "0.4.9" }),
    );
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });
    writeFileSync(join(launcherPackageRoot, "package.json"), JSON.stringify({ name: "@clossys/launcher", version: "0.2.0" }));

    composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    const manifest = JSON.parse(readFileSync(join(hub, "clossys", ".state", "skills.json"), "utf8")) as {
      schemaVersion: number;
      skills: { name: string; source: string; version?: string; sha256: string }[];
    };
    expect(manifest.schemaVersion).toBe(1);
    const byName = Object.fromEntries(manifest.skills.map((entry) => [entry.name, entry]));
    expect(byName.advisor).toMatchObject({ source: "catalogue", version: "0.2.0" });
    expect(byName.designer).toMatchObject({ source: "installed", version: "0.4.9" });
    expect(byName.advisor?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(byName.designer?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retires a skill absent from this run but present in the previous manifest, and never touches a skill it did not write", () => {
    const hub = tempDir();
    const catalogue = tempDir();
    mkdirSync(join(catalogue, "advisor"), { recursive: true });
    mkdirSync(join(catalogue, "designer"), { recursive: true });
    writeFileSync(join(catalogue, "advisor", "SKILL.md"), skillFixture("advisor", "advisor-marker"));
    writeFileSync(join(catalogue, "designer", "SKILL.md"), skillFixture("designer", "designer-marker"));
    const launcherPackageRoot = tempDir();
    mkdirSync(launcherPackageRoot, { recursive: true });

    // A skill directory this composition step never wrote must survive untouched.
    const handWritten = join(hub, ".agents", "skills", "clossys-handwritten", "SKILL.md");
    mkdirSync(dirname(handWritten), { recursive: true });
    writeFileSync(handWritten, "hand-authored, not launcher's\n");

    const first = composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    expect(first.composed.sort()).toEqual(["advisor", "designer"]);
    expect(first.retired).toEqual([]);

    // designer's catalogue source disappears (e.g. the package was removed).
    rmSync(join(catalogue, "designer"), { recursive: true, force: true });
    const second = composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue });
    expect(second.composed).toEqual(["advisor"]);
    expect(second.retired).toEqual(["designer"]);
    expect(existsSync(join(hub, ".agents", "skills", "clossys-designer"))).toBe(false);
    expect(existsSync(join(hub, ".agents", "skills", "clossys-advisor", "SKILL.md"))).toBe(true);
    expect(readFileSync(handWritten, "utf8")).toBe("hand-authored, not launcher's\n");

    const manifest = JSON.parse(readFileSync(join(hub, "clossys", ".state", "skills.json"), "utf8")) as {
      skills: { name: string }[];
    };
    expect(manifest.skills.map((entry) => entry.name)).toEqual(["advisor"]);
  });
});

function skillFixture(name: string, bodyMarker: string): string {
  return `---\nname: clossys-${name}\ndescription: test skill for ${name}\ndisable-model-invocation: true\n---\n\n# ${name}\n\n${bodyMarker}\n`;
}
