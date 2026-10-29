#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { syncSite } from "./sync.js";
import type { SiteSyncHost, SiteSyncOptions, SiteSyncResult } from "./contract.js";

const usage = "Usage: publisher-site-sync --root <consumer-repository> [--check]";
/** Canonical Producer target configuration plus existing site identity/environment.
 * A named siteSyncHost export supplies source ports; it is outside defineConfig's schema. */
export async function loadSiteSyncOptions(root: string, check: boolean): Promise<SiteSyncOptions> {
  const config = await import(pathToFileURL(join(root, "clossys/clossys.config.ts")).href);
  const targets = Object.values(config.default?.targets ?? {}).filter((target: any) => target?.format === "web.page.responsive" && /^apps\//.test(target?.app));
  if (targets.length !== 1) throw new TypeError("Site sync requires exactly one web target in clossys/clossys.config.ts");
  const target = targets[0] as SiteSyncOptions["target"];
  if (typeof target.publication !== "string" || !target.publication) throw new TypeError("The web target must name its Publisher publication");
  let origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) {
    const identity = JSON.parse(await readFile(join(root, "clossys/agents/publisher/site-identity.json"), "utf8"));
    origin = identity.canonicalOrigin;
  }
  if (typeof origin !== "string" || !origin) throw new TypeError("A canonical site origin is required from site identity or NEXT_PUBLIC_SITE_URL");
  if (!config.siteSyncHost) throw new TypeError("Missing siteSyncHost named export in clossys/clossys.config.ts: frame, consent, notFound, locale and security must refer to selected app-local host sources");
  return { root, check, target, origin, host: config.siteSyncHost as SiteSyncHost, crawl: process.env.SITE_TARGET === "production" ? "allow" : "disallow" };
}
export async function runSiteSyncCli(argv: readonly string[], load = loadSiteSyncOptions, sync = syncSite): Promise<SiteSyncResult> {
  let root: string | undefined, check = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--root" && root === undefined && argv[index + 1] && !argv[index + 1]!.startsWith("-")) root = argv[++index];
    else if (value === "--check" && !check) check = true;
    else return { exitCode: 2, findings: [], files: [], message: usage };
  }
  if (!root) return { exitCode: 2, findings: [], files: [], message: usage };
  let options: SiteSyncOptions;
  try { options = await load(resolve(root), check); }
  catch (error) { return { exitCode: 2, findings: [], files: [], message: error instanceof Error ? error.message : "Invalid site configuration" }; }
  try { return await sync(options); }
  catch (error) { return { exitCode: error instanceof TypeError ? 2 : 1, findings: [], files: [], message: error instanceof Error ? error.message : "Site sync failed" }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runSiteSyncCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}
