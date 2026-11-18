/**
 * The dynamic route page format (foundry-build-0048 U20). A page contract's `path` is one route pattern:
 * `/` or `/<segment>/...`, each segment either static (`admin`, lower-case kebab) or a parameter (`<agent>`). A page
 * whose path has a parameter is dynamic: it names the `collection` its parameters range over, and one page record
 * serves every value (the admin gallery and slot detail read the consumer's clossys records at that route).
 *
 * Rules (each one a `routeFormatFindings` finding, run by `checkTree`):
 * - grammar: every live page path parses; a parameter appears once per path;
 * - collection: a page with a parameter names a collection, and a page that names a collection has a parameter;
 * - precedence: a static segment wins over a parameter at the same position, so `/admin/requests` is the requests page
 *   and never the gallery of an agent named `requests`; two routes with the same static segments at the same positions
 *   (parameters elsewhere) are ambiguous, since neither wins;
 * - reserved values: the static segments that win over a parameter are values that parameter never takes
 *   (`reservedParams`); a caller holding a closed collection (the agents) refuses one that names a reserved value.
 *
 * Pure: no I/O. `matchRoute` resolves a concrete URL path against a set of patterns under the same precedence.
 */

export type RouteSegment = { readonly kind: "static"; readonly value: string } | { readonly kind: "param"; readonly name: string };
export interface RoutePattern { readonly path: string; readonly segments: readonly RouteSegment[]; readonly params: readonly string[] }
export interface RoutedPage { readonly id: string; readonly path: string; readonly collection?: string }
export interface RouteMatch { readonly id: string; readonly path: string; readonly params: Readonly<Record<string, string>> }

const STATIC = /^[a-z0-9][a-z0-9-]*$/;
const PARAM = /^<([a-z][a-z0-9]*)>$/;
/** A parameter value: one URL segment, lower-case, dots allowed (a slot id such as `sections.hero`). */
const VALUE = /^[a-z0-9][a-z0-9.-]*$/;

/** The parsed pattern, or a reason it does not parse. */
export function parseRoute(path: string): { ok: true; pattern: RoutePattern } | { ok: false; reason: string } {
  if (path === "/") return { ok: true, pattern: { path, segments: [], params: [] } };
  if (!path.startsWith("/") || path.endsWith("/")) return { ok: false, reason: `${JSON.stringify(path)} is not a route: / or /<segment>/... with no trailing slash` };
  const segments: RouteSegment[] = [];
  const params: string[] = [];
  for (const part of path.slice(1).split("/")) {
    const param = PARAM.exec(part);
    if (param) {
      if (params.includes(param[1]!)) return { ok: false, reason: `${path} names the parameter <${param[1]}> twice` };
      params.push(param[1]!);
      segments.push({ kind: "param", name: param[1]! });
    } else if (STATIC.test(part)) segments.push({ kind: "static", value: part });
    else return { ok: false, reason: `${path}: segment ${JSON.stringify(part)} is neither a lower-case kebab segment nor a <parameter>` };
  }
  return { ok: true, pattern: { path, segments, params } };
}

/** The shape two patterns collide on: the static segments by position, `*` for a parameter. */
const shape = (pattern: RoutePattern): string => pattern.segments.map(segment => segment.kind === "static" ? segment.value : "*").join("/");

/** True when `concrete` (a pattern with static segments only, or any pattern) is matched segment by segment by `general`. */
function covers(general: RoutePattern, concrete: RoutePattern, at: number): boolean {
  return general.segments.length === concrete.segments.length && general.segments.every((segment, index) => {
    const other = concrete.segments[index]!;
    if (index === at) return segment.kind === "param" && other.kind === "static";
    return segment.kind === "param" ? true : other.kind === "static" && other.value === segment.value;
  });
}

/**
 * The values each parameter of `path` never takes: the static segment of every other route that wins over it at
 * that position (same length, every other segment matched). `/admin/<agent>` against `/admin/requests` and
 * `/admin/questions` reserves `requests` and `questions` for `agent`.
 */
