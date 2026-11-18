/**
 * The front door's guards. Each one refuses before anything runs or is written:
 * - no secret or environment file is ever named, read or passed to a program;
 * - doctor runs only the read-only version and repository probes;
 * - intake reaches Director only through `clossys evidence`, and never writes an agent slot;
 * - every write stays inside the workspace root.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Probe } from "./tree.js";

const SECRET_NAMES = /^(\.env(\..*)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.json)?|secrets?(\.[a-z]+)?|.*\.(pem|key|p12|pfx|keystore))$/i;
const SECRET_DIRS = new Set([".ssh", ".aws", ".gnupg", ".docker", ".kube", ".config/gh"]);

export function isSecretPath(path: string): boolean {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  if (SECRET_NAMES.test(name)) return true;
  for (let index = 0; index < parts.length; index++) {
    if (SECRET_DIRS.has(parts[index]!)) return true;
    if (SECRET_DIRS.has(`${parts[index]}/${parts[index + 1] ?? ""}`)) return true;
  }
  return false;
}

/** Path `target` resolved against `root` stays inside `root`. */
export function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(root, target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** The only probes doctor may run: version reports and the repository root. None reads a file. */
const DOCTOR_PROBES: readonly string[] = ["node --version", "npm --version", "git --version", "git rev-parse --show-toplevel"];
export function doctorProbeIssues(id: string, probe: Probe): string[] {
  const line = [probe.command, ...probe.args].join(" ");
  const issues: string[] = [];
  if (!DOCTOR_PROBES.includes(line)) issues.push(`${id}: doctor runs only ${DOCTOR_PROBES.join(", ")}; refused ${line}`);
  for (const arg of probe.args) if (isSecretPath(arg)) issues.push(`${id}: probe names a secret path`);
  return issues;
}

export interface PlannedCommand { readonly args: readonly string[]; readonly target: string }
export interface IntakePlan { readonly root: string; readonly writes: readonly string[]; readonly commands: readonly PlannedCommand[] }

const ADVISOR_DIR = "clossys/advisor/";
const AGENT_SLOTS = "clossys/agents/";

/**
 * Intake's plan, before anything runs. Advisor writes only its own record under clossys/advisor/;
 * Director evidence is reached only through `clossys evidence <owner-intake-...>`; any path under
 * clossys/agents/ (a Director, or any agent, slot) is refused outright.
 */
export function intakePlanIssues(plan: IntakePlan): string[] {
  const issues: string[] = [];
  for (const write of plan.writes) {
    const rel = relative(resolve(plan.root), resolve(plan.root, write)).split(sep).join("/");
    if (!within(plan.root, write)) issues.push(`write ${write} leaves the workspace`);
    else if (rel.startsWith(AGENT_SLOTS) || rel === AGENT_SLOTS.slice(0, -1)) issues.push(`write ${rel} is an agent slot; intake never writes Director slots (use clossys evidence)`);
    else if (!rel.startsWith(ADVISOR_DIR)) issues.push(`write ${rel} is outside clossys/advisor/; intake writes only its own record`);
    if (isSecretPath(write)) issues.push(`write ${write} names a secret path`);
  }
  for (const command of plan.commands) {
    const [verb, id] = command.args;
    if (verb !== "evidence") { issues.push(`command clossys ${verb ?? ""} refused; intake runs only clossys evidence`); continue; }
    if (!id || !/^owner-intake-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) issues.push(`evidence id ${id ?? ""} must be owner-intake-<topic>-<date>`);
    const flag = (name: string) => { const at = command.args.indexOf(name); return at >= 0 ? command.args[at + 1] : undefined; };
    if (flag("--source") !== "user") issues.push(`evidence ${id}: --source must be user`);
    if (command.args.includes("--finding")) issues.push(`evidence ${id}: owner words are not a finding`);
    const root = flag("--root");
    if (root === undefined || resolve(root) !== resolve(plan.root)) issues.push(`evidence ${id}: --root must be the workspace root`);
    const target = command.target.split("\\").join("/");
    if (!within(plan.root, target)) issues.push(`evidence ${id} targets ${target}, outside the workspace`);
    else if (target.startsWith(AGENT_SLOTS)) issues.push(`evidence ${id} targets ${target}, an agent slot; intake never writes Director slots`);
    else if (target !== `clossys/evidence/director/${id}.md`) issues.push(`evidence ${id} targets ${target}; Director evidence lives at clossys/evidence/director/${id}.md`);
  }
  return issues;
}
