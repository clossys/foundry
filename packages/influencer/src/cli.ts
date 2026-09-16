#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkResponseYield, validateResponseYieldInput } from "./response-yield.js";
import type { ResponseYieldInput } from "./types.js";

const USAGE = `Usage: influencer-check response-yield <evidence-file>

The JSON evidence file declares an evaluation instant, response-yield
setpoint, minimum exposure floor, qualified action kinds, and non-empty
governed publication records with authority, exposure, and response evidence.

Exit codes: 0 = metric satisfied, 1 = metric violated, 2 = could not evaluate
(including invalid evidence, no due records, insufficient exposure, or an
unreadable evidence source).
`;

function loadEvidence(path: string): unknown {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`evidence file "${path}" does not exist or is not a file`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== "response-yield") {
    console.error(USAGE);
    return 2;
  }

  let evidence: unknown;
  try {
    evidence = loadEvidence(argv[1] as string);
  } catch (error) {
    console.error(`influencer-check could not load evidence: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const findings = validateResponseYieldInput(evidence);
  if (findings.length > 0) {
    console.error(JSON.stringify({ state: "indeterminate", findings }, null, 2));
    return 2;
  }
  const result = checkResponseYield(evidence as ResponseYieldInput);
  console.log(JSON.stringify(result, null, 2));
  if (result.state === "indeterminate") return 2;
  return result.state === "satisfied" ? 0 : 1;
}

/**
 * Same real-path guard `@example/copy`'s `cli.ts` uses, for the
 * same reason: `npm install` publishes `bin` entries as symlinks, so
 * comparing `process.argv[1]` to `import.meta.url` without resolving
 * symlinks on both sides fails the moment this file is actually invoked
 * the only way it ships — as an installed CLI.
 */
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