export function reservedParams(path: string, others: readonly string[]): Record<string, string[]> {
  const parsed = parseRoute(path);
  if (!parsed.ok) return {};
  const out: Record<string, string[]> = {};
  parsed.pattern.segments.forEach((segment, at) => {
    if (segment.kind !== "param") return;
    const values = new Set<string>();
    for (const other of others) {
      const route = parseRoute(other);
      if (!route.ok || other === path || !covers(parsed.pattern, route.pattern, at)) continue;
      const value = route.pattern.segments[at]!;
      if (value.kind === "static") values.add(value.value);
    }
    out[segment.name] = [...values].sort();
  });
  return out;
}

/** Every route format finding over a set of live pages (ids sorted into each message). */
export function routeFormatFindings(pages: readonly RoutedPage[]): string[] {
  const findings: string[] = [];
  const parsed: { page: RoutedPage; pattern: RoutePattern }[] = [];
  for (const page of pages) {
    const route = parseRoute(page.path);
    if (!route.ok) { findings.push(`${page.id}: route ${route.reason}`); continue; }
    parsed.push({ page, pattern: route.pattern });
    if (route.pattern.params.length && !page.collection) findings.push(`${page.id}: route ${page.path} has a parameter but the page names no collection for it to range over`);
    if (!route.pattern.params.length && page.collection) findings.push(`${page.id}: names collection ${page.collection} but route ${page.path} has no parameter`);
  }
  const byShape = new Map<string, string[]>();
  for (const { page, pattern } of parsed) byShape.set(shape(pattern), [...(byShape.get(shape(pattern)) ?? []), page.id]);
  for (const [, ids] of byShape) if (ids.length > 1) {
    const sorted = [...ids].sort();
    findings.push(`${sorted.join(", ")}: routes ${sorted.map(id => parsed.find(entry => entry.page.id === id)!.page.path).join(" and ")} are ambiguous: the same static segments at the same positions, so neither wins`);
  }
  return findings;
}

/**
 * The page a concrete URL path resolves to: the most specific pattern (a static segment beats a parameter, left to
 * right), with its parameter values. Undefined when no pattern matches or a parameter value is not one URL segment.
 */
export function matchRoute(patterns: readonly { id: string; path: string }[], url: string): RouteMatch | undefined {
  const parts = url === "/" ? [] : url.replace(/^\//, "").split("/");
  let best: { match: RouteMatch; rank: string } | undefined;
  for (const entry of patterns) {
    const route = parseRoute(entry.path);
    if (!route.ok || route.pattern.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = route.pattern.segments.every((segment, index) => {
      const part = parts[index]!;
      if (segment.kind === "static") return part === segment.value;
      if (!VALUE.test(part)) return false;
      params[segment.name] = part;
      return true;
    });
    if (!ok) continue;
    // Static before parameter, left to right: "s" sorts after "p", so the higher rank is the more specific route.
    const rank = route.pattern.segments.map(segment => segment.kind === "static" ? "s" : "p").join("");
    if (!best || rank > best.rank) best = { match: { id: entry.id, path: entry.path, params }, rank };
  }
  return best?.match;
}

/** True when the concrete `url` is an instance of `pattern` (every static segment equal, every parameter one segment). */
export function routeInstanceOf(pattern: string, url: string): boolean {
  return matchRoute([{ id: "pattern", path: pattern }], url) !== undefined;
}

/**
 * A publication root: `/` or a static route. The root of a fixed publication (one every consumer holds) is the common
 * static prefix of its pages and never `/`, so it claims no route of the consumer's own site.
 */
export function publicationRootFindings(id: string, root: string, paths: readonly string[], fixed: boolean): string[] {
  const parsed = parseRoute(root);
  if (!parsed.ok || parsed.pattern.params.length) return [`${id}: root ${JSON.stringify(root)} is not a static route`];
  const findings: string[] = [];
  for (const path of paths) if (!(root === "/" || path === root || path.startsWith(`${root}/`))) findings.push(`${id}: page route ${path} is outside the publication root ${root}`);
  if (fixed && root === "/") findings.push(`${id}: a fixed publication roots under its own static prefix, never /`);
  return findings;
}
