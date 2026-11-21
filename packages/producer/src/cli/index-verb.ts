/**
 * `clossys index --rebuild [--root <dir>] [--json]`: rewrite `<root>/clossys/.state/index.json` from the event log plus
 * the records it names (engine/derived.ts), under the engine lock. The index is never the source of truth: this is
 * how a missing or stale one is restored. Refuses (exit 1, nothing written) when the log does not verify.
 * `clossys index [--root <dir>] [--json]` without --rebuild compares the stored index with a rebuild, read-only.
 */
import { dirname, resolve } from "node:path";
import { INDEX_FILE } from "../engine/chain.js";
import { indexAgreement } from "../engine/derived.js";
import { rebuildIndex } from "../engine/log.js";
import { hasModelRoot } from "../records/slots.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { findWorkspace } from "./workspace.js";

export const INDEX_USAGE = "Usage: clossys index [--rebuild] [--root <dir>] [--json]\n"
  + "  --rebuild rewrites clossys/.state/index.json from clossys/.state/events.jsonl plus the records it names (refused while the log does not verify);\n"
  + "  without it, compares the stored index with a rebuild and exits 1 when they differ (read-only).";

/** The workspace root (the folder holding `clossys/`) for a --root argument: a consumer folder's parent, or the nearest workspace. */
export function workspaceRootFor(start: string): string {
  if (hasModelRoot(start)) return dirname(start);
  return findWorkspace(start) ?? start;
}

export async function runIndexCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let rebuild = false, json = false, rootArg: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: INDEX_USAGE };
    if (arg === "--rebuild") { rebuild = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--root requires a value\n${INDEX_USAGE}`);
      rootArg = value;
      continue;
    }
    throw new CliUsageError(`Unknown option ${arg}\n${INDEX_USAGE}`);
  }
  const root = workspaceRootFor(resolve(cwd, rootArg ?? "."));
  if (rebuild) {
    try {
      const index = rebuildIndex(root);
      return { exitCode: 0, root, message: `index: rebuilt ${root}/${INDEX_FILE} from ${index.events} event(s), ${Object.keys(index.records).length} record(s)`, ...(json ? { output: index } : {}) };
    } catch (error) {
      return { exitCode: 1, root, message: `index: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const agreement = indexAgreement(root);
  return {
    exitCode: agreement.agrees ? 0 : 1, root,
    message: agreement.agrees ? `index: agrees with a rebuild (${agreement.events} event(s))` : [`index: disagrees with a rebuild (${agreement.diffs.length} difference(s)); run clossys index --rebuild`, ...agreement.diffs.map(line => `  ${line}`)].join("\n"),
    ...(json ? { output: { agrees: agreement.agrees, present: agreement.present, events: agreement.events, diffs: agreement.diffs } } : {}),
  };
}
