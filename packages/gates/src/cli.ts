#!/usr/bin/env node
/** @deprecated Compatibility executable for `foundry-check`. */
export { main, severityCounts } from "@vespeneventures/governance/gates";
import { run } from "@vespeneventures/governance/gates";

run();
