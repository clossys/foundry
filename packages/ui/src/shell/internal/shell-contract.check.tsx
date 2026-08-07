/**
 * Compile-time proof that `ShellMainProps` (`../Shell.tsx`) does what its own
 * doc comment claims: `id` is deliberately not an accepted prop, because
 * `Shell.Main` always renders the one fixed id the skip link targets, and a
 * consumer-supplied `id` would silently break that link.
 *
 * This file is deliberately named `*.check.tsx`, not `*.test.tsx` — every
 * package's `tsconfig.json` in this repo excludes `**\/*.test.ts(x)` from
 * `include`, so `npm run typecheck`/`npm run build` never compiles a test
 * file. `vitest`'s own test run only TRANSPILES (strips types), it doesn't
 * type-check — so a `@ts-expect-error` written in a `*.test.tsx` file is
 * inert: it can never fail, and it never reports "unused directive" either.
 * This exact gap — with this exact contract, `Shell.Main` rejecting `id` —
 * is what issue #24 was filed about; `../Shell.test.tsx` carried the inert
 * version of this assertion before it was moved here. See
 * `packages/ui/src/atoms/internal/icon-contract.check.tsx` for the
 * convention's original precedent, and `scripts/check-typechecked-
 * assertions.mjs` for the gate that now fails CI if a directive like this
 * one ever ends up back in a `*.test.ts(x)` file instead.
 *
 * Nothing here is ever imported by `src/index.ts`, `shell/index.ts`, or any
 * runtime code — its only job is to make `tsc` fail if the contract
 * regresses. `Shell.test.tsx` still covers the RUNTIME half of the same
 * contract (that `Shell.Main` ignores an `id` even when one is forced past
 * the type system via a cast) — that half needs a rendered DOM and stays a
 * real vitest test; this file covers the half only `tsc` can check.
 *
 * Proof this actually catches a regression (performed by hand while
 * authoring this file; described here rather than scripted, the same
 * precedent `icon-contract.check.tsx` sets): running
 * `npm run typecheck -w packages/ui` on this file as it stands below passes
 * clean. Commenting out the `@ts-expect-error` line and re-running
 * typecheck produces a real compile error at that line (`id` does not exist
 * on `ShellMainProps`) — i.e. the file now correctly fails without the
 * directive suppressing it. Restoring the directive and instead widening
 * `ShellMainProps` in `../Shell.tsx` to include `id` (temporarily) makes the
 * `@ts-expect-error` line itself fail with "Unused '@ts-expect-error'
 * directive" — proving the directive is watching the contract, not just
 * decorating the file. Both edits were reverted immediately after
 * confirming red, restoring this file and `../Shell.tsx` to the versions
 * shipped in this PR.
 */
import { Shell } from "../Shell.js";

// @ts-expect-error — `id` is deliberately not in ShellMainProps: Shell.Main
// always owns its own id (the skip link's target), so a consumer-supplied
// one must be a compile error, not something silently dropped at runtime.
export const mainRejectsConsumerId = <Shell.Main id="consumer-chosen-id">Content</Shell.Main>;
