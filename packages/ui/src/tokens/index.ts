/**
 * @vespeneventures/ui/tokens — this visual system's zero-dependency token layer.
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
 * (`@vespeneventures/copy/voice`'s `checkCopy`, `@vespeneventures/copy`'s
 * `checkCopyTraceability`, `@vespeneventures/strategy`'s
 * `checkFactsTraceability`): given already-parsed custom-property
 * declarations (see `readBrandCss`/`parseBrandDeclarations` for how to get
 * those from a real `.css` file), it reports every brandable slot with no
 * real declaration, every declaration naming a slot this package doesn't
 * recognize (almost always a typo), and every declaration targeting a
 * structural (non-brandable) slot — the same rule
 * `@vespeneventures/surface`'s `flattenTokens` already enforces by throwing.
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
 *
 * THE WCAG CONTRAST GATE. A token registry can be internally consistent —
 * every brand slot filled in, every declaration typo-free — and still be
 * unreadable: nothing about `checkBrandFileCoverage` or the naming
 * convention itself asks whether `--color-ink-primary` is actually
 * legible on `--color-surface-base`. `color.ts` ships this package's real
 * OKLCH/hex -> linear-sRGB -> relative-luminance -> WCAG-contrast-ratio
 * math (promoted here from a test-only internal module — see that file's
 * own header); `contrast-pairs.ts`'s `CONTRAST_PAIRS` is the checked-in
 * policy naming which token pairs matter and at what WCAG level;
 * `checkTokenContrast` (`contrast-gate.ts`) is the pure gate that resolves
 * each pair — including any `var()` alias chain, via
 * `internal/resolve-token-value.ts` — and reports a real threshold miss
 * or an unevaluable pair as a named finding, never a silent skip.
 * `ui-contrast-check` (`contrast-cli.ts`, installed as a `bin`) wires all
 * three into a CLI with the same three-state exit-code contract every
 * gate CLI in this repository uses. See the README's "WCAG contrast gate"
 * section for the full contract, including how this differs from the
 * token-PURITY gate at `@vespeneventures/ui/gate` (a different axis
 * entirely: that one flags hardcoded literals against the registry; this
 * one computes luminance for declared pairs).
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

export type { Oklch } from "./color.js";
export { contrastRatio, hexToLinearSRGB, luminanceOf, oklchToLinearSRGB, parseOklch, relativeLuminance } from "./color.js";

export type { ContrastLevel, ContrastPair } from "./contrast-pairs.js";
export { AA, AA_LARGE, CONTRAST_PAIRS } from "./contrast-pairs.js";

export { checkTokenContrast } from "./contrast-gate.js";
export type {
  ContrastGateCheckOptions,
  ContrastGateFailureReason,
  ContrastGateFinding,
  ContrastGateFindingRule,
  ContrastGateResult,
  ContrastGateUnchecked,
  ContrastGateUncheckedReason,
} from "./contrast-gate.js";
