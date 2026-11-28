/**
 * `clossys check --render` (check/render-check.ts): Reviewer's rendered-output audit over a built site (rule
 * R-RENDER-AUDIT, packages/reviewer/skill/SKILL.md). `--file` writes each finding as a request through `clossys
 * request`: a kind fix to the owning slot's agent when the slot is placed, else a kind report to the owning agent.
 */
import { resolve } from "node:path";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { RENDER_CHECK_USAGE } from "./render-check-usage.js";
import { discoverRoot, RootDiscoveryError } from "./root.js";
import { formatRender, RenderUsageError, runRenderCheck, type CaptureRuntime, type RenderRecord, type RenderRouteFinding } from "../check/render-check.js";

interface RenderCheckArgs { routes?: string; out?: string; browser?: string; root?: string; json: boolean; file: boolean }

function parse(argv: readonly string[]): RenderCheckArgs {
  const args: RenderCheckArgs = { json: false, file: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${RENDER_CHECK_USAGE}`); return next; };
    if (arg === "check" && index === 0) continue;
    if (arg === "--render") continue;
    if (arg === "--json") args.json = true;
    else if (arg === "--file") args.file = true;
    else if (arg === "--routes") args.routes = value();
    else if (arg === "--out") args.out = value();
    else if (arg === "--browser") args.browser = value();
    else if (arg === "--root") args.root = value();
    else throw new CliUsageError(`check --render does not take ${arg}\n${RENDER_CHECK_USAGE}`);
  }
  return args;
}

/** One line per finding for a request's findings list (no `;`, which separates them). */
const findingLine = (item: RenderRouteFinding) => `${item.rule} ${item.route} @${item.viewport} ${item.selector}: ${item.message}`.replace(/;/g, ",");

/** The findings grouped by owning agent and slot, in first-seen order. */
export function requestGroups(findings: readonly RenderRouteFinding[]): { agent: string; slot: string | null; findings: RenderRouteFinding[] }[] {
  const groups = new Map<string, { agent: string; slot: string | null; findings: RenderRouteFinding[] }>();
  for (const item of findings) {
    const key = `${item.agent} ${item.slot ?? ""}`;
    if (!groups.has(key)) groups.set(key, { agent: item.agent, slot: item.slot, findings: [] });
    groups.get(key)!.findings.push(item);
  }
  return [...groups.values()];
}

/** Files each owning slot's findings as one request; returns a line per request and whether any filing failed. */
export async function fileRenderRequests(rec: RenderRecord, root: string): Promise<{ lines: string[]; failed: boolean }> {
  const { runRequestCli } = await import("./request.js");
  const lines: string[] = [];
  let failed = false;
  for (const group of requestGroups(rec.findings)) {
    const rules = [...new Set(group.findings.map(item => item.rule))].join(", ");
    const why = `clossys check --render (${rec.source}): ${group.findings.length} rendered-output finding(s) (${rules}) owned by ${group.slot ?? `agent ${group.agent} (no slot)`}`;
    const list = group.findings.map(findingLine).join(";");
    const attempts: string[][] = [];
    if (group.slot !== null && group.slot.split("/")[0] === group.agent) {
      attempts.push(["--kind", "fix", "--subject", group.slot, "--from", "owner", "--why", why, "--check", "check.render", "--findings", list, "--cause", `rendered output breaks ${rules}`, "--by", "producer", "--root", root]);
    }
    attempts.push(["--kind", "report", "--about", `agent/${group.agent}`, "--what", "bug", "--why", `${why}: ${group.findings.map(findingLine).join(" | ")}`.slice(0, 2000), "--from", "owner", "--by", "producer", "--root", root]);
    let filed = false, last = "";
    for (const argv of attempts) {
      try {
        const result = await runRequestCli(argv, root);
        last = result.message.split("\n")[0]!;
        if (result.exitCode === 0) { filed = true; break; }
      } catch (error) {
        last = (error instanceof Error ? error.message : String(error)).split("\n")[0]!;
      }
    }
    if (!filed) failed = true;
    lines.push(`${group.slot ?? `agent/${group.agent}`} -> ${group.agent}: ${filed ? last : `not filed: ${last}`}`);
  }
  return { lines, failed };
}

export async function runRenderCheckCli(argv: readonly string[], cwd: string, deps: { runtime?: CaptureRuntime; stamp?: string } = {}): Promise<CliResult> {
  const args = parse(argv);
  let root: string | undefined;
  try { root = discoverRoot(resolve(cwd, args.root ?? ".")); }
  catch (error) {
    if (!(error instanceof RootDiscoveryError)) throw error;
    if (args.root !== undefined || args.file) throw new CliUsageError(`check --render${args.file ? " --file" : ""} needs a clossys workspace: ${error.message}\n${RENDER_CHECK_USAGE}`);
  }
  let rec: RenderRecord;
  try {
    rec = await runRenderCheck({
      ...(root ? { root } : {}), ...(args.routes !== undefined ? { routes: resolve(cwd, args.routes) } : {}), ...(args.out !== undefined ? { out: resolve(cwd, args.out) } : {}),
      ...(args.browser !== undefined ? { executablePath: args.browser } : {}), ...(deps.runtime ? { runtime: deps.runtime } : {}), ...(deps.stamp ? { stamp: deps.stamp } : {}),
    });
  } catch (error) {
    if (error instanceof RenderUsageError) throw new CliUsageError(`${error.message}\n${RENDER_CHECK_USAGE}`);
    throw error;
  }
  let requestsFailed = false;
  if (args.file && root && rec.findings.length) {
    const filed = await fileRenderRequests(rec, root);
    requestsFailed = filed.failed;
    rec = { ...rec, requests: filed.lines };
  }
  return { exitCode: rec.verdict === "PASS" && !requestsFailed ? 0 : 1, verb: "check", check: true, ...(root ? { root } : {}), message: formatRender(rec), output: rec };
}
