import { resolve } from "node:path";
import { resolveAgent } from "../agents.js";
import { installFailed, installSummary, publishInstall } from "../publish/install.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/** `publish --install --page <id>`: install the page's pinned items, bind its copy and render it. */
export async function runPublish(args: CliArgs, root: string, cwd = process.cwd()): Promise<CliResult> {
  resolveAgent("publisher");
  const result = await publishInstall({ root, page: args.page!, cwd, ...(args.out ? { out: resolve(cwd, args.out) } : {}), ...(args.records.length ? { records: args.records.map(dir => resolve(cwd, dir)) } : {}) });
  return { exitCode: installFailed(result) ? 1 : 0, verb: "publish", root, check: args.check, message: installSummary(result) };
}
