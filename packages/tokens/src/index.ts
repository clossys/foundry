/**
 * @vespeneventures/tokens — a zero-dependency design-token package.
 *
 * A design token is a name for a design decision — `surface-raised`, not
 * `#F2EFE6` — so that the decision can be looked up and changed in one
 * place instead of hardcoded everywhere it's used. This package ships that
 * naming in two forms that describe the same 128 tokens:
 *
 *   - `styles/tokens.css` — CSS custom properties, the primary artifact.
 *   - This module — the same tokens as typed data, for JS/TS code that
 *     wants a token's name or default value without parsing CSS.
 *
 * See the README for the three-layer contract (primitives → brand binding
 * → consumer extensions), the naming rule that splits tokens into Tailwind
 * v4 `@theme` namespaces versus the `--ui-` prefix, and the full token
 * reference table.
 */

export type { TokenDefinition, TokenFamily } from "./tokens.js";
export { TOKENS, TOKEN_FAMILIES } from "./tokens.js";
