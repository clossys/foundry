import { join } from "node:path";
import { SLOT_AGENTS } from "../records/slot-model/index.js";
import { readIa } from "../records/slots.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/**
 * `produce` is retired (system.md 14.5): the Studio it served was killed by owner decision 8 and chat is the
 * interface. `--once` and `--check` still report which agents have a slot model; serving refuses, and
 * `clossys run <loop>` replaces the verb when the loop runner lands.
 */
export const PRODUCE_RETIRED = "produce: the Studio is retired (owner decision 8); use `clossys preview <publication>` to see pages";

export async function runProduce(args: CliArgs, root: string): Promise<CliResult> {
  const agents = SLOT_AGENTS.filter(agent => { try { return !!readIa(join(root, "clossys"), agent); } catch { return false; } });
  const status = SLOT_AGENTS.map(agent => `${agent}: ${agents.includes(agent) ? "slot model" : "missing"}`).join(", ");
  if (args.once || args.check) return { exitCode: agents.length ? 0 : 2, verb: "produce", root, check: args.check, message: status };
  return { exitCode: 2, verb: "produce", root, message: PRODUCE_RETIRED };
}
