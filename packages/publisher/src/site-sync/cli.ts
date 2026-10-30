#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { syncSite } from "./sync.js";
import { parseSiteSyncConfig } from "./config.js";
import { isSiteSyncEntry } from "./invocation.js";
import type { SiteSyncOptions, SiteSyncResult } from "./contract.js";

const usage = "Usage: publisher-site-sync --root <consumer-repository> [--check]";
/** Canonical Producer target configuration plus existing site identity/environment.
 * A named siteSyncHost export supplies source ports; it is outside defineConfig's schema. */
export async function loadSiteSyncOptions(root: string, check: boolean): Promise<SiteSyncOptions> {
  const config = parseSiteSyncConfig(await readFile(join(root, "clossys/clossys.config.ts"), "utf8"));
  let origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) {
    const identity: unknown = JSON.parse(await readFile(join(root, "clossys/agents/publisher/site-identity.json"), "utf8"));
    if (identity && typeof identity === "object" && "canonicalOrigin" in identity && typeof identity.canonicalOrigin === "string") origin = identity.canonicalOrigin;
  }
  if (typeof origin !== "string" || !origin) throw new TypeError("A canonical site origin is required from site identity or NEXT_PUBLIC_SITE_URL");
  return { root, check, ...config, origin, crawl: process.env.SITE_TARGET === "production" ? "allow" : "disallow" };
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
if (await isSiteSyncEntry(import.meta.url, process.argv[1])) {
  const result = await runSiteSyncCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}
