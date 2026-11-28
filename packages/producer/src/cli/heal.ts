/**
 * `clossys heal`: the incident loop's verb (CP1-HEAL). Producer only routes it; the loop and its code
 * live in @clossys/controller (src/loop/incidents), the one engine for detect -> match -> heal -> guard
 * -> report. A known cause is healed in code with no model; an unknown signature prints NEW-CAUSE.
 */
import { healMain } from "@clossys/controller";
import type { CliResult } from "./main.js";

export async function runHealCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const result = await healMain(argv, cwd);
  return { exitCode: result.exit, message: result.out };
}
