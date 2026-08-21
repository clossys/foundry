#!/usr/bin/env node
/**
 * The installed executable. Everything it does is build the one real port
 * `main` needs and hand over; `./cli.js` holds the logic and is importable
 * without any of this running.
 *
 * A SEPARATE compiled entry file from `../ci/bin.js`, deliberately — see
 * `foundry-gates-invoked-by-dist-path` in this repository's own operating
 * history: a CLI that dispatches on the invoked bin NAME rather than shipping
 * one file per bin is unreachable the way this repository invokes gates
 * (`node packages/<pkg>/dist/<path>.js`, a direct compiled path — never
 * `npx`, never bin-name sniffing). One bin, one entry file, same as
 * `packages/ui`'s three separate CLIs.
 */

import { readFileSync } from "node:fs";
import { main } from "./cli.js";
import type { CliPort } from "./cli.js";
import { createNodeFileSystem } from "../node-fs.js";
import { createNodeDiscoveryPort } from "./node-discovery.js";

const port: CliPort = {
  readTextFile: (path) => readFileSync(path, "utf8"),
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
  discovery: createNodeDiscoveryPort(),
  filesystem: createNodeFileSystem(),
  env: process.env,
};

process.exitCode = main(process.argv.slice(2), port);
