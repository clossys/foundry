#!/usr/bin/env node
/** @deprecated Compatibility executable for `review-check`. */
export { CliInputError, main } from "@vespeneventures/governance/review";
import { run } from "@vespeneventures/governance/review";

run();
