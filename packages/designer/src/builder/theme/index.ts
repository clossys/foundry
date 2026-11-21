/**
 * Theme projection (designer.md 9.8): resolved `themes.*` pins in, CSS out. Plain build code with
 * no server, UI or model; pin resolution lives in `@clossys/producer`
 * and this package never imports it (system.md 14.2).
 */
export type { Mode, ShadcnVar, ThemeSource, ThemeProjection, ResolvedThemePins } from "./types.js";
export type { Sha256, CandidateName } from "../../types.js";
export { projectTheme, isEmptyProjection } from "./project.js";
export { toShadcnVars, stockShadcnVars, SHADCN_VARS } from "./shadcn.js";
export { toCss, themeCss, defaultThemeCss, themeHash } from "./css.js";
