#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkKeepForm } from "./keep-form.js";

const USAGE = `Usage: customer-check <record.json> <audience.json>

Validates that a first-person inhabit record was spoken as the named customer
— keep (seal gate), plus speed-dial testimony: feedback, compare, refer,
churn, adopt, or worth — not as a reviewer, QA contractor, or market-research
memo. This CLI never certifies a five-star quality score; dishonest
first-person answers can still satisfy the shape. Only intent "keep" counts
toward customer keep rate.

Exit codes: 0 = clean form, 1 = inhabit or consistency findings, 2 = could not run
(including unreadable files, unknown intent, or indeterminate shape).
`;

function loadJson(path: string): unknown {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`file "${path}" does not exist or is not a file`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 2) {
    console.error(USAGE);
    return 2;
  }

  let keep: unknown;
  let audience: unknown;
  try {
    keep = loadJson(argv[0] as string);
    audience = loadJson(argv[1] as string);
  } catch (error) {
    console.error(`customer-check could not load input: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const result = checkKeepForm(keep, audience);
  console.log(JSON.stringify(result, null, 2));
  if (result.state === "indeterminate") return 2;
  return result.state === "satisfied" ? 0 : 1;
}

function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) process.exitCode = main();
