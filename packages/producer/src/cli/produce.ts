import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { SLOT_AGENTS } from "../records/slot-model/index.js";
import { readIa } from "../records/slots.js";
import { startProducerServer } from "../server/index.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/** The browser receives a local address only; the run token stays in memory. */
function openBrowser(url: string): void {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  const browser = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
  browser.on("error", () => { /* The printed local address remains usable. */ }); browser.unref();
}
export async function runProduce(args: CliArgs, root: string): Promise<CliResult> {
  // Studio reads the slot model live; there is no compile step. Report which agents have one.
  const agents = SLOT_AGENTS.filter(agent => { try { return !!readIa(join(root, "clossys"), agent); } catch { return false; } });
  const status = SLOT_AGENTS.map(agent => `${agent}: ${agents.includes(agent) ? "slot model" : "missing"}`).join(", ");
  if (args.once || args.check) return { exitCode: agents.length ? 0 : 2, verb: "produce", root, check: args.check, message: status };
  const server = await startProducerServer({ root, port: args.port, ...(args.out ? { installOut: resolve(args.out) } : {}) });
  // JSON output is emitted once on shutdown, keeping the CLI result contract.
  if (!args.json) console.log(`Producer Studio: ${server.url}`);
  if (!args.noOpen) openBrowser(server.url);
  await server.closed;
  if (server.failure) return { exitCode: 2, verb: "produce", root, message: server.failure };
  return { exitCode: 0, verb: "produce", root, message: `Producer stopped; ${status}` };
}
