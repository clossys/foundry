#!/usr/bin/env node
// Build the package before invoking this repository convenience entry point.
import { runCellsCli } from "../dist/library-cli/cells.js";
process.exitCode = await runCellsCli(process.argv.slice(2));
