#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegisteredRouteStyling } from "./registered-route-check.js";
import { checkRegisteredRoutes, parseRegisteredRouteContract } from "./registered-route-check.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import type { PublisherPlanDraft } from "../planning/plan.js";
import type { PublisherPlanVersion } from "../planning/change-set.js";
export async function main(argv: readonly string[], io = { out: (line: string) => console.log(line), error: (line: string) => console.error(line) }): Promise<number> {
  try {
    if (argv.length !== 6 || argv[0] !== "--root" || argv[2] !== "--contract" || argv[4] !== "--context") throw new Error("Usage: publisher-registered-route-check --root DIR --contract FILE --context FILE");
    const root = resolve(argv[1]!), contract = parseRegisteredRouteContract(JSON.parse(await fs.readFile(resolve(root, argv[3]!), "utf8")));
    const context = JSON.parse(await fs.readFile(resolve(root, argv[5]!), "utf8")) as { plan: PublisherPlanDraft | PublisherPlanVersion; registries: InstanceRegistries; styling?: RegisteredRouteStyling };
    if (!context || !["plan,registries", "plan,registries,styling"].includes(Object.keys(context).sort().join(","))) throw new Error("Exact plan and InstanceRegistries context required");
    const result = await checkRegisteredRoutes({ root, contract, ...context });
    io.out(JSON.stringify(result)); return result.ok ? 0 : 1;
  } catch (error) { io.error((error as Error).message); return 2; }
}
function isDirectInvocation(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}
if (isDirectInvocation()) process.exitCode = await main(process.argv.slice(2));
