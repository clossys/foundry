/**
 * The package default theme now lives in `@clossys/designer/build/theme` (designer.md 9.8); the
 * Studio server only names it. Pin resolution is `../read/theme-pins.ts`.
 */
import { packageDefaultTheme, type ConsumerTheme } from "../read/theme-pins.js";
export { themeCss, themeHash } from "@clossys/designer/build/theme";

export type StudioTheme = ConsumerTheme;

/** The package default theme: the same catalog adoption and CSS emitter used by a Designer library. */
export function defaultStudioTheme(): StudioTheme { return packageDefaultTheme(); }
