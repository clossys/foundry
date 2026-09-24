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

describe("composeSkills ownership check against the recorded digest (#1473)", () => {
  interface Fixture {
    readonly hub: string;
    readonly catalogue: string;
    readonly launcherPackageRoot: string;
    compose(): ReturnType<typeof composeSkills>;
    setSource(name: string, marker: string): void;
    dropSource(name: string): void;
    skillPath(name: string): string;
    manifest(): { name: string; sha256: string }[];
  }

  function fixture(names: readonly string[]): Fixture {
    const hub = tempDir();
    const catalogue = tempDir();
    const launcherPackageRoot = tempDir();
    const setSource = (name: string, marker: string): void => {
      mkdirSync(join(catalogue, name), { recursive: true });
      writeFileSync(join(catalogue, name, "SKILL.md"), skillFixture(name, marker));
    };
    for (const name of names) setSource(name, `${name}-v1`);
    return {
      hub,
      catalogue,
      launcherPackageRoot,
      compose: () => composeSkills(host(hub), hub, { launcherPackageRoot, skillCatalogueRoot: catalogue }),
      setSource,
      dropSource: (name) => rmSync(join(catalogue, name), { recursive: true, force: true }),
      skillPath: (name) => join(hub, ".agents", "skills", `clossys-${name}`, "SKILL.md"),
      manifest: () =>
        (JSON.parse(readFileSync(join(hub, "clossys", ".state", "skills.json"), "utf8")) as { skills: { name: string; sha256: string }[] })
          .skills,
    };
  }

  const EDIT = "\nClient's own note, added by hand.\n";

  // The #1473 reproduction: on the pre-fix code both hand edits below are gone after the second run.
  it("reproduces #1473: a client's edit survives the next run, for a still-composed skill and for a retired one", () => {
    const f = fixture(["advisor", "designer"]);
    f.compose();
    writeFileSync(f.skillPath("advisor"), readFileSync(f.skillPath("advisor"), "utf8") + EDIT);
    writeFileSync(f.skillPath("designer"), readFileSync(f.skillPath("designer"), "utf8") + EDIT);
    f.setSource("advisor", "advisor-v2");
    f.dropSource("designer");

    f.compose();

    expect(readFileSync(f.skillPath("advisor"), "utf8")).toContain("Client's own note");
    expect(readFileSync(f.skillPath("designer"), "utf8")).toContain("Client's own note");
  });

  describe("rewrite (skill still composed)", () => {
    it("matching digest: rewrites with the new content and records the new digest", () => {
      const f = fixture(["advisor"]);
      f.compose();
      const firstDigest = f.manifest()[0]?.sha256;
      f.setSource("advisor", "advisor-v2");
      const result = f.compose();
      expect(result.composed).toEqual(["advisor"]);
      expect(result.preserved).toEqual([]);
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toContain("advisor-v2");
      expect(f.manifest()[0]?.sha256).not.toBe(firstDigest);
    });

    it("edited since Launcher wrote it: leaves it as found, reports it, and keeps the old manifest entry", () => {
      const f = fixture(["advisor"]);
      f.compose();
      const recorded = f.manifest()[0];
      const edited = readFileSync(f.skillPath("advisor"), "utf8") + EDIT;
      writeFileSync(f.skillPath("advisor"), edited);
      f.setSource("advisor", "advisor-v2");

      const result = f.compose();
      expect(result.composed).toEqual([]);
      expect(result.retired).toEqual([]);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]).toMatchObject({
        packageDir: "advisor",
        action: "rewrite",
        path: join(".agents", "skills", "clossys-advisor", "SKILL.md"),
      });
      expect(result.preserved[0]?.note).toContain("was edited since Launcher last wrote it");
      expect(result.preserved[0]?.note).toContain("delete `.agents/skills/clossys-advisor`, and run launcher again");
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toBe(edited);
      expect(f.manifest()).toEqual([recorded]);

      // Still reported on the next run, not forgotten after one warning.
      expect(f.compose().preserved.map((entry) => entry.packageDir)).toEqual(["advisor"]);
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toBe(edited);
    });

    it("missing: recreates it (the documented way to accept Launcher's version after an edit)", () => {
      const f = fixture(["advisor"]);
      f.compose();
      writeFileSync(f.skillPath("advisor"), readFileSync(f.skillPath("advisor"), "utf8") + EDIT);
      f.setSource("advisor", "advisor-v2");
      expect(f.compose().preserved).toHaveLength(1);

      rmSync(dirname(f.skillPath("advisor")), { recursive: true, force: true });
      const result = f.compose();
      expect(result.composed).toEqual(["advisor"]);
      expect(result.preserved).toEqual([]);
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toContain("advisor-v2");
    });

    it("no recorded digest, content equal to what this run writes: adopts it and records the digest", () => {
      const f = fixture(["advisor"]);
      f.compose();
      const content = readFileSync(f.skillPath("advisor"), "utf8");
      rmSync(join(f.hub, "clossys"), { recursive: true, force: true });
      const result = f.compose();
      expect(result.composed).toEqual(["advisor"]);
      expect(result.preserved).toEqual([]);
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toBe(content);
      expect(f.manifest().map((entry) => entry.name)).toEqual(["advisor"]);
    });

    it("no recorded digest, different content: refuses to overwrite and records no entry", () => {
      const f = fixture(["advisor"]);
      mkdirSync(dirname(f.skillPath("advisor")), { recursive: true });
      writeFileSync(f.skillPath("advisor"), "an older or hand-written copy\n");
      const result = f.compose();
      expect(result.composed).toEqual([]);
      expect(result.preserved[0]).toMatchObject({ packageDir: "advisor", action: "rewrite" });
      expect(result.preserved[0]?.note).toContain("has no digest recorded");
      expect(readFileSync(f.skillPath("advisor"), "utf8")).toBe("an older or hand-written copy\n");
      expect(f.manifest()).toEqual([]);
    });

    it("SKILL.md that exists but cannot be read (here, a directory): leaves it as is instead of writing", () => {
      const f = fixture(["advisor"]);
      f.compose();
      rmSync(f.skillPath("advisor"), { force: true });
      mkdirSync(f.skillPath("advisor"));
      writeFileSync(join(f.skillPath("advisor"), "mine.txt"), "client content\n");
      f.setSource("advisor", "advisor-v2");

      const result = f.compose();
      expect(result.composed).toEqual([]);
      expect(result.preserved[0]).toMatchObject({ packageDir: "advisor", action: "rewrite" });
      expect(result.preserved[0]?.note).toContain("exists but could not be read");
      expect(readFileSync(join(f.skillPath("advisor"), "mine.txt"), "utf8")).toBe("client content\n");
    });

    it("a real directory at a host discovery path whose copy was edited is not replaced by a link", () => {
      const f = fixture(["advisor"]);
      f.compose();
      const discovery = join(f.hub, ".claude", "skills", "clossys-advisor");
      const edited = readFileSync(f.skillPath("advisor"), "utf8") + EDIT;
      rmSync(discovery, { recursive: true, force: true });
      mkdirSync(discovery, { recursive: true });
      writeFileSync(join(discovery, "SKILL.md"), edited);

      const result = f.compose();
      expect(result.preserved[0]).toMatchObject({ packageDir: "advisor", path: join(".claude", "skills", "clossys-advisor", "SKILL.md") });
      expect(result.preserved[0]?.note).toContain("delete `.claude/skills/clossys-advisor`");
      expect(lstatSync(discovery).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(discovery, "SKILL.md"), "utf8")).toBe(edited);
    });
  });

  describe("retire (skill no longer composed)", () => {
    it("matching digest: removes the composed output and links, and drops the manifest entry", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      f.dropSource("designer");
      const result = f.compose();
      expect(result.retired).toEqual(["designer"]);
      expect(result.preserved).toEqual([]);
      expect(existsSync(dirname(f.skillPath("designer")))).toBe(false);
      expect(existsSync(join(f.hub, ".claude", "skills", "clossys-designer"))).toBe(false);
      expect(f.manifest().map((entry) => entry.name)).toEqual(["advisor"]);
    });

    it("edited since Launcher wrote it: keeps the file and its discovery links, reports it, and keeps the entry", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      const recorded = f.manifest().find((entry) => entry.name === "designer");
      const edited = readFileSync(f.skillPath("designer"), "utf8") + EDIT;
      writeFileSync(f.skillPath("designer"), edited);
      f.dropSource("designer");

      const result = f.compose();
      expect(result.retired).toEqual([]);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]).toMatchObject({ packageDir: "designer", action: "retire" });
      expect(result.preserved[0]?.note).toContain("Launcher no longer composes this skill");
      expect(readFileSync(f.skillPath("designer"), "utf8")).toBe(edited);
      expect(lstatSync(join(f.hub, ".claude", "skills", "clossys-designer")).isSymbolicLink()).toBe(true);
      expect(f.manifest().find((entry) => entry.name === "designer")).toEqual(recorded);
    });

    it("holding files Launcher did not write: keeps the whole directory", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      const extra = join(dirname(f.skillPath("designer")), "notes.md");
      writeFileSync(extra, "client notes\n");
      f.dropSource("designer");

      const result = f.compose();
      expect(result.retired).toEqual([]);
      expect(result.preserved[0]?.note).toContain("holds files Launcher did not write (notes.md)");
      expect(readFileSync(extra, "utf8")).toBe("client notes\n");
      expect(existsSync(f.skillPath("designer"))).toBe(true);
    });

    it("SKILL.md that exists but cannot be read (here, a directory): keeps it and everything in it", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      rmSync(f.skillPath("designer"), { force: true });
      mkdirSync(f.skillPath("designer"));
      writeFileSync(join(f.skillPath("designer"), "mine.txt"), "client content\n");
      f.dropSource("designer");

      const result = f.compose();
      expect(result.retired).toEqual([]);
      expect(result.preserved[0]).toMatchObject({ packageDir: "designer", action: "retire" });
      expect(result.preserved[0]?.note).toContain("exists but could not be read");
      expect(readFileSync(join(f.skillPath("designer"), "mine.txt"), "utf8")).toBe("client content\n");
    });

    it("ignores a .DS_Store beside SKILL.md, so it does not block the retirement", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      writeFileSync(join(dirname(f.skillPath("designer")), ".DS_Store"), "finder metadata");
      f.dropSource("designer");

      const result = f.compose();
      expect(result.retired).toEqual(["designer"]);
      expect(result.preserved).toEqual([]);
      expect(existsSync(dirname(f.skillPath("designer")))).toBe(false);
    });

    it("missing: completes the retirement, removing the discovery links and the manifest entry", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      rmSync(dirname(f.skillPath("designer")), { recursive: true, force: true });
      f.dropSource("designer");
      const result = f.compose();
      expect(result.retired).toEqual(["designer"]);
      expect(result.preserved).toEqual([]);
      expect(existsSync(join(f.hub, ".claude", "skills", "clossys-designer"))).toBe(false);
      expect(f.manifest().map((entry) => entry.name)).toEqual(["advisor"]);
    });

    it("no recorded digest: never retires a skill the manifest does not record", () => {
      const f = fixture(["advisor", "designer"]);
      f.compose();
      const manifestPath = join(f.hub, "clossys", ".state", "skills.json");
      const document = JSON.parse(readFileSync(manifestPath, "utf8")) as { skills: Record<string, unknown>[] };
      for (const entry of document.skills) if (entry.name === "designer") delete entry.sha256;
      writeFileSync(manifestPath, JSON.stringify(document));
      f.dropSource("designer");

      const result = f.compose();
      expect(result.retired).toEqual([]);
      expect(result.preserved).toEqual([]);
      expect(existsSync(f.skillPath("designer"))).toBe(true);
    });
  });
});

function skillFixture(name: string, bodyMarker: string): string {
  return `---\nname: clossys-${name}\ndescription: test skill for ${name}\ndisable-model-invocation: true\n---\n\n# ${name}\n\n${bodyMarker}\n`;
}
