/**
 * Compile-time proof that `IconButton` (`../IconButton.tsx`) requires an
 * accessible name: `label` is a required `string`, and the props that could
 * stand in for it (`aria-label`, `aria-labelledby`) are omitted, so the
 * package can never render an unnamed icon-only control or ship an English
 * default for one.
 *
 * A `*.check.tsx` file, not `*.test.tsx`, for the reason
 * `icon-contract.check.tsx` gives: this package's `tsconfig.json` excludes
 * test files from `tsc`, and vitest only strips types, so a
 * `@ts-expect-error` is checked only here. If a line below stops erroring
 * (someone makes `label` optional), the directive itself reports "Unused
 * '@ts-expect-error' directive" and `npm run typecheck` fails.
 *
 * Mutation proof (by hand while authoring, not scripted): making `label`
 * optional in `IconButtonProps` made the first two directives below unused,
 * and typecheck failed on both lines (TS2578); reverted.
 */
import { ChevronRight } from "../../icons/ChevronRight.js";
import { IconButton } from "../IconButton.js";

// @ts-expect-error — no `label`: an icon-only control without a name.
export const missingLabel = <IconButton icon={ChevronRight} />;

// @ts-expect-error — `aria-label` is not a substitute; the name is `label`.
export const ariaLabelInstead = <IconButton icon={ChevronRight} aria-label="Next" />;

// @ts-expect-error — `label` is a string, never a node.
export const labelNotString = <IconButton icon={ChevronRight} label={<span>Next</span>} />;

// Valid — named, every option set.
export const named = <IconButton icon={ChevronRight} label="Next" size="sm" shape="square" ground="inverse" />;
