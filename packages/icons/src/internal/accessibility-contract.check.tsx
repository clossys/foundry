/**
 * Compile-time proof that `IconAccessibilityProps` (src/types.ts) does what
 * README.md and types.ts's own doc comment claim: a call site MUST supply
 * either `decorative: true` or a `label`, never neither and never both.
 *
 * This file is deliberately named `*.check.tsx`, not `*.test.tsx` — this
 * package's `tsconfig.json` (matching every other package here) excludes
 * `**\/*.test.ts(x)` from `include` so `npm run typecheck`/`npm run build`
 * don't try to compile test files, which ALSO means a `@ts-expect-error` in
 * a `.test.tsx` file would never actually be checked by `npm run
 * typecheck` — vitest's own test run only transpiles (strips types), it
 * doesn't type-check. Living under `src/internal/` and outside the
 * `*.test.*` glob is what makes this file part of the real `tsc` run every
 * `npm run check` performs, the same way `@vespeneventures/ui`'s
 * `src/ladder.test.ts` structural checks run for real in `npm test`.
 *
 * Nothing here is ever imported by `src/index.ts` or by any runtime code —
 * its only job is to make `tsc` fail if the accessibility contract
 * regresses. `@ts-expect-error` is TypeScript's own "this line must not
 * compile" assertion: if the line below it stops erroring (someone
 * loosens the union), the directive itself then reports "Unused
 * '@ts-expect-error' directive" — a regression turns into a build failure
 * either way, never a silent pass.
 *
 * Proof this actually catches a regression (performed by hand while
 * authoring this file, described in the PR body rather than re-run by any
 * script): commenting out either `@ts-expect-error` line below and running
 * `npm run typecheck -w packages/icons` immediately fails with "Unused
 * '@ts-expect-error' directive", and separately, temporarily widening
 * `IconAccessibilityProps` in types.ts to `{ decorative?: boolean; label?:
 * string }` makes BOTH `@ts-expect-error` lines fail typecheck (their
 * "expected" errors disappear) — both edits were reverted after
 * confirming red, restoring the file below to green.
 */
import { ClockIcon } from "../icons/ClockIcon.js";

// @ts-expect-error — neither `decorative` nor `label` is supplied. This is
// exactly the "wrong thing" the accessibility contract exists to make hard
// to reach: an icon with no accessibility intent declared at all.
export const missingBoth = <ClockIcon />;

// @ts-expect-error — `decorative: true` and `label` supplied together.
// `decorative: true` means "adds no information," which is incoherent
// alongside a `label` claiming it does.
export const both = <ClockIcon decorative label="Recently updated" />;

// Valid — explicitly decorative, no label.
export const decorativeOnly = <ClockIcon decorative />;

// Valid — labeled, decorative omitted (defaults to false).
export const labeledOnly = <ClockIcon label="Recently updated" />;
