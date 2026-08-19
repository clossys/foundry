/**
 * The `@vespeneventures/inspector/secret-scan` subpath — the mechanism half
 * of secret scanning: acquiring a verified `gitleaks` binary and, now,
 * actually running it into the shape the judge at this package's own root
 * (`checkSecretScan`, exported from `.`) evaluates.
 *
 * Everything re-exported from `./gitleaks.js` was `@vespeneventures/secret-scan`
 * before this package absorbed it (see #283 and #281). Every one of those
 * exports is unchanged from that package's own shape — nothing here was
 * renamed, folded, or reduced. `attemptGitleaksScan` and
 * `defaultGitleaksExecutor`, from `./attempt.js`, did not exist as a
 * standalone package export before; they are the wiring #283 asked for — see
 * that module's own header for why they belong here rather than in the judge.
 */

export {
  downloadAndVerifyGitleaks,
  getAssetName,
  getCachedGitleaksPath,
  getKnownVersions,
  getPlatformArch,
  resolveGitleaksRelease,
  assertUsableSha256,
  isKnownDegenerateSha256,
  isWellFormedSha256,
  EMPTY_INPUT_SHA256,
  ALL_ZERO_SHA256,
} from "./gitleaks.js";
export type { GitleaksBinaryOptions, GitleaksBinaryResult, GitleaksRelease } from "./gitleaks.js";

export { attemptGitleaksScan, defaultGitleaksExecutor } from "./attempt.js";
export type { AttemptGitleaksScanOptions, GitleaksExecutor, GitleaksRunResult } from "./attempt.js";
