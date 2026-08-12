#!/usr/bin/env node
/** @deprecated Compatibility executable for `repository-check`. */
export { CliInputError, main } from "@vespeneventures/governance/repository";
import { run } from "@vespeneventures/governance/repository";

run();
