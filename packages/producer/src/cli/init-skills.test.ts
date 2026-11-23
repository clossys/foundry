/**
 * foundry-build-0048 SKILL-LINK: `clossys init` copies every installed clossys package's `skill/` folder to
 * `.claude/skills/clossys-<role>/` and `.agents/skills/clossys-<role>/`, writes `CLAUDE.md` importing `@AGENTS.md`, and
 * fails naming the role when a package skill has no discoverable copy.
 * Synthetic: a tmp workspace whose `node_modules/@clossys/<role>/skill` folders are small fixtures.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureClaudeImport, placeSkills, SKILL_HOMES, skillFindings } from "./init-skills.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(roles: readonly string[] = ["advisor", "writer"]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "init-skills-")));
  roots.push(root);
  for (const role of roles) {
    const skill = join(root, "node_modules", "@clossys", role, "skill");
    mkdirSync(join(skill, "references"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), `---\nname: ${role}\n---\n# ${role}\n`);
    writeFileSync(join(skill, "references", "notes.md"), `${role} notes\n`);
  }
  // A package without skill/SKILL.md is not placed.
  mkdirSync(join(root, "node_modules", "@clossys", "plain"), { recursive: true });
  return root;
}

/** Every file under `dir` with its bytes and mtime, keyed by relative path. */
function snapshot(dir: string, prefix = ""): Record<string, { bytes: string; mtime: number }> {
  const out: Record<string, { bytes: string; mtime: number }> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, snapshot(path, join(prefix, name)));
    else out[join(prefix, name)] = { bytes: readFileSync(path, "base64"), mtime: statSync(path).mtimeMs };
  }
  return out;
}
const bytesOf = (dir: string) => Object.fromEntries(Object.entries(snapshot(dir)).map(([file, entry]) => [file, entry.bytes]));

describe("clossys init places installed agent skills", () => {
  it("fresh placement copies each package skill folder byte-equal into both skill homes", () => {
    const root = workspace();
    const result = placeSkills(root);
    expect(result.roles).toEqual(["advisor", "writer"]);
    expect(result.issues).toEqual([]);
    for (const home of SKILL_HOMES) {
      expect(readdirSync(join(root, home)).sort()).toEqual(["clossys-advisor", "clossys-writer"]);
      for (const role of ["advisor", "writer"]) {
        expect(bytesOf(join(root, home, `clossys-${role}`))).toEqual(bytesOf(join(root, "node_modules", "@clossys", role, "skill")));
      }
    }
    expect(result.written).toHaveLength(8);
  });

  it("a second run on an unchanged install writes nothing and leaves every byte and mtime as it was", () => {
    const root = workspace();
    placeSkills(root);
    const before = SKILL_HOMES.map(home => snapshot(join(root, home)));
    const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
    const again = placeSkills(root);
    expect(again.written).toEqual([]);
    expect(again.claude).toBe("present");
    expect(SKILL_HOMES.map(home => snapshot(join(root, home)))).toEqual(before);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(claude);
  });

  it("a changed package overwrites its copy, and a foreign file in or beside a clossys folder is left untouched", () => {
    const root = workspace();
    placeSkills(root);
    const foreignInside = join(root, ".claude", "skills", "clossys-writer", "mine.md");
    const foreignSkill = join(root, ".claude", "skills", "my-skill", "SKILL.md");
    mkdirSync(join(foreignSkill, ".."), { recursive: true });
    writeFileSync(foreignInside, "owner file\n");
    writeFileSync(foreignSkill, "owner skill\n");
    writeFileSync(join(root, "node_modules", "@clossys", "writer", "skill", "SKILL.md"), "# writer, next version\n");
    const result = placeSkills(root);
    expect(result.written.sort()).toEqual([join(".agents", "skills", "clossys-writer", "SKILL.md"), join(".claude", "skills", "clossys-writer", "SKILL.md")]);
    expect(readFileSync(join(root, ".claude", "skills", "clossys-writer", "SKILL.md"), "utf8")).toBe("# writer, next version\n");
    expect(readFileSync(foreignInside, "utf8")).toBe("owner file\n");
    expect(readFileSync(foreignSkill, "utf8")).toBe("owner skill\n");
    expect(result.issues).toEqual([]);
  });

  it("CLAUDE.md is created as the one line @AGENTS.md, and an existing file that has the line is left unchanged", () => {
    const fresh = workspace([]);
    expect(ensureClaudeImport(fresh)).toBe("added");
    expect(readFileSync(join(fresh, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");

    const owned = workspace([]);
    writeFileSync(join(owned, "CLAUDE.md"), "# Notes\n\n@AGENTS.md\nmore\n");
    expect(ensureClaudeImport(owned)).toBe("present");
    expect(readFileSync(join(owned, "CLAUDE.md"), "utf8")).toBe("# Notes\n\n@AGENTS.md\nmore\n");

    const other = workspace([]);
    writeFileSync(join(other, "CLAUDE.md"), "# Notes");
    expect(ensureClaudeImport(other)).toBe("added");
    expect(readFileSync(join(other, "CLAUDE.md"), "utf8")).toBe("# Notes\n@AGENTS.md\n");
  });

  it("the missing-skill check fails naming the role when a package skill has no discoverable copy", () => {
    const root = workspace();
    expect(skillFindings(root)).toEqual([
      "skills: advisor has no discoverable skill at .claude/skills/clossys-advisor (2 files missing or different)",
      "skills: advisor has no discoverable skill at .agents/skills/clossys-advisor (2 files missing or different)",
      "skills: writer has no discoverable skill at .claude/skills/clossys-writer (2 files missing or different)",
      "skills: writer has no discoverable skill at .agents/skills/clossys-writer (2 files missing or different)",
    ]);
    placeSkills(root);
    expect(skillFindings(root)).toEqual([]);
    writeFileSync(join(root, ".claude", "skills", "clossys-writer", "SKILL.md"), "edited\n");
    expect(skillFindings(root)).toEqual(["skills: writer has no discoverable skill at .claude/skills/clossys-writer (1 file missing or different)"]);
    expect(existsSync(join(root, ".claude", "skills", "clossys-plain"))).toBe(false);
  });
});
