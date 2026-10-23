#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkExamples(packageRoot = fileURLToPath(new URL("../", import.meta.url))) {
  const root = resolve(packageRoot), examples = join(root, "examples"), configPath = join(root, "tsconfig.examples.json");
  if (!existsSync(examples)) {
    console.log("No examples directory; example typecheck skipped.");
    return 0;
  }
  if (!existsSync(configPath)) {
    console.error("Examples require tsconfig.examples.json.");
    return 2;
  }
  try {
    const compiler = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
    const result = spawnSync(process.execPath, [compiler, "-p", configPath, "--noEmit"], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status === null) throw new Error(`TypeScript terminated by ${result.signal ?? "an unknown signal"}`);
    return result.status;
  } catch (error) {
    console.error(`Example typecheck failed: ${String(error.message).replace(/\s+/g, " ")}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkExamples();
