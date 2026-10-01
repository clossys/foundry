/**
 * Compile-time-only assertions about `ErrorView`'s props. Named `.check.tsx`
 * rather than `.test.tsx` on purpose: this package's tsconfig excludes test
 * files from the real `tsc` run, so a `@ts-expect-error` inside one asserts
 * nothing. Nothing imports this file at runtime.
 */
import { ErrorView } from "./ErrorView.js";

// The diagnostic reference is caller copy inside `description`, not a slot.
// @ts-expect-error details was removed
export const withDetails = <ErrorView status={500} title="Something went wrong" details={<code>8f2a91c0</code>} />;

// @ts-expect-error detailsLabel was removed
export const withDetailsLabel = <ErrorView status={500} title="Something went wrong" detailsLabel="Technical details" />;
