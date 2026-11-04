/**
 * Test helpers for the agent verbs: a temp consumer holding copies of the repository's own flat
 * slot folders (`clossys/agents/<agent>/<slot-id>/{slot.json,candidates/,pin.json}`), and a
 * byte-and-mtime snapshot that proves a verb wrote nothing into it.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlotAgent } from "../../records/slot-model/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const entry = resolve(here, "../../../dist/cli/index.js");
export const repoConsumer = resolve(here, "../../../../../clossys");

/** A temp root whose `clossys/` holds copies of the named agents' slot folders. */
export function flatConsumer(agents: readonly SlotAgent[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-flat-")));
  mkdirSync(join(root, "clossys", "agents"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "throw new Error('Config must not execute');\n");
  for (const agent of agents) cpSync(join(repoConsumer, "agents", agent), join(root, "clossys", "agents", agent), { recursive: true });
  // Director evidence lives outside the agent tree (clossys/evidence/director, rule R-GIT-CMS).
  if (agents.includes("director")) cpSync(join(repoConsumer, "evidence", "director"), join(root, "clossys", "evidence", "director"), { recursive: true });
  return root;
}

/** The first pinned slot of an agent, with its pinned candidate's path. */
export function firstPinned(root: string, agent: SlotAgent, accept: (id: string) => boolean = () => true): { id: string; dir: string; candidate: string } {
  const base = join(root, "clossys", "agents", agent);
  for (const id of readdirSync(base).sort()) {
    const dir = join(base, id);
    if (!accept(id) || !statSync(dir).isDirectory()) continue;
    try {
      const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")) as { candidate: string };
      return { id, dir, candidate: join(dir, "candidates", pin.candidate) };
    } catch { /* unpinned */ }
  }
  throw new Error(`No pinned ${agent} slot`);
}

export function runVerb(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string; value: any } {
  const result = spawnSync(process.execPath, [entry, ...args, "--json"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let value: any;
  try { value = JSON.parse(result.stdout); } catch { value = undefined; }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, value };
}

export function snapshot(root: string, dir = root): unknown[] {
  return readdirSync(dir).sort().flatMap((name): unknown[] => {
    const path = join(dir, name), stat = statSync(path);
    const item = { path: relative(root, path), mtimeMs: stat.mtimeMs };
    return stat.isDirectory() ? [item, ...snapshot(root, path)] : [{ ...item, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}
