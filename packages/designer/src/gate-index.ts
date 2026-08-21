/**
 * `@vespeneventures/designer/gate` — the public entry point for this package's
 * token-purity scanner/gate, kept separate from `src/index.ts` (the
 * component ladder's own internal-tooling barrel — see that file's header
 * for why it has no `"."` package export) the same way this package's
 * `atoms`/`blocks`/`shell`/`charts`/`icons` subpaths are each their
 * own barrel. `scripts/check-readme-parity.mjs` reads only `src/index.ts`
 * as this package's canonical export list, so this file is deliberately
 * NOT re-exported there — a consumer imports the scanner/gate from
 * `@vespeneventures/designer/gate` directly, never from the root ladder barrel,
 * the same way `designer-token-check` (see `cli.ts`) is reachable only via its
 * installed `bin` entry, not a JS import.
 *
 * Three things ship from here, mirroring the split
 * `@vespeneventures/copy`'s own `index.ts` draws:
 *
 *   1. THE SCANNER. `scanStyleSources`/`extractStyleCandidates`
 *      (`style-scan.ts`) walk a real source tree and extract every
 *      hardcoded styling literal — hex colors, color functions, raw CSS
 *      lengths, Tailwind arbitrary-value classes — as a `StyleCandidate`.
 *   2. THE TOKEN-PURITY GATE. `checkTokenPurity` (`token-gate.ts`) is the
 *      pure gate that checks each candidate against this package's real
 *      `TOKENS` registry.
 *   3. THE ENVIRONMENT-DECLARATION-CONSISTENCY GATE.
 *      `checkEnvironmentConformance` (`environment-conformance.ts`,
 *      closing issue #405) verifies that `render-environment.ts`'s own
 *      `RENDER_ENVIRONMENT` key set and `package.json#exports`' real
 *      subpath set are the same set, in both directions. It performs NO
 *      module resolution — see that file's own header for why real
 *      export-condition verification is issue #358's shared `builder`
 *      capability, not this gate, and for the full ternary and
 *      adversarial proof this narrower check is built to pass.
 *
 * `cli.ts` wires the token-purity gate into `designer-token-check`, and
 * `environment-conformance-cli.ts` wires the environment-conformance gate
 * into `designer-environment-check` — both installable CLIs, both with
 * the same three-state exit-code contract `copy-check` uses (0
 * clean/satisfied, 1 findings/violated, 2 could not run/indeterminate).
 * Neither CLI module itself is re-exported here — matching
 * `@vespeneventures/copy`'s own `index.ts`, a CLI's `main`/argv handling
 * is not library surface, only its `bin` entry is.
 */

export {
  extractStyleCandidates,
  findEmbeddedStyleLiterals,
  isPureVarReference,
  scanStyleSources,
} from "./style-scan.js";
export type {
  EmbeddedLiteral,
  ExcludedOccurrence,
  ExcludedReason,
  ScanOptions,
  SkippedFile,
  StyleCandidate,
  StyleCandidateKind,
  StyleScanResult,
  UncheckedItem,
} from "./style-scan.js";

export { checkTokenPurity } from "./token-gate.js";
export type { TokenGateFinding, TokenGateIgnored, TokenGateResult, TokenGateRule } from "./token-gate.js";

export { checkEnvironmentConformance } from "./environment-conformance.js";
export type {
  ConformanceIndeterminateCode,
  ConformanceIndeterminateReason,
  ConformanceResult,
  ConformanceVerdict,
  ConformanceViolation,
  ConformanceViolationReason,
} from "./environment-conformance.js";
