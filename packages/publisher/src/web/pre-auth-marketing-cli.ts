#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPreAuthMarketingSurface } from "./check-pre-auth-marketing-surface.js";

const USAGE = `Usage: publisher-pre-auth-check <surface-document.json>

Fails when a pre-auth marketing SurfaceDocument does not mount MarketingView
with the fold slots the expression-wave gates assume (hero heading, hero
actions, features group). SectionedView is never accepted for this shape.

Exit codes: 0 = contract satisfied, 1 = at least one finding, 2 = could not run (bad input, missing file, or invalid JSON).
`;

export class PreAuthMarketingCliInputError extends Error {}

export function readSurfaceDocumentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new PreAuthMarketingCliInputError(`surface file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new PreAuthMarketingCliInputError(`surface file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof PreAuthMarketingCliInputError) throw cause;
    throw new PreAuthMarketingCliInputError(
      `surface file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new PreAuthMarketingCliInputError("exactly one surface-document.json file is required");
  const report = checkPreAuthMarketingSurface(readSurfaceDocumentJson(argv[0] as string));
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`publisher-pre-auth-check: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}

export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
