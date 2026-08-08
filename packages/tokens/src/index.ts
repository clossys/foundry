/**
 * @vespeneventures/tokens — a zero-dependency design-token package.
 *
 * A design token is a name for a design decision — `surface-raised`, not
 * `#F2EFE6` — so that the decision can be looked up and changed in one
 * place instead of hardcoded everywhere it's used. This package ships that
 * naming in two forms that describe the same 154 tokens:
 *
 *   - `styles/tokens.css` — CSS custom properties, the primary artifact.
 *   - This module — the same tokens as typed data, for JS/TS code that
 *     wants a token's name or default value without parsing CSS.
 *
 * See the README for the three-layer contract (primitives → brand binding
 * → consumer extensions), the naming rule that splits tokens into Tailwind
 * v4 `@theme` namespaces versus the `--ui-` prefix, and the full token
 * reference table.
 *
 * THE BRAND-COVERAGE CHECK. `TOKENS` and `styles/brand-template.css` are a
 * vocabulary and a template — neither one, by itself, can tell a consumer
 * whether their own real `brand.css` actually filled in the template
 * correctly. `checkBrandFileCoverage` closes that gap, the same "self-closing
 * package" shape every sibling contract package in this repository ships
 * (`@vespeneventures/voice`'s `checkCopy`, `@vespeneventures/copy`'s
 * `checkCopyTraceability`, `@vespeneventures/strategy`'s
 * `checkFactsTraceability`): given already-parsed custom-property
 * declarations (see `readBrandCss`/`parseBrandDeclarations` for how to get
 * those from a real `.css` file), it reports every brandable slot with no
 * real declaration, every declaration naming a slot this package doesn't
 * recognize (almost always a typo), and every declaration targeting a
 * structural (non-brandable) slot — the same rule
 * `@vespeneventures/render`'s `flattenTokens` already enforces by throwing.
 * `tokens-brand-check` (`src/cli.ts`, installed as a `bin`) wires
 * `readBrandCss` and `checkBrandFileCoverage` into a CLI with the same
 * three-state exit-code contract `copy-check`/`strategy-facts-check` use:
 * 0 clean, 1 findings, 2 could not run. `cli.ts` itself is intentionally
 * NOT re-exported here — matching `@vespeneventures/copy` and
 * `@vespeneventures/strategy`'s own `index.ts`, a CLI's `main`/argv
 * handling is not library surface, only its `bin` entry is.
 *
 * Named `checkBrandFileCoverage`, not `checkBrandCoverage` —
 * `@vespeneventures/strategy` already exports a `checkBrandCoverage`
 * checking a different thing (a `BrandDerivation[]`'s coverage of token
 * slots by name, not a real CSS file's declarations); see
 * `check-brand-file-coverage.ts`'s own header comment for the full
 * distinction.
 */

export type { TokenDefinition, TokenFamily } from "./tokens.js";
export { TOKENS, TOKEN_FAMILIES } from "./tokens.js";

export { checkBrandFileCoverage } from "./check-brand-file-coverage.js";
export type {
  BrandFileCoverageCheckOptions,
  BrandFileCoverageFailureReason,
  BrandFileCoverageFinding,
  BrandFileCoverageFindingRule,
  BrandFileCoverageReport,
  BrandFileCoverageUnchecked,
} from "./check-brand-file-coverage.js";

export { parseBrandDeclarations, readBrandCss } from "./read-brand-css.js";
export type {
  BrandCssReadIssue,
  BrandCssReadIssueReason,
  BrandCssReadResult,
  BrandCssUnchecked,
  ParsedBrandCss,
} from "./read-brand-css.js";
