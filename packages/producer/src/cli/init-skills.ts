/**
 * `clossys init` places the agent skills of the installed clossys packages where chat agents discover them
 * (foundry-build-0048 SKILL-LINK). For each `node_modules/@clossys/<role>` whose `skill/SKILL.md` exists, its `skill/`
 * folder is copied (never linked) to `.claude/skills/clossys-<role>/` and `.agents/skills/clossys-<role>/`. A file is
 * written only when its bytes differ, so a second init on an unchanged install changes nothing and a changed package
 * overwrites its copy; a file the package does not ship is never touched. `CLAUDE.md` gets the `@AGENTS.md` line once.
 * `AGENTS.md` gets the managed entry block (views/entry-block.ts): the covered scope generated from the installed agents
 * and the workspace records, when to use the `clossys-producer` skill (on invocation or a covered ask only), and that
 * records change only through `clossys` verbs. Only the text between its markers is managed.
 * `skillFindings` is the check init runs after placing: a role with a package skill and no discoverable copy fails.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ensureEntryBlock, type EntryBlockResult } from "../views/entry-block.js";

export const SKILL_HOMES = [join(".claude", "skills"), join(".agents", "skills")] as const;
export const CLAUDE_IMPORT = "@AGENTS.md";

export interface InitSkills {
  readonly roles: readonly string[];
  /** Workspace-relative files written by this run (absent or different bytes before). */
  readonly written: readonly string[];
  readonly claude: "added" | "present";
  /** The AGENTS.md entry block: added, updated between its markers, present (same bytes), or refused (unpaired markers, in issues). */
  readonly entry: EntryBlockResult["outcome"] | "refused";
  readonly issues: readonly string[];
}

/** The installed `@clossys/<role>` packages at `root` that ship `skill/SKILL.md`, by role, sorted. */
export function skillRoles(root: string): { role: string; skill: string }[] {
  const scope = join(root, "node_modules", "@clossys");
  if (!existsSync(scope)) return [];
  return readdirSync(scope).sort()
    .map(role => ({ role, skill: join(scope, role, "skill") }))
    .filter(({ skill }) => existsSync(join(skill, "SKILL.md")));
}

const filesOf = (dir: string): string[] => readdirSync(dir).sort().flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? filesOf(path).map(file => join(name, file)) : [name];
});

const target = (root: string, home: string, role: string) => join(root, home, `clossys-${role}`);

/** Copies each role's skill folder into both skill homes, then ensures CLAUDE.md imports AGENTS.md, then checks. */
export function placeSkills(root: string): InitSkills {
  const roles = skillRoles(root);
  const written: string[] = [];
  for (const { role, skill } of roles) {
    for (const home of SKILL_HOMES) {
      for (const file of filesOf(skill)) {
        const to = join(target(root, home, role), file);
        const bytes = readFileSync(join(skill, file));
        if (existsSync(to) && readFileSync(to).equals(bytes)) continue;
        mkdirSync(join(to, ".."), { recursive: true });
        writeFileSync(to, bytes);
        written.push(relative(root, to));
      }
    }
  }
  const claude = ensureClaudeImport(root);
  const issues = skillFindings(root);
  let entry: InitSkills["entry"];
  try { entry = ensureEntryBlock(root).outcome; }
  catch (error) { entry = "refused"; issues.push(`entry: ${error instanceof Error ? error.message : String(error)}`); }
  return { roles: roles.map(item => item.role), written, claude, entry, issues };
}

/** Writes `CLAUDE.md` as the one line `@AGENTS.md` when missing; adds the line only when an existing file lacks it. */
export function ensureClaudeImport(root: string): "added" | "present" {
  const file = join(root, "CLAUDE.md");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).some(line => line.trim() === CLAUDE_IMPORT)) return "present";
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${current}${separator}${CLAUDE_IMPORT}\n`);
  return "added";
}

/** One finding per role whose package ships a skill that a skill home does not hold byte-equal, naming the role. */
export function skillFindings(root: string): string[] {
  const findings: string[] = [];
  for (const { role, skill } of skillRoles(root)) {
    for (const home of SKILL_HOMES) {
      const dir = target(root, home, role);
      const stale = filesOf(skill).filter(file => !existsSync(join(dir, file)) || !readFileSync(join(dir, file)).equals(readFileSync(join(skill, file))));
      if (stale.length) findings.push(`skills: ${role} has no discoverable skill at ${join(home, `clossys-${role}`)} (${stale.length} file${stale.length === 1 ? "" : "s"} missing or different)`);
    }
  }
  return findings;
}
