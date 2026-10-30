import { extname } from "node:path";
import { agentModule, agentRoot, hasCellTree, readCells } from "../server/cells.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";
import type { FactsGateResult, WontClaimResult } from "@clossys/strategist";

const GROUND_EXTENSIONS = [".md", ".mdx", ".ts", ".tsx", ".js", ".jsx"];
const CLAIM_EXTENSIONS = [".md", ".mdx", ".txt", ".html", ".htm", ".json", ".yml", ".yaml"];

export interface DirectSummary {
  active: number; draft: number; retired: number; todoOwner: number;
  todoOwnerLocations: { id: string; version: number; status: string; file: string; line: number }[];
}
export interface DirectResult extends CliResult {
  summary?: DirectSummary;
  grounding?: FactsGateResult;
  wontClaim?: WontClaimResult;
  findings?: number;
  limits: string[];
}

/** Read-only composition of the installed Director's grounding and prohibition checks. */
export async function runDirect(args: CliArgs, root: string): Promise<DirectResult> {
  const result = { verb: "direct" as const, root, check: args.check };
  let summary: DirectSummary | undefined;
  try {
    const source = agentRoot(root, "director");
    if (!await hasCellTree(source)) throw new Error("clossys/agents/director/tree.json is missing");
    const all = await readCells(root, "director");
    const active = await readCells(root, "director", true);
    const todoOwner = all.flatMap(cell => cell.source.split(/\r?\n/).flatMap((text, index) =>
      /\bTODO-OWNER\b/.test(text) ? [{ id: cell.id, version: cell.version, status: cell.status, file: cell.path, line: index + 1 }] : []));
    summary = { active: active.length, draft: all.filter(cell => cell.status === "draft").length,
      retired: all.filter(cell => cell.status === "retired").length, todoOwner: todoOwner.length, todoOwnerLocations: todoOwner };
    if (!active.length) throw new Error("Director has no active cells");

    const api: typeof import("@clossys/strategist") = await agentModule("director", "index.js");
    const ground = await agentModule("director", "ground/read.js");
    const loaded = ground.readGroundRoot(source);
    // The shared store validates the actual tree and its pointers. Legacy
    // Strategist tree metadata is irrelevant to these two pure checks.
    const model = loaded.model;
    model.tree = { ...model.tree, active: Object.fromEntries(active.map(cell => [cell.id, cell.version])) };
    model.cells = all.map(cell => {
      const parsed = api.parseCell(cell.source, cell.path);
      if (!parsed.ok) throw new Error(`Invalid Director cell: ${cell.path}`);
      return parsed.value;
    });
    model.issues = model.issues.filter((issue: { path: string }) => issue.path !== "tree.json");
    const scan = await agentModule("director", "scan.js");
    const files = api.scanStrategyDirectory(root, {
      extensions: [...new Set([...GROUND_EXTENSIONS, ...CLAIM_EXTENSIONS])],
      skipDirs: [...scan.DEFAULT_SKIP_DIRS, ".next", ".producer", ".claude"],
      excludeGlobs: ["clossys/agents/director/**"],
    });
    const surfaces = files.filter((file: { path: string }) => !file.path.startsWith("clossys/agents/director/"));
    const groundingFiles = surfaces.filter((file: { path: string }) => GROUND_EXTENSIONS.includes(extname(file.path).toLowerCase()));
    const claimFiles = surfaces.filter((file: { path: string }) => CLAIM_EXTENSIONS.includes(extname(file.path).toLowerCase()));
    const grounding = api.checkGrounding(groundingFiles, model.findings);
    const wontClaim = api.checkWontClaimDrift(claimFiles, model);
    const limits = [...loaded.issues, ...wontClaim.indeterminateReasons];
    if (!groundingFiles.length) limits.push("grounding: no surface files scanned outside clossys/agents/director");
    const findings = grounding.findings.length + wontClaim.findings.length;
    const exitCode = limits.length ? 2 : findings ? 1 : 0;
    const report = { summary, grounding, wontClaim, findings, limits };
    return { ...result, exitCode, ...report, message: [
      `direct: ${exitCode === 2 ? "could not run in full" : findings ? `${findings} finding(s)` : "clean"}`,
      `Director: ${active.length} active, ${all.filter(cell => cell.status === "draft").length} draft, ${todoOwner.length} TODO-OWNER line(s).`,
      `Grounding: ${grounding.findings.length} finding(s), ${grounding.filesScanned} file(s).`,
      `Won't claim: ${wontClaim.findings.length} finding(s), ${wontClaim.filesScanned} file(s), ${wontClaim.unchecked.length} unquoted prohibition(s) unchecked.`,
      ...grounding.findings.map(finding => `[${finding.rule}] ${finding.file}:${finding.line} ${finding.message}`),
      ...wontClaim.findings.map(finding => `[wont-claim] ${finding.file}:${finding.line} ${finding.message}`),
      ...limits.map((limit: string) => `Limit: ${limit}`),
    ].join("\n") };
  } catch (error) {
    const limit = error instanceof Error ? error.message : String(error);
    return { ...result, exitCode: 2, ...(summary ? { summary } : {}), limits: [limit], message: `direct: could not run: ${limit}` };
  }
}
