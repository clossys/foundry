#!/usr/bin/env node
/**
 * The installed executable (`bin.observer-coverage-check`). Everything it
 * does is build the one real `CliPort` `main` needs and hand over; `./cli.ts`
 * holds the logic, and is importable and testable without any of this
 * running. Mirrors `@clossys/builder`'s `ci/bin.ts` split.
 *
 * `process.exitCode` is assigned a number, synchronously -- `main` does no
 * async work, so there is no risk of the process exiting before an async
 * write flushes (see `@clossys/builder`'s own `ci/bin.ts`/`ci/cli.ts`
 * headers for the full account of that defect class).
 */

import { readFileSync } from "node:fs";
import { main } from "./cli.js";
import type { CliPort } from "./cli.js";

const port: CliPort = {
  readTextFile: (path) => readFileSync(path, "utf8"),
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
};

process.exitCode = main(process.argv.slice(2), port);
