import { spawn } from "node:child_process";
import { compileCells } from "../server/cells.js";
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
  const compiled = await compileCells(root, args.check);
  const status = compiled.map(result => `${result.agent}: ${result.state}`).join(", ");
  if (args.once || args.check) return { exitCode: compiled.every(result => result.state === "compiled") ? 0 : 2, verb: "produce", root, check: args.check, message: status };
  const server = await startProducerServer({ root, port: args.port, compilation: compiled });
  // JSON output is emitted once on shutdown, keeping the CLI result contract.
  if (!args.json) console.log(`Producer Studio: ${server.url}`);
  if (!args.noOpen) openBrowser(server.url);
  await server.closed;
  return { exitCode: 0, verb: "produce", root, message: `Producer stopped; ${status}` };
}
