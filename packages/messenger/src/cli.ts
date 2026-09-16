#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDeliveryClosure, validateDeliveryClosureInput } from "./delivery-closure.js";
import type { DeliveryClosureInput } from "./types.js";

const USAGE = `Usage: messenger-check delivery-closure <evidence-file>

The evidence file is JSON with evaluatedAt, setpoint, and a non-empty records
array. Each record identifies an authorized intent, its declared delivery
window, and any independently sourced delivery outcome observation.

Exit codes: 0 = metric satisfied, 1 = metric violated, 2 = could not evaluate
(including invalid evidence or no authorized delivery intent due).
`;

function loadEvidence(path: string): unknown {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`evidence file "${path}" does not exist or is not a file`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** Presentation-only CLI entry point; the metric judgment remains pure. */
export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== "delivery-closure") {
    console.error(USAGE);
    return 2;
  }

  let evidence: unknown;
  try {
    evidence = loadEvidence(argv[1] as string);
  } catch (error) {
    console.error(`messenger-check could not load evidence: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const findings = validateDeliveryClosureInput(evidence);
  if (findings.length > 0) {
    console.error(JSON.stringify({ state: "indeterminate", findings }, null, 2));
    return 2;
  }

  const result = checkDeliveryClosure(evidence as DeliveryClosureInput);
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
