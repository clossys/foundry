// The owned-rules check behind reviewer-check, this factory agent's status probe: does the agent's skill list
// exactly the rules the rule registry gives it as owner_agent? Contract: the status field of the
// repository's package framework (not shipped): read-only, exactly one check-output envelope,
// and an exit code folded from its verdict.
//
//   reviewer-check [<registry.json>] [--skill <SKILL.md>]
//
// <registry.json> defaults to scripts/rules/registry.json under the working directory, and
// --skill defaults to this package's own shipped skill/SKILL.md. Exit 0 when the two lists
// match, 1 with one finding for each missing or extra rule, 2 on a usage or read error.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCheckOutputEnvelope, envelopeToExitCode, type CheckFinding, type GateVerdict } from "./generated/check-output-envelope.js";

const START = "<!-- owned-rules:start";
const END = "<!-- owned-rules:end -->";
const RULE_LINE = /^- (R-[A-Z0-9-]+)$/;
const DEFAULT_REGISTRY = "scripts/rules/registry.json";

export const USAGE = [
  "Usage: reviewer-check [<registry.json>] [--skill <SKILL.md>]",
  "",
  "Checks that the skill's owned-rules block lists exactly the rules whose owner_agent is this agent.",
  `  <registry.json>   the rule registry (default: ${DEFAULT_REGISTRY} under the working directory)`,
  "  --skill <path>    the skill to check (default: this package's own skill/SKILL.md)",
  "  --help            print this message and exit 0",
  "Exit 0 when the lists match, 1 when a rule is missing or extra, 2 on a usage or read error.",
].join("\n");

class ReadError extends Error {}

function parseArgs(argv: readonly string[]): { registry?: string; skill?: string } {
  const out: { registry?: string; skill?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--skill") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-") || out.skill !== undefined) throw new ReadError("--skill needs exactly one path");
      out.skill = value;
    } else if (arg.startsWith("-") || out.registry !== undefined) {
      throw new ReadError(`unexpected argument ${JSON.stringify(arg)}`);
    } else {
      out.registry = arg;
    }
  }
  return out;
}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ReadError(`cannot read the ${what} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The rule ids the registry gives `agent` as owner_agent, in registry order. */
export function ownedInRegistry(text: string, path: string, agent: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ReadError(`the rule registry at ${path} is not JSON`);
  }
  const rules = (doc as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) throw new ReadError(`the rule registry at ${path} has no rules list`);
  const owned: string[] = [];
  for (const row of rules as Array<{ id?: unknown; owner_agent?: unknown } | null>) {
    if (typeof row?.id !== "string" || typeof row?.owner_agent !== "string") throw new ReadError(`the rule registry at ${path} has a rule without a string id and owner_agent`);
    if (row.owner_agent === agent) owned.push(row.id);
  }
  return owned;
}

/** The rule ids the skill's owned-rules block lists, in order. */
export function listedInSkill(text: string, path: string): string[] {
  const start = text.indexOf(START);
  const open = start < 0 ? -1 : text.indexOf("-->", start);
  const end = open < 0 ? -1 : text.indexOf(END, open);
  if (end < 0) throw new ReadError(`the skill at ${path} has no owned-rules block`);
  const listed: string[] = [];
  for (const line of text.slice(open + 3, end).split("\n").map((item) => item.trim()).filter(Boolean)) {
    const match = RULE_LINE.exec(line);
    if (!match) throw new ReadError(`the owned-rules block in ${path} has a line that is not "- R-<ID>": ${JSON.stringify(line)}`);
    listed.push(match[1] as string);
  }
  return listed;
}

/** Runs the check for the package whose manifest is at `manifestUrl`; returns what to print and the exit code. */
export function runCheck(argv: readonly string[], manifestUrl: URL = new URL("../package.json", import.meta.url)): { stdout: string; exitCode: 0 | 1 | 2 } {
  if (argv.includes("--help") || argv.includes("-h")) return { stdout: `${USAGE}\n`, exitCode: 0 };
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as { name: string; version: string };
  const agent = manifest.name.split("/").pop() as string;
  let verdict: GateVerdict;
  let summary: string;
  let findings: CheckFinding[];
  let nextAction: string | undefined;
  try {
    const args = parseArgs(argv);
    const registryPath = resolve(args.registry ?? DEFAULT_REGISTRY);
    const skillPath = args.skill ? resolve(args.skill) : fileURLToPath(new URL("skill/SKILL.md", manifestUrl));
    const owned = ownedInRegistry(readText(registryPath, "rule registry"), registryPath, agent);
    const listed = listedInSkill(readText(skillPath, "skill"), skillPath);
    findings = [
      ...owned.filter((id) => !listed.includes(id)).map((id) => ({ rule: "missing-rule", severity: "error" as const, path: skillPath, message: `${id} names ${agent} as owner_agent in the registry, but the skill does not list it.` })),
      ...listed.filter((id) => !owned.includes(id)).map((id) => ({ rule: "extra-rule", severity: "error" as const, path: skillPath, message: `The skill lists ${id}, but the registry does not name ${agent} as its owner_agent.` })),
    ];
    verdict = findings.length === 0 ? "satisfied" : "violated";
    summary = findings.length === 0
      ? `The ${agent} skill lists exactly the ${owned.length} rule(s) the registry gives it.`
      : `The ${agent} skill and the rule registry disagree on ${findings.length} rule(s).`;
    if (findings.length > 0) nextAction = `Make the skill's owned-rules block list exactly: ${owned.join(", ") || "no rules"}.`;
  } catch (error) {
    if (!(error instanceof ReadError)) throw error;
    verdict = "indeterminate";
    summary = "The owned rules could not be compared, because an input could not be read.";
    findings = [{ rule: "unreadable-input", severity: "error", message: error.message }];
    nextAction = `Run ${agent}-check --help for the expected inputs.`;
  }
  const envelope = buildCheckOutputEnvelope({ package: manifest.name, version: manifest.version, verdict, summary, findings, ...(nextAction ? { nextAction } : {}) });
  return { stdout: `${JSON.stringify(envelope, null, 2)}\n`, exitCode: envelopeToExitCode(envelope) };
}
