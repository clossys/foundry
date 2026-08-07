/**
 * One SVG child element of an icon's glyph data: `["path", { d: "..." }]`,
 * `["circle", { cx: "12", cy: "12", r: "10" }]`, and so on — the shape every
 * export in this directory (`./icons`) is built from.
 *
 * Declared HERE, inside `./icons` — the pure-data leaf this package's ladder
 * puts BELOW `atoms` (see `src/ladder.test.ts`) — rather than inside
 * `atoms/Icon.tsx` itself: every file in this directory needs it, and none
 * of them may import UP into `atoms/` to get it. That direction is
 * enforced, not just documented — `ladder.test.ts` fails the build the
 * moment a file under `src/icons/` imports from `atoms/` (or `blocks/`,
 * `views/`, `shell/`, `charts/`).
 *
 * `atoms/Icon.tsx` imports this exact type
 * (`import type { IconNode } from "../icons/types.js"`) — the one
 * permitted cross-layer edge, `icons -> atoms`, so both sides share one
 * definition rather than maintaining two independently-typed copies of the
 * same tuple shape. That's a type-only import (erased at compile time, zero
 * runtime cost either way) of a plain structural type — importing it costs
 * an `atoms` consumer nothing at the type level and nothing at all at
 * runtime, which is what makes it safe for `Icon` to depend on even though
 * `Icon` itself never imports any of this directory's glyph VALUES.
 */
export type IconNode = ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>;
