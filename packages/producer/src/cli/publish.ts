import { resolveAgent } from "../agents.js";
import { publishPreview, PUBLISH_TARGETS, reportSummary } from "../publish/publish.js";
import { CliUsageError, type CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/** `publish --target preview`: render and serve; `--check` renders without serving. */
export async function runPublish(args: CliArgs, root: string): Promise<CliResult> {
  if (!PUBLISH_TARGETS.includes(args.target as typeof PUBLISH_TARGETS[number])) throw new CliUsageError(`Unknown publish target: ${args.target} (supported: ${PUBLISH_TARGETS.join(", ")})`);
  if (args.port !== undefined && args.port < 1024) throw new CliUsageError("publish --port must be 1024 or higher");
  for (const kind of ["designer", "writer", "publisher"] as const) resolveAgent(kind);
  const result = await publishPreview({ root, ...(args.out ? { out: args.out } : {}), ...(args.port !== undefined ? { port: args.port } : {}), serve: !args.check });
  return { exitCode: 0, verb: "publish", root, check: args.check, message: reportSummary(result) };
}
