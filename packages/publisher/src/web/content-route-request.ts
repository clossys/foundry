import { localePathFor } from "../content/hreflang.js";
import { isContentJson } from "../content/json.js";
import type { ContentRegistry } from "../content/model.js";
import { parseContentRegistry } from "../content/validate.js";
import { selectContentRoute } from "./content-route-binding.js";
import type { ContentRouteSelection } from "./content-route-types.js";

export interface ContentRouteRequestInput {
  readonly registry: ContentRegistry;
  /** An absolute pathname, without a query or fragment. */
  readonly pathname: string;
  readonly deployTarget: string;
  /** Missing translations are 404s unless the consumer explicitly elects a redirect. */
  readonly missingLocale?: "not-found" | "redirect-default";
}

export type ContentRouteRequestResult =
  | { readonly kind: "content"; readonly status: 200; readonly path: string; readonly selection: ContentRouteSelection }
  | { readonly kind: "redirect"; readonly status: 307 | 308; readonly location: string; readonly reason: "canonical-path" | "locale-fallback" }
  | { readonly kind: "not-found"; readonly status: 404; readonly locale: string };

/** Match authored path case and omit trailing slashes; never rewrite content locale in place. */
export function resolveContentRouteRequest(input: ContentRouteRequestInput): ContentRouteRequestResult {
  if (!input || !isContentJson(input.registry)) throw new TypeError("A finite content registry is required");
  const registry = parseContentRegistry(input.registry);
  if (typeof input.deployTarget !== "string" || !registry.workspace.deployTargets.some(target => target.id === input.deployTarget)) {
    throw new TypeError("A declared request deploy target is required");
  }
  if (input.missingLocale !== undefined && !["not-found", "redirect-default"].includes(input.missingLocale)) {
    throw new TypeError("An explicit supported missing-locale policy is required");
  }
  const primary = registry.workspace.defaultLocale;
  const missing = (locale = primary): ContentRouteRequestResult => ({ kind: "not-found", status: 404, locale });
  const pathname = input.pathname;
  if (typeof pathname !== "string" || !pathname.startsWith("/") || /[?#\\\s\u0000-\u001f\u007f]/.test(pathname) || pathname.includes("//")) return missing();
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  try {
    if (normalized.split("/").slice(1).some(segment => [".", ".."].includes(decodeURIComponent(segment)))) return missing();
  } catch { return missing(); }
  const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
  const slots = registry.slots.filter(slot => slot.route !== undefined && slot.kind !== "redirect" && slot.deployTarget === input.deployTarget);
  const routes = slots.flatMap(slot => slot.locales.map(locale => ({
    slot, locale, path: localePathFor(slot.route!, locale, primary),
  })));
  const matches = routes.filter(route => same(route.path, normalized));
  if (matches.length > 1) throw new TypeError("Request paths must identify one locale route independent of case");
  const match = matches[0];
  if (match) {
    const selection = selectContentRoute(registry, match.slot.id, match.locale);
    return pathname === match.path
      ? { kind: "content", status: 200, path: match.path, selection }
      : { kind: "redirect", status: 308, location: match.path, reason: "canonical-path" };
  }
  const segments = normalized.slice(1).split("/");
  const locale = registry.workspace.locales.find(tag => same(tag, segments[0]!));
  if (locale === undefined) return missing();
  const logical = segments.length === 1 ? "/" : `/${segments.slice(1).join("/")}`;
  const defaults = routes.filter(route => route.locale === primary && same(route.path, logical));
  if (defaults.length > 1) throw new TypeError("Request paths must identify one default route independent of case");
  const fallback = defaults[0];
  if (!fallback) return missing(locale);
  if (locale === primary || input.missingLocale === "redirect-default") {
    // Validate the target's active immutable content before promising a redirect to it.
    selectContentRoute(registry, fallback.slot.id, primary);
    return { kind: "redirect", status: locale === primary ? 308 : 307, location: fallback.path,
      reason: locale === primary ? "canonical-path" : "locale-fallback" };
  }
  return missing(locale);
}
