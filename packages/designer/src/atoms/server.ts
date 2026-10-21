/**
 * @clossys/designer/atoms/server — the server-safe subset of
 * `@clossys/designer/atoms`, re-exported from a barrel with no
 * interactive member in it at all. See issue #375: `atoms/index.ts`
 * re-exports every atom EAGERLY from one module, so importing even one
 * of its interactive members (`Button`, `TextField`, ...) pulls in
 * `react-aria-components`, which reads `useContext` at module scope and
 * fails to import under React's `react-server` condition — a packaging
 * problem, not an architectural one, because several individual atoms
 * (`Badge`, `Banner`, `Card`, `Field`, `Icon`, `Meter`, `Skeleton`,
 * `Spinner`, `StatusMark`, and the hook-free `Avatar.server.tsx` variant
 * of `Avatar`) plus
 * this package's own `cx` class-merge helper import cleanly under that
 * same condition. This file is that verified-safe subset, published as
 * its own compiled entry (`./dist/atoms/server.js`) so a React Server
 * Component can reach them without ever loading an interactive atom.
 *
 * MEMBERSHIP IS EMPIRICAL, NOT INFERRED. Each name below was confirmed
 * safe by actually resolving its OWN compiled file —
 * `dist/atoms/<Name>.js`, never the barrel — under
 * `node --conditions=react-server -e "import('./dist/atoms/<Name>.js')"`
 * and observing the import resolve without throwing. Every other atom in
 * `atoms/index.ts` fails that same probe with
 * `"The requested module 'react' does not provide an export named
 * 'useContext'"` (from react-aria-components' own module scope) and is
 * deliberately NOT re-exported here. Do not add a name to this file
 * without re-running that probe against its real compiled output — see
 * `src/render-environment.ts` for where this file's own verdict is
 * recorded, and `render-environment.test.ts` for the negative control
 * proving `atoms/index.ts` still fails the identical probe.
 *
 * This is ADDITIVE: every name below already ships from `atoms/index.ts`
 * (and from there, `src/index.ts`). This file adds a second, narrower way
 * to reach the same bindings — it removes nothing and renames nothing.
 *
 * No wildcard subpath and no per-file deep export: `package.json#exports`
 * still lists every public entry explicitly, keeping the internal file
 * layout out of the public API surface.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` is this package's one optional peer every safe atom below still
 * depends on (`Icon.tsx` calls `createElement`/`forwardRef`; `Field.tsx`
 * and others call `useId` — all confirmed RSC-safe by the same probe this
 * file's own header describes). `react-aria-components` is NOT guarded
 * here: none of these members import it (confirmed by grep), and this
 * subpath's whole reason to exist is to let a consumer reach these
 * members WITHOUT installing that peer at all — a static
 * `react-aria-components/package.json` import here, like `atoms/index.ts`
 * carries, would defeat that by making the optional peer non-optional for
 * every importer of this file.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { Avatar } from "./Avatar.server.js";
export type { AvatarProps, AvatarSize } from "./Avatar.js";

export { Badge } from "./Badge.js";
export type { BadgeProps, BadgeVariant } from "./Badge.js";

export { Banner } from "./Banner.js";
export type { BannerProps, BannerVariant } from "./Banner.js";

export { Card } from "./Card.js";
export type { CardProps, CardVariant, CardGround } from "./Card.js";

export { Field } from "./Field.js";
export type { FieldProps, FieldRenderProps } from "./Field.js";

export { Icon } from "./Icon.js";
export type { IconProps, IconSize, IconAccessibilityProps, IconNode } from "./Icon.js";

export { Meter } from "./Meter.js";
export type { MeterProps, MeterTone, MeterDirection, MeterEmphasis } from "./Meter.js";

export { Skeleton } from "./Skeleton.js";
export type { SkeletonProps, SkeletonShape } from "./Skeleton.js";

export { Spinner } from "./Spinner.js";
export type { SpinnerProps, SpinnerSize } from "./Spinner.js";

export { StatusMark } from "./StatusMark.js";
export type { StatusMarkProps, StatusMarkTone } from "./StatusMark.js";

/** Merge token-aware Tailwind class names with last-argument precedence. Pure string logic — no React import at all. */
export { cx as mergeUiClasses } from "./internal/cx.js";

/** The `Button` and icon-only control looks for a plain `<a>`, with the focus outline put back. Pure string logic — no React import at all. */
export { buttonLinkClassName, iconButtonClassName, iconButtonLinkClassName } from "./button-classes.js";
export type { ControlGround, IconButtonClassOptions, IconButtonLinkGround, IconButtonShape, IconButtonSize } from "./button-classes.js";

export { Logomark } from "./Logomark.js";
export type { LogomarkProps, LogomarkSize, LogomarkTone, LogomarkPlate } from "./Logomark.js";
