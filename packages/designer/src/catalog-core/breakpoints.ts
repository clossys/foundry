/**
 * Tailwind's default screens. Breakpoints are not a themes leaf: a shadcn
 * consumer keeps Tailwind's fixed screen table, so frames, layouts and canvas
 * bodies name a screen and every runtime resolves it to these pixels.
 */
export const TAILWIND_BREAKPOINTS = Object.freeze({ sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 } as const);
export type TailwindBreakpoint = keyof typeof TAILWIND_BREAKPOINTS;
export const TAILWIND_BREAKPOINT_NAMES = Object.freeze(Object.keys(TAILWIND_BREAKPOINTS) as TailwindBreakpoint[]);
export function isTailwindBreakpoint(value: unknown): value is TailwindBreakpoint {
  return typeof value === "string" && Object.hasOwn(TAILWIND_BREAKPOINTS, value);
}
