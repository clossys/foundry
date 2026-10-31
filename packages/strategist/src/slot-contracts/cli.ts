/**
 * `strategist-check slots`: run the Director slot suite and print JSON.
 * Report-only: exit 0 even with findings, unless --strict (then 1).
 * Usage errors exit 2.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runDirectorSuite, type SuiteInput } from "./checks.js";

export const SLOTS_USAGE = `Usage: strategist-check slots [--strict] [--downstream <file|dir>]... <cell-file|dir>...

Runs the director.cell.v1 suite (D-REQ, D-SPEC, D-COVER) and prints JSON.
Directories are walked for .md files. --downstream adds Writer and Designer
cell files for citation coverage. Exit 0 even on findings unless --strict.`;

const SKIP = new Set(["node_modules", ".git", "dist"]);
function collect(target: string, out: SuiteInput[]): void {
  const path = resolve(target);
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) if (!SKIP.has(name)) {
      const child = join(path, name);
      if (statSync(child).isDirectory() || name.endsWith(".md")) collect(child, out);
    }
    return;
  }
  out.push({ path: target === path ? path : target, text: readFileSync(path, "utf8") });
}

export function runSlotCheckCli(argv: string[], write: (line: string) => void = line => console.log(line)): number {
  let strict = false; const targets: string[] = []; const downstreamTargets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") { write(SLOTS_USAGE); return 0; }
    if (arg === "--strict") { strict = true; continue; }
    if (arg === "--json") continue;
    if (arg === "--downstream") { const v = argv[++i]; if (!v) return usage(write, "--downstream needs a path"); downstreamTargets.push(v); continue; }
    if (arg.startsWith("--")) return usage(write, `unknown option ${arg}`);
    targets.push(arg);
  }
  if (targets.length === 0) return usage(write, "at least one cell file or directory is required");
  const cells: SuiteInput[] = []; const downstream: SuiteInput[] = [];
  try {
    for (const t of targets) collect(t, cells);
    for (const t of downstreamTargets) collect(t, downstream);
  } catch (error) {
    return usage(write, error instanceof Error ? error.message : String(error));
  }
  const result = runDirectorSuite({ cells, ...(downstreamTargets.length ? { downstream } : {}) });
  write(JSON.stringify({ command: "slots", strict, ...result, counts: countBy(result.findings.map(f => f.check)) }, null, 2));
  return strict && result.findings.length > 0 ? 1 : 0;
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = { total: items.length };
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

function usage(write: (line: string) => void, message: string): number {
  write(JSON.stringify({ command: "slots", code: 2, error: message, usage: SLOTS_USAGE }));
  return 2;
}
