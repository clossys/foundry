import { openStrategy } from "../api.js";
import { readStrategyRoot } from "../store.js";
import type { ReadArgs, ReadResult } from "./read.js";

/** Read-only brief adapter shared by brief and contract handoff. */
export function executeBriefCommand(args: ReadArgs): ReadResult {
  if (args.command !== "brief" && args.command !== "handoff") throw new Error("Expected a brief or handoff command");
  const model = readStrategyRoot(args.root);
  if (model.issues.length) throw new Error(model.issues.map(issue => `${issue.path}:${issue.line}: ${issue.message}`).join("; "));
  const brief = openStrategy(args.root).getBrief(args.targets[0]!);
  return {
    code: brief.state === "ready" ? 0 : 1,
    data: brief,
    text: [
      `${brief.contract}: ${brief.state}`,
      ...brief.missing.map(id => `Missing: ${id}`),
      ...brief.stale.map(ref => `Stale: ${ref.cell}@${ref.version}`),
      ...(args.command === "brief" ? brief.cells.flatMap(cell => [
        `${cell.cell}@${cell.version}`,
        ...cell.direction.map(bullet => `  ${bullet.key ? `${bullet.key}: ` : ""}${bullet.text}`),
        ...cell.watch.map(bullet => `  Watch: ${bullet.text}`),
      ]) : []),
    ],
  };
}
