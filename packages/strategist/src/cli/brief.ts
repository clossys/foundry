import { openStrategy } from "../api.js";
import { readStrategyRoot } from "../store.js";
import { compileAndPersistBrief } from "../write/brief.js";
import type { ReadArgs, ReadResult } from "./read.js";

/** Brief and handoff share presentation; only explicit brief flags can write. */
export function executeBriefCommand(args: ReadArgs): ReadResult {
  if (args.command !== "brief" && args.command !== "handoff") throw new Error("Expected a brief or handoff command");
  const model = readStrategyRoot(args.root);
  if (model.issues.length) throw new Error(model.issues.map(issue => `${issue.path}:${issue.line}: ${issue.message}`).join("; "));
  const brief = args.command === "brief" && (args.write || args.request)
    ? compileAndPersistBrief(args.root, args.targets[0]!, { write: args.write, request: args.request })
    : openStrategy(args.root).getBrief(args.targets[0]!);
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
