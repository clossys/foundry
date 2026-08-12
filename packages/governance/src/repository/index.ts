/** Vendor-neutral contracts for consumer-owned repository values. */
export { validateRepositoryProfile } from "./validate.js";
export { REPOSITORY_PROFILE_VERSION } from "./types.js";
export { CliInputError, main, run } from "./cli.js";
export type {
  RepositoryCommand,
  RepositoryList,
  RepositoryProfile,
  RepositoryProfileFinding,
  RepositoryProfileFindingRule,
} from "./types.js";
