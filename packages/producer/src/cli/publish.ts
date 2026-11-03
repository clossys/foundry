import { resolve } from "node:path";
import { resolveAgent } from "../agents.js";
import { installFailed, installSummary, publishInstall } from "../publish/install.js";
import { publishSite, siteFailed, siteSummary } from "../publish/install-site.js";
import { nextFailed, nextSummary, publishNext } from "../publish/install-next.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/** `publish --install --page <id>`: install the page's pinned items, bind its copy and render it; `--site <pack id>`: one routed app. */
export async function runPublish(args: CliArgs, root: string, cwd = process.cwd()): Promise<CliResult> {
  resolveAgent("publisher");
  // `--selection <module>[#export]`: the consumer's component selection every page mounts inside.
  const hash = args.selection?.lastIndexOf("#") ?? -1;
  const selection = args.selection === undefined ? {} : { selection: hash > 0 ? { module: args.selection.slice(0, hash), export: args.selection.slice(hash + 1) } : { module: args.selection } };
  if (args.site !== undefined && args.next !== undefined) {
    const next = await publishNext({ root, publication: args.site, app: resolve(cwd, args.next), assembly: args.assembly!, live: args.live, check: args.check, ...(args.out ? { out: resolve(cwd, args.out) } : {}) });
    return { exitCode: nextFailed(next) ? 1 : 0, verb: "publish", root, check: args.check, message: nextSummary(next) };
  }
  if (args.site !== undefined) {
    const site = await publishSite({ root, site: args.site, build: args.build, cwd, ...selection, ...(args.origin !== undefined ? { origin: args.origin } : {}), ...(args.out ? { out: resolve(cwd, args.out) } : {}), ...(args.records.length ? { records: args.records.map(dir => resolve(cwd, dir)) } : {}) });
    return { exitCode: siteFailed(site) ? 1 : 0, verb: "publish", root, check: args.check, message: siteSummary(site) };
  }
  const result = await publishInstall({ root, page: args.page!, cwd, ...selection, ...(args.out ? { out: resolve(cwd, args.out) } : {}), ...(args.records.length ? { records: args.records.map(dir => resolve(cwd, dir)) } : {}) });
  return { exitCode: installFailed(result) ? 1 : 0, verb: "publish", root, check: args.check, message: installSummary(result) };
}
