/**
 * Compile-time proof that `IconProps` (`../Icon.tsx`) does what its own doc
 * comments claim:
 *
 *   1. A call site MUST supply either `decorative: true` or a `label`,
 *      never neither and never both (`IconAccessibilityProps`).
 *   2. A call site MUST supply either `glyph` or `children`, never neither
 *      and never both (`IconContentProps`).
 *
 * This file is deliberately named `*.check.tsx`, not `*.test.tsx` — this
 * package's `tsconfig.json` (matching every other package in this repo)
 * excludes `**\/*.test.ts(x)` from `include`, so `npm run typecheck`/`npm
 * run build` never compiles a test file. `vitest`'s own test run only
 * TRANSPILES (strips types), it doesn't type-check — so a `@ts-expect-error`
 * written in a `*.test.tsx` file is inert here: it would never actually be
 * checked by anything `npm run check` runs. This is filed as issue #24.
 * Living under `src/atoms/internal/` and outside the `*.test.*` glob is
 * what makes this file part of the REAL `tsc` run, the same way
 * `packages/icons`' own (now-folded-in) `src/internal/accessibility-
 * contract.check.tsx` did, and the same way this package's own
 * `src/ladder.test.ts` structural checks run for real in `npm test`.
 *
 * Nothing here is ever imported by `src/index.ts`, `atoms/index.ts`, or any
 * runtime code — its only job is to make `tsc` fail if either contract
 * regresses. `@ts-expect-error` is TypeScript's own "this line must not
 * compile" assertion: if the line below it stops erroring (someone loosens
 * a union), the directive itself then reports "Unused '@ts-expect-error'
 * directive" — a regression turns into a build failure either way, never a
 * silent pass.
 *
 * Proof this actually catches a regression (performed by hand while
 * authoring this file, not re-run by any script — described here rather
 * than scripted, the same precedent the ported `.check.tsx` file above
 * sets): running `npm run typecheck -w packages/ui` on the file as it
 * stands below passes clean. Then, one at a time:
 *   - Commented out each `@ts-expect-error` line in turn and re-ran
 *     typecheck: each produces "Unused '@ts-expect-error' directive" at
 *     that exact line, i.e. the offending JSX now compiles when it must
 *     not.
 *   - Temporarily widened `IconAccessibilityProps` in `../Icon.tsx` to
 *     `{ decorative?: boolean; label?: string }`: both accessibility
 *     `@ts-expect-error` lines below then failed (their expected errors
 *     disappeared).
 *   - Temporarily widened `IconContentProps` (inlined) to
 *     `{ glyph?: IconNode; children?: ReactNode }`: both content
 *     `@ts-expect-error` lines below then failed the same way.
 * Every edit was reverted immediately after confirming red, restoring this
 * file and `../Icon.tsx` to the versions shipped in this PR.
 */
import { Icon } from "../Icon.js";

const glyph = [["path", { d: "M12 2v20" }]] as const;

// ── Accessibility contract (decorative XOR label) ──────────────────────

// @ts-expect-error — neither `decorative` nor `label` is supplied. This is
// exactly the "wrong thing" the accessibility contract exists to make hard
// to reach: an icon with no accessibility intent declared at all.
export const a11yMissingBoth = <Icon glyph={glyph} />;

// @ts-expect-error — `decorative: true` and `label` supplied together.
// `decorative: true` means "adds no information," which is incoherent
// alongside a `label` claiming it does.
export const a11yBoth = <Icon glyph={glyph} decorative label="A vertical line" />;

// Valid — explicitly decorative, no label.
export const a11yDecorativeOnly = <Icon glyph={glyph} decorative />;

// Valid — labeled, decorative omitted (defaults to false).
export const a11yLabeledOnly = <Icon glyph={glyph} label="A vertical line" />;

// ── Content contract (glyph XOR children) ───────────────────────────────

// @ts-expect-error — neither `glyph` nor `children` is supplied. An `Icon`
// with no content source at all is exactly the "wrong thing" this union
// exists to make hard to reach.
export const contentMissingBoth = <Icon decorative />;

export const contentBoth = (
  // @ts-expect-error — both `glyph` and `children` supplied together. There
  // is only one `<svg>` for either to render into; supplying both leaves no
  // coherent answer for which content actually renders.
  <Icon decorative glyph={glyph}>
    <path d="M12 2v20" />
  </Icon>
);

// Valid — glyph data only.
export const contentGlyphOnly = <Icon decorative glyph={glyph} />;

// Valid — children only.
export const contentChildrenOnly = (
  <Icon decorative>
    <path d="M12 2v20" />
  </Icon>
);

// ── Owned-by-the-token props (color/fill/stroke/width/height/strokeWidth)
//    are Omit'd from IconProps, so a call site can't silently defeat the
//    size/colour contract by passing one directly. These belong here, not
//    in Icon.test.tsx: a `@ts-expect-error` in a `*.test.tsx` file is the
//    exact inert-check trap this file's own header comment (and issue #24)
//    describes — vitest transpiles test files without type-checking them,
//    so an assertion like these placed there would silently stop proving
//    anything the moment `Omit` regressed, while still reading as green. ──

// @ts-expect-error — `color` is Omit'd; colour comes from `currentColor`
// only, via CSS on an ancestor, never a per-instance prop.
export const colorOmitted = <Icon decorative glyph={glyph} color="red" />;

// @ts-expect-error — `strokeWidth` is Omit'd; the `--ui-icon-stroke` token
// is the only lever for stroke weight, not a per-instance prop.
export const strokeWidthOmitted = <Icon decorative glyph={glyph} strokeWidth={5} />;

// @ts-expect-error — `width`/`height` are Omit'd; size comes from the
// `size` prop's `--ui-icon-*` token mapping only.
export const widthOmitted = <Icon decorative glyph={glyph} width={40} />;
