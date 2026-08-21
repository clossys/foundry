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
 * Two halves ship from here, mirroring the split
 * `@vespeneventures/copy`'s own `index.ts` draws:
 *
 *   1. THE SCANNER. `scanStyleSources`/`extractStyleCandidates`
 *      (`style-scan.ts`) walk a real source tree and extract every
 *      hardcoded styling literal — hex colors, color functions, raw CSS
 *      lengths, Tailwind arbitrary-value classes — as a `StyleCandidate`.
 *   2. THE GATE. `checkTokenPurity` (`token-gate.ts`) is the pure gate
 *      that checks each candidate against this package's real
 *      `TOKENS` registry.
 *
 * `cli.ts` wires both into `designer-token-check`, an installable CLI with the
 * same three-state exit-code contract `copy-check` uses: 0 clean, 1
 * findings, 2 could not run. `cli.ts` itself is intentionally NOT
 * re-exported here — matching `@vespeneventures/copy`'s own `index.ts`, a
 * CLI's `main`/argv handling is not library surface, only its `bin` entry
 * is.
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
