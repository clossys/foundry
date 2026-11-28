#!/usr/bin/env node
import { healMain } from "./cli.js";

const result = await healMain(process.argv.slice(2));
if (result.out) (result.exit === 2 ? console.error : console.log)(result.out);
process.exitCode = result.exit;
