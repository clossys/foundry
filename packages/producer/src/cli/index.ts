#!/usr/bin/env node
import { runCli } from "./main.js";

const argv = process.argv.slice(2);
const result = await runCli(argv);
if (argv.includes("--json")) {
  console.log(JSON.stringify(result));
} else if (result.exitCode === 0) {
  console.log(result.message);
} else {
  console.error(result.message);
}
process.exitCode = result.exitCode;
