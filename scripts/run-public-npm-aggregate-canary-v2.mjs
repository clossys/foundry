#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  AGGREGATE_V2_CANARY_PATH,
  parseAggregateV2Cli,
  validateAggregateV2Closure,
} from "./lib/public-npm-aggregate-canary-v2.mjs";

const root = process.cwd();
let args;
try { args = parseAggregateV2Cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
if (args) {
  let plan, closure;
  try {
    plan = JSON.parse(readFileSync(`${root}/${AGGREGATE_V2_CANARY_PATH}`, "utf8"));
    closure = JSON.parse(readFileSync(`${root}/${args.closurePath}`, "utf8"));
  } catch { console.error("aggregate v2 closure is unavailable or malformed; no registry fetch performed"); process.exitCode = 2; }
  if (plan && closure) {
    const findings = validateAggregateV2Closure(closure, plan, { read: (path) => readFileSync(path, "utf8") });
    if (findings.length) { for (const item of findings) console.error(`- [${item.rule}] ${item.message}`); process.exitCode = 1; }
    else { console.error("aggregate v2 closure is valid, but no execution transcript is retained; no pass claimed"); process.exitCode = 2; }
  }
}
