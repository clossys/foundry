/**
 * `clossys views list [--json] [--root <dir>]` and `clossys views show <agent>/<view-id> [--json] [--root <dir>]`
 * (system.md 14.9): view discovery for chat agents. Read-only. Outside a workspace only package views are listed.
 * These verbs are for agents; a view may not take them as `inputs` (views.inputs-only).
 */
import { resolve } from "node:path";
import { listViews, showView, ViewNotFoundError, ViewRefError, type ViewSources } from "../views/catalog.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot, RootDiscoveryError } from "./root.js";

export const VIEWS_USAGE = "Usage: clossys views list [--json] [--root <dir>] | clossys views show <agent>/<view-id> [--json] [--root <dir>]\n"
  + "  list: every view prompt with its agent, appliesTo, answers and whether a consumer file shadows the package file;\n"
  + "  show: the resolved prompt (the consumer clossys/agents/<agent>/views/<view-id>.md when present, else the package\n"
  + "  file). Read-only. Exit 1 when show names no view.";

export async function runViewsCli(argv: readonly string[], cwd: string, packageRoot?: string): Promise<CliResult> {
  let root: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: VIEWS_USAGE };
    if (arg === "--json") continue;
    if (arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--root requires a value\n${VIEWS_USAGE}`);
      root = value;
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${VIEWS_USAGE}`);
    positional.push(arg);
  }
  const [action, id, ...rest] = positional;
  if (action !== "list" && action !== "show") throw new CliUsageError(`clossys views needs list or show\n${VIEWS_USAGE}`);
  if (action === "list" && id !== undefined) throw new CliUsageError(`Unknown argument: ${id}\n${VIEWS_USAGE}`);
  if (action === "show" && id === undefined) throw new CliUsageError(`clossys views show needs <agent>/<view-id>\n${VIEWS_USAGE}`);
  if (rest.length) throw new CliUsageError(`Unknown argument: ${rest[0]}\n${VIEWS_USAGE}`);
  let workspace: string | undefined;
  try { workspace = discoverRoot(resolve(cwd, root ?? ".")); } catch (error) {
    // An explicit --root must be a workspace; without one, package views are still listed.
    if (!(error instanceof RootDiscoveryError) || root !== undefined) throw error;
  }
  const sources: ViewSources = { packageRoot: packageRoot ?? workspace ?? resolve(cwd), ...(workspace ? { consumerRoot: workspace } : {}) };
  if (action === "list") {
    const list = listViews(sources);
    const lines = list.views.map(view => `${view.id.padEnd(28)} ${view.source}${view.shadowsPackage ? " (shadows package)" : ""}${view.invalid ? "  INVALID" : ""}  ${view.title ?? ""}`);
    lines.push(`${list.views.length} view(s)${workspace ? "" : " (package views only: no workspace found)"}`);
    return { exitCode: 0, ...(workspace ? { root: workspace } : {}), output: list, message: lines.join("\n") };
  }
  try {
    const view = showView(sources, id!);
    return { exitCode: 0, ...(workspace ? { root: workspace } : {}), output: view, message: view.text.replace(/\n$/, "") };
  } catch (error) {
    if (error instanceof ViewRefError) throw new CliUsageError(`${error.message}\n${VIEWS_USAGE}`);
    if (error instanceof ViewNotFoundError) return { exitCode: 1, message: error.message };
    throw error;
  }
}
