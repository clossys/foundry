#!/usr/bin/env node
/**
 * The installed executable. Everything it does is build the one real port
 * `main` needs and hand over; `./cli.js` holds the logic, and is importable
 * without any of this running.
 *
 * `process.exitCode` is assigned a number, synchronously. See `./cli.ts`'s
 * header for why that sentence is worth writing down.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { main } from "./cli.js";
import type { CliPort } from "./cli.js";

/**
 * Reads this package's own version out of its own manifest.
 *
 * `createRequire(import.meta.url).resolve` finds the manifest relative to
 * this compiled file, so it reports the version of the build that is
 * actually executing rather than whatever a consumer's working directory
 * happens to contain. A failure returns `undefined`, which the floor check
 * treats as `indeterminate` — a build that cannot say what it is does not
 * get the benefit of the doubt.
 */
function resolveOwnVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(readFileSync(require.resolve("../package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

const port: CliPort = {
  readTextFile: (path) => readFileSync(path, "utf8"),
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
  resolveOwnVersion,
};

process.exitCode = main(process.argv.slice(2), port);
