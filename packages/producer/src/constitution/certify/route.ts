/**
 * The dynamic route page format, as the page certifier reads it (foundry-build-0048 U20). A page record's `path` is a
 * route pattern: static lower-case kebab segments and `<param>` segments (the Publisher directory's own notation,
 * packages/publisher/src/catalog/ia/route-format.ts, which this mirrors: producer reads the installed Publisher only
 * through its published exports). A concrete route is an instance of a pattern when every static segment is equal and
 * every parameter takes one lower-case URL segment (dots allowed: a slot id such as `sections.hero`). Pure.
 */
const STATIC = /^[a-z0-9][a-z0-9-]*$/;
const PARAM = /^<[a-z][a-z0-9]*>$/;
const VALUE = /^[a-z0-9][a-z0-9.-]*$/;

const segments = (path: string): string[] | undefined => path === "/" ? [] : path.startsWith("/") && !path.endsWith("/") ? path.slice(1).split("/") : undefined;

/** True when `path` names at least one `<param>` segment. */
export const isDynamicRoute = (path: string): boolean => (segments(path) ?? []).some(part => PARAM.test(part));

/** True when the concrete route `url` is an instance of the pattern `pattern`. */
export function routeInstanceOf(pattern: string, url: string): boolean {
  const want = segments(pattern), have = segments(url);
  if (!want || !have || want.length !== have.length) return false;
  return want.every((part, index) => PARAM.test(part) ? VALUE.test(have[index]!) : STATIC.test(part) && part === have[index]);
}
