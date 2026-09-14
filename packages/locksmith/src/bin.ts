#!/usr/bin/env node
/**
 * The installed executable (`clossys-locksmith-credential`). Everything it
 * does is build the one real `CliPort` `main` needs and hand over; `./cli.ts`
 * holds the logic, and is importable and testable without any of this
 * running. Mirrors `@clossys/inspector`'s and `@clossys/observer`'s own
 * `bin.ts`/`cli.ts` split.
 *
 * `process.exitCode` is assigned a number, synchronously — `main` does no
 * async work, so there is no risk of the process exiting before a write
 * flushes.
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
