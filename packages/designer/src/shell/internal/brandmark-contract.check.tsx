/**
 * Compile-time proof of `BrandmarkProps`' contract (`../Brandmark.tsx`).
 * A `*.check.tsx` file rather than a `*.test.tsx` one for the reason
 * `shell-contract.check.tsx` documents at length: `tsc` compiles this file
 * and vitest never type-checks a test, so a `@ts-expect-error` written in
 * the component's test file could never fail. That test file covers the
 * runtime half (a forced `href`/`aria-label` is ignored).
 *
 * Contract checked here: the link's `href` (fixed to "/") and its
 * `aria-label` (the required `label` prop) are not declared props; `lockup`
 * requires a `wordmark` while `mark` refuses one; `variant` and `size` are
 * closed sets.
 *
 * Nothing here is imported by a barrel or by runtime code.
 */
import { Brandmark } from "../Brandmark.js";

export const acceptsMark = <Brandmark variant="mark" size="sm" label="x" markSrc="/m.svg" />;
export const acceptsLockup = <Brandmark variant="lockup" size="lg" label="x" markSrc="/m.svg" wordmark="x" />;

// @ts-expect-error — `href` is not a prop: the link is always "/".
export const rejectsHref = <Brandmark variant="mark" size="sm" label="x" markSrc="/m.svg" href="/elsewhere" />;

// Not asserted here: `aria-label`. TypeScript never checks a hyphenated JSX
// attribute name against the props type, so `<Brandmark aria-label="y" />`
// compiles whatever `BrandmarkProps` says (an `aria-label` key in a plain
// object spread IS rejected as an excess property). The runtime half in
// The component's test file covers it: nothing forced onto the component reaches
// the anchor, because `Brandmark` spreads no props onto it.

// @ts-expect-error — `label` is required: the consumer supplies the whole accessible name.
export const requiresLabel = <Brandmark variant="mark" size="sm" markSrc="/m.svg" />;

// @ts-expect-error — `lockup` requires a `wordmark`.
export const lockupRequiresWordmark = <Brandmark variant="lockup" size="md" label="x" markSrc="/m.svg" />;

// @ts-expect-error — `mark` takes no `wordmark`.
export const markRejectsWordmark = <Brandmark variant="mark" size="md" label="x" markSrc="/m.svg" wordmark="x" />;

// @ts-expect-error — `size` is a closed set.
export const rejectsUnknownSize = <Brandmark variant="mark" size="xl" label="x" markSrc="/m.svg" />;

// @ts-expect-error — `variant` is a closed set.
export const rejectsUnknownVariant = <Brandmark variant="stacked" size="md" label="x" markSrc="/m.svg" />;
