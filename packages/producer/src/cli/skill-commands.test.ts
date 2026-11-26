/**
 * Every `clossys ...` command the consumer-installed skills show runs as written (foundry-build-0048 CP1-HSKILL).
 * The shipped skills are packages/{designer,writer,producer,controller}/skill/*.md and the AGENTS.md pointer
 * `clossys init` writes (AGENTS_POINTER). Each command is read from a fenced code line or an inline code span that
 * starts with `clossys` (optionally after `npx` or `npx --no-install`); each `--flag` it names must appear in that
 * verb's own `--help`, which is the CLI's documented surface. A pin names its candidate as a file name with its
 * extension and an owner `--by` names the queue answer, as the pin gate requires (cli/pin.ts runTargetPin). The rule for
 * who picks and pins is one block, the same in every SKILL.md.
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENTS_POINTER } from "../views/agents-pointer.js";
import { runCli } from "./main.js";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_PACKAGES = ["designer", "writer", "producer", "controller"] as const;
const SHARED_RULE_HEADING = "## Who picks and pins";

interface Source { readonly name: string; readonly text: string }

function sources(): Source[] {
  const out: Source[] = [];
  for (const pkg of SKILL_PACKAGES) {
    const dir = join(PACKAGES, pkg, "skill");
    for (const file of readdirSync(dir).filter(name => name.endsWith(".md")).sort()) {
      out.push({ name: `${pkg}/skill/${file}`, text: readFileSync(join(dir, file), "utf8") });
    }
  }
  out.push({ name: "AGENTS.md (AGENTS_POINTER)", text: AGENTS_POINTER });
  return out;
}

const COMMAND_HEAD = /^(?:\$\s+)?(?:npx\s+(?:--no-install\s+)?)?clossys\s+(?=[a-z])/;

/** The clossys commands of one markdown text: fenced code lines (with `\` continuations) and inline code spans. */
function commandsOf(text: string): string[] {
  const commands: string[] = [];
  const prose: string[] = [];
  let fenced = false;
  let pending = "";
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; pending = ""; prose.push(""); continue; }
    if (!fenced) { prose.push(line); continue; }
    const joined = `${pending}${line.trim()}`;
    if (joined.endsWith("\\")) { pending = `${joined.slice(0, -1)} `; continue; }
    pending = "";
    const code = joined.replace(/\s#\s.*$/, "").trim();
    if (COMMAND_HEAD.test(code)) commands.push(code);
  }
  for (const match of prose.join("\n").matchAll(/`([^`]+)`/g)) {
    const span = match[1]!.replace(/\s+/g, " ").trim();
    if (COMMAND_HEAD.test(span)) commands.push(span);
  }
  return commands;
}

/** The words of a command after `clossys`: split on spaces, keeping a `<placeholder with spaces>` (nested too) one word. */
function wordsOf(command: string): string[] {
  const words: string[] = [];
  let word = "", depth = 0;
  for (const char of command.replace(COMMAND_HEAD, "")) {
    if (char === "<") depth += 1;
    else if (char === ">" && depth > 0) depth -= 1;
    if (char === " " && depth === 0) { if (word) words.push(word); word = ""; continue; }
    word += char;
  }
  if (word) words.push(word);
  return words;
}

/** The argv a command's help is read with: the verb, and for a loop run its loop. */
function helpArgv(command: string): string[] {
  const words = wordsOf(command);
  const verb = words[0]!;
  if (verb === "run" && words[1]?.startsWith("loop.")) return ["run", "loop.fill", "--help"];
  return [verb, "--help"];
}

const flagsOf = (command: string): string[] => [...new Set([...command.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)].map(m => m[0]))];
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unquote = (word: string): string => word.replace(/^["']|["']$/g, "");

/** What the pin gate refuses in a `clossys pin` command as written (empty when it may run). */
function pinIssues(command: string): string[] {
  const words = wordsOf(command);
  if (words[0] !== "pin" || words.length < 2) return [];
  const issues: string[] = [];
  const candidate = words[2];
  if (candidate !== undefined && !candidate.startsWith("-") && !/\.(md|json|svg)$/.test(candidate) && !/^<[^>]*file[^>]*>$/.test(candidate)) {
    issues.push(`candidate ${candidate} is not a file name with its extension (<name>-v<n>.md|json|svg)`);
  }
  const at = words.indexOf("--by");
  const by = at < 0 ? undefined : words[at + 1] && unquote(words[at + 1]!);
  if (by === undefined) issues.push("no --by: the default owner names no queue answer and is refused");
  else if (/^owner/.test(by) && !/^owner:queue\./.test(by)) issues.push(`--by ${by} names no queue answer (owner:queue.<kind>#<id>)`);
  if (words.includes("--confirm") && !(by !== undefined && /^owner:queue\./.test(by))) issues.push("--confirm is the owner's: --by owner:queue.<kind>#<id>");
  if (words.includes("--confirm") && words.includes("--basis")) issues.push("--confirm takes no --basis");
  return issues;
}

const helpCache = new Map<string, Promise<{ exit: number; text: string }>>();
let helpCwd: string | undefined;
function helpOf(argv: string[]): Promise<{ exit: number; text: string }> {
  const key = argv.join(" ");
  let held = helpCache.get(key);
  if (!held) {
    helpCwd ??= mkdtempSync(join(tmpdir(), "skill-commands-"));
    held = runCli(argv, helpCwd).then(result => ({ exit: result.exitCode, text: result.message ?? "" }), (error: unknown) => ({ exit: 1, text: String(error) }));
    helpCache.set(key, held);
  }
  return held;
}

async function issuesOf(source: Source): Promise<string[]> {
  const issues: string[] = [];
  for (const command of commandsOf(source.text)) {
    const argv = helpArgv(command);
    const help = await helpOf(argv);
    if (help.exit !== 0 || !/Usage:/.test(help.text)) { issues.push(`${command}: \`clossys ${argv.join(" ")}\` printed no usage`); continue; }
    for (const flag of flagsOf(command)) {
      if (!new RegExp(`(?<![\\w-])${escape(flag)}(?![\\w-])`).test(help.text)) issues.push(`${command}: ${flag} is not in \`clossys ${argv.join(" ")}\``);
    }
    for (const issue of pinIssues(command)) issues.push(`${command}: ${issue}`);
  }
  return issues;
}

describe("the shipped skills' clossys commands run as written", () => {
  it("finds the commands of the shipped skills", () => {
    const all = sources().flatMap(source => commandsOf(source.text));
    expect(all.length).toBeGreaterThan(40);
    expect(all).toContain("clossys views list");
  });

  for (const source of sources()) {
    it(`${source.name}: every flag is in its verb's help, every pin is a form the gate accepts`, async () => {
      expect(await issuesOf(source)).toEqual([]);
    }, 120_000);
  }

  it("every SKILL.md states the same rule for who picks and pins", () => {
    const blocks = SKILL_PACKAGES.map(pkg => {
      const text = readFileSync(join(PACKAGES, pkg, "skill", "SKILL.md"), "utf8");
      const start = text.indexOf(`\n${SHARED_RULE_HEADING}\n`);
      if (start < 0) return `${pkg}: no ${SHARED_RULE_HEADING} section`;
      const end = text.indexOf("\n## ", start + 1);
      return text.slice(start, end < 0 ? undefined : end).trim();
    });
    expect(blocks[0]).toMatch(/^## Who picks and pins/);
    for (const block of blocks.slice(1)) expect(block).toBe(blocks[0]);
  });
});
