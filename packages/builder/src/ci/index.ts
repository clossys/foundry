/**
 * Shared CI gate mechanics (#257): importable machinery a consumer's own
 * thin workflow invokes, plus the concrete toolchain gate built on it. See
 * `documents/caller-workflow.md` (this package's root) for the workflow
 * this is meant to sit inside.
 */

export { foldLiveStateReports } from "./report.js";
export type { LiveStateGateReport, LiveStateReportRow } from "./report.js";

export {
  MINIMUM_SAFE_VERSION,
  checkVersionFloor,
  compareVersions,
  lowestSatisfyingVersion,
  parseVersion,
  versionFloorReasons,
} from "./version.js";
export type { ParsedVersion, VersionFloorInput, VersionFloorReason, VersionFloorReport } from "./version.js";

export { TOOLCHAIN_VERIFY_INPUTS_VERSION, toolchainCliReasons, verifyToolchain } from "./toolchain-cli.js";
export type {
  ToolchainCliReason,
  ToolchainVerifyInputs,
  ToolchainVerifyOptions,
  ToolchainVerifyReason,
  ToolchainVerifyReport,
  ToolchainVerifyRow,
} from "./toolchain-cli.js";

export { USAGE, main, parseArgs, renderReport, CliInputError } from "./cli.js";
export type { CliPort } from "./cli.js";
