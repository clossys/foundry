#!/usr/bin/env node
// @clossys/reviewer status probe: reviewer-check reports whether this agent's skill lists exactly
// the rules the rule registry gives it as owner_agent. The check itself is ./owned-rules.ts.
import { runCheck } from "./owned-rules.js";

const { stdout, exitCode } = runCheck(process.argv.slice(2));
process.stdout.write(stdout);
process.exitCode = exitCode;
