#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), separator = args.indexOf("--");
if (args.includes("--help") && separator < 0) {
  console.log("Usage: npm run compose -- [process gate options] -- <designer-library command and arguments>\nGate options: --source-head SHA --site ROOT --library DIR --contract JSON --html FILE --css FILE --render-manifest JSON --report-dir DIR. Studio compose targets the actual Studio site inputs. All three gates must verify before the library command runs. Use check:process -- --help for the gate contract.");
  process.exit(0);
}
const gateArgs = separator < 0 ? args : args.slice(0, separator), command = separator < 0 ? [] : args.slice(separator + 1);
const candidates = spawnSync(process.execPath, [path.join(directory, "check-default-candidates.mjs")], { stdio: ["ignore", "inherit", "inherit"] });
if (candidates.error || candidates.signal || candidates.status !== 0) process.exit([1, 2].includes(candidates.status) ? candidates.status : 2);
const checked = spawnSync(process.execPath, [path.join(directory, "check-process-gates.mjs"), ...gateArgs], { stdio: ["ignore", "inherit", "inherit"] });
if (checked.error || checked.signal || checked.status !== 0) process.exit([1, 2].includes(checked.status) ? checked.status : 2);
if (!command.length) { console.error("Compose requires a designer-library command after --"); process.exit(2); }
const composed = spawnSync(process.execPath, [path.resolve(directory, "../dist/library-cli/cli.js"), ...command], { stdio: ["ignore", "inherit", "inherit"] });
process.exitCode = composed.error || composed.signal ? 2 : composed.status ?? 2;
