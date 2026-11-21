/**
 * The dynamic route page format, as the page certifier reads it (foundry-build-0048 U20). A page record's `path` is a
 * route pattern: static lower-case kebab segments and `<param>` segments (the Publisher directory's own notation,
 * @clossys/publisher, which this mirrors: producer reads the installed Publisher only
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

/**
 * A publication root: `/` or a static route (the Publisher's `publicationRootFindings`, mirrored with its messages).
 * Every page route sits at or under the root, and the root of a fixed publication (one every consumer holds, the admin
 * workspace) is its own static prefix, never `/`, so it claims no route of the consumer's own site.
 */
export function publicationRootFindings(id: string, root: string, paths: readonly string[], fixed: boolean): string[] {
  const parts = segments(root);
  if (!parts || !parts.every(part => STATIC.test(part))) return [`${id}: root ${JSON.stringify(root)} is not a static route`];
  const findings: string[] = [];
  for (const path of paths) if (!(root === "/" || path === root || path.startsWith(`${root}/`))) findings.push(`${id}: page route ${path} is outside the publication root ${root}`);
  if (fixed && root === "/") findings.push(`${id}: a fixed publication roots under its own static prefix, never /`);
  return findings;
}
