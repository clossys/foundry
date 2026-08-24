#!/usr/bin/env node
// Producer-side wrapper. Consumer use is the shipped `foundry-position-check`
// binary from @vespeneventures/controller, with explicit ledger and role
// contract paths. This wrapper validates no consumer record.
import { main } from "../packages/controller/dist/positions/cli.js";
process.exitCode = main(process.argv.slice(2));
