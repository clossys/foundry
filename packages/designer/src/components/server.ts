/**
 * @clossys/designer/components/server — the server-safe subset of
 * `@clossys/designer/components`, re-exported from a barrel with no
 * interactive member in it at all. See issue #375: `components/index.ts`
 * re-exports every component EAGERLY from one module, so importing even one
 * of its interactive members (`Button`, `TextField`, ...) pulls in
 * `react-aria-components`, which reads `useContext` at module scope and
 * fails to import under React's `react-server` condition — a packaging
 * problem, not an architectural one, because several individual components
 * (the stock `Alert`, `Badge`, `Card` and `Skeleton`, and `Field`,
 * `Icon`, `Meter`, `Spinner`, `StatusMark`, with the hook-free
 * `Meter.server.tsx` and `Spinner.server.tsx` variants of `Meter` and
 * `Spinner`, whose client versions are built on react-aria-components) plus
 * this package's own `cx` class-merge helper import cleanly under that
 * same condition. This file is that verified-safe subset, published as
 * its own compiled entry (`./dist/components/server.js`) so a React Server
 * Component can reach them without ever loading an interactive component.
 *
 * MEMBERSHIP IS EMPIRICAL, NOT INFERRED. Each name below was confirmed
 * safe by actually resolving its OWN compiled file —
 * `dist/components/<Name>.js`, never the barrel — under
 * `node --conditions=react-server -e "import('./dist/components/<Name>.js')"`
 * and observing the import resolve without throwing. Every other component in
 * `components/index.ts` fails that same probe with
 * `"The requested module 'react' does not provide an export named
 * 'useContext'"` (from react-aria-components' own module scope) and is
 * deliberately NOT re-exported here. Do not add a name to this file
 * without re-running that probe against its real compiled output — see
 * `src/render-environment.ts` for where this file's own verdict is
 * recorded, and `render-environment.test.ts` (a repository-only test that
 * does not ship) for the negative control
 * proving `components/index.ts` still fails the identical probe.
 *
 * This is ADDITIVE: every name below already ships from `components/index.ts`
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
 * `react` is this package's one optional peer every safe component below still
 * depends on (`Icon.tsx` calls `createElement`/`forwardRef`; `Field.server.tsx`
 * and others call `useId` — all confirmed RSC-safe by the same probe this
 * file's own header describes). `react-aria-components` is NOT guarded
 * here: none of these members import it (confirmed by grep), and this
 * subpath's whole reason to exist is to let a consumer reach these
 * members WITHOUT installing that peer at all — a static
 * `react-aria-components/package.json` import here, like `components/index.ts`
 * carries, would defeat that by making the optional peer non-optional for
 * every importer of this file.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { Badge } from "./preview-runtime/components/badge/badge.js";
export type BadgeProps = import("react").ComponentProps<typeof import("./preview-runtime/components/badge/badge.js").Badge>;
export { BADGE_TONE, ALERT_TONE, CARD_SURFACE, SKELETON_SHAPE } from "./surface-tones.js";
export type { BadgeTone, BadgeToneProps, AlertTone, AlertToneProps, CardSurface, SkeletonShape } from "./surface-tones.js";

export { Alert, AlertTitle, AlertDescription, AlertAction } from "./preview-runtime/components/banner/alert.js";
export type AlertProps = import("react").ComponentProps<typeof import("./preview-runtime/components/banner/alert.js").Alert>;

export { Card } from "./preview-runtime/components/card/card.js";
export type CardProps = import("react").ComponentProps<typeof import("./preview-runtime/components/card/card.js").Card>;

export { Field } from "./Field.server.js";
export type { FieldProps, FieldRenderProps } from "./Field.js";

export { Icon } from "./preview-runtime/components/icon/icon.js";
export type { IconProps, IconNode } from "./preview-runtime/components/icon/icon.js";
export type IconSize = NonNullable<import("./preview-runtime/components/icon/icon.js").IconProps["size"]>;

export { Meter } from "./Meter.server.js";
export type { MeterProps, MeterTone, MeterDirection, MeterEmphasis } from "./Meter.js";

export { Skeleton } from "./preview-runtime/components/skeleton/skeleton.js";
export type SkeletonProps = import("react").ComponentProps<typeof import("./preview-runtime/components/skeleton/skeleton.js").Skeleton>;

export { Spinner } from "./Spinner.server.js";
export type { SpinnerProps, SpinnerSize } from "./Spinner.js";

export { StatusMark } from "./StatusMark.js";
export type { StatusMarkProps, StatusMarkTone } from "./StatusMark.js";

/** The shadcn `cn`: clsx, then tailwind-merge extended with the theme spacing and radius scale when that optional peer is present. Pure string logic — no React import at all. */
export { cn } from "./_parts/utils/index.js";

/** The stock shadcn@aria LinkButton behind its deferred boundary: loaded directly where React has createContext, lazily under react-server. */
export { LinkButton } from "../runtime/stock-link-button.js";

/** Merge token-aware Tailwind class names with last-argument precedence. Pure string logic — no React import at all. */
export { cx as mergeUiClasses } from "./internal/cx.js";

/** The `Button` and icon-only control looks for a plain `<a>`, with the focus outline put back. Pure string logic — no React import at all. */
export { buttonLinkClassName, iconButtonClassName, iconButtonLinkClassName, INVERSE_CONTROL_INK } from "./button-classes.js";
export type { ControlGround, IconButtonClassOptions, IconButtonLinkGround, IconButtonShape, IconButtonSize } from "./button-classes.js";

export { Logomark } from "./Logomark.js";
export type { LogomarkProps, LogomarkSize, LogomarkTone, LogomarkPlate } from "./Logomark.js";

export { SemanticContent } from "./SemanticContent.js";
export type { SemanticContentTag, SemanticContentProps } from "./SemanticContent.js";

export { NativeAction } from "./NativeAction.js";
export type { NativeActionProps } from "./NativeAction.js";

