/**
 * The single source of truth for the version ranges every peer-version
 * guard in this package compares against — copied from `package.json`'s
 * own `peerDependencies` block once here, instead of re-typed as a string
 * literal at each of the (many) call sites `react`/`react-aria-components`
 * are guarded from (`atoms/index.ts`, `blocks/index.ts`, `shell/index.ts`,
 * `charts/index.ts`, `theme/index.ts`). `declared-peer-ranges.test.ts`
 * asserts every constant below matches `package.json` exactly, so drift
 * between the two fails a real test rather than silently going stale —
 * the same guarantee this package's sibling packages get from asserting
 * their own single declared-range constant directly against
 * `package.json` in a co-located test, just centralized here because this
 * package guards the same peer from more than one file.
 *
 * No `assertPeerVersion` call anywhere in this package passes
 * `REACT_DOM_DECLARED_RANGE` or `INTERNATIONALIZED_DATE_DECLARED_RANGE` as
 * its `declaredRange` — `react-dom` and `@internationalized/date` are
 * declared peers with no adapter import site in this package's own source
 * (see `internal/peer-version.ts`'s own header for the full explanation of
 * both). Both constants are still recorded here, and still covered by
 * this file's own test, purely so `package.json` drifting either range
 * does not go unnoticed.
 */

export const REACT_DECLARED_RANGE = ">=18";
export const REACT_DOM_DECLARED_RANGE = ">=18";
export const REACT_ARIA_COMPONENTS_DECLARED_RANGE = "^1.19.0";
export const TAILWIND_MERGE_DECLARED_RANGE = "^3.0.0";
export const TAILWINDCSS_DECLARED_RANGE = "^4.0.0";
export const INTERNATIONALIZED_DATE_DECLARED_RANGE = "^3.12.2";
