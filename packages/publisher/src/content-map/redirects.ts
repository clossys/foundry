import { isSanctionedHref } from "../internal/href.js";
import type { ContentMap, ContentMapFinding, ContentMapRedirect } from "./contract.js";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const unsafeCharacters = /[\s\u0000-\u0020\u007f\\]/;
// Next matches redirect sources without regard to case; normalize only check keys.
const redirectKey = (path: string): string => path.toLowerCase();

/** Next interprets source patterns; map redirects deliberately name literal paths. */
function canonicalSource(value: unknown): value is string {
  return typeof value === "string" && isSanctionedHref(value) && value.startsWith("/")
    && !unsafeCharacters.test(value) && !/[?#%:*+()[\]{}]/.test(value)
    && !value.includes("//") && (value === "/" || !value.endsWith("/"))
    && !value.split("/").some(segment => segment === "." || segment === "..");
}

function safeDestination(value: unknown): value is string {
  if (typeof value !== "string" || !isSanctionedHref(value) || unsafeCharacters.test(value)
    || /%(?![\da-f]{2})|%(?:0[\da-f]|1[\da-f]|7f|5c)/i.test(value)) return false;
  if (value.startsWith("/")) return canonicalSource(value.split(/[?#]/, 1)[0]);
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || parsed.username || parsed.password) return false;
    const path = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(value)?.[1];
    if (path === undefined || path.includes("//")) return false;
    return path.split("/").every(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\");
    });
  } catch { return false; }
}

interface RedirectEdge {
  readonly source: string;
  readonly destination: string;
  readonly path: string;
}

/** Redirect-only checks over raw map data. The map checker owns the enclosing
 * plain-data contract; this helper does not call back into map projections. */
export function checkContentMapRedirects(input: unknown): readonly ContentMapFinding[] {
  const findings: ContentMapFinding[] = [];
  if (!record(input)) return findings;
  const add = (path: string, message: string) => findings.push({ severity: "P0", code: "redirect", path, message });
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const occupied = new Set(entries.filter(entry => record(entry) && !["group", "external"].includes(entry.kind as string))
    .map(entry => entry.path ?? (typeof entry.slug === "string" ? `/${entry.slug}` : undefined))
    .filter((path): path is string => typeof path === "string").map(redirectKey));
  const edges = new Map<string, RedirectEdge>();
  const addEdge = (source: unknown, destination: unknown, sourcePath: string, destinationPath: string) => {
    const validSource = canonicalSource(source), validDestination = safeDestination(destination);
    if (!validSource) add(sourcePath, "Redirect source must be a canonical literal local path");
    if (!validDestination) add(destinationPath, "Redirect destination must be a safe canonical local path or HTTP(S) URL");
    if (!validSource) return;
    const key = redirectKey(source);
    if (occupied.has(key)) add(sourcePath, "Redirect source conflicts with an existing content destination");
    if (edges.has(key)) add(sourcePath, "Duplicate redirect source is ambiguous");
    else if (validDestination) edges.set(key, { source: key, destination, path: destinationPath });
  };
  // External entries reserve their own redirect source before explicit rules.
  for (const [index, entry] of entries.entries()) {
    if (!record(entry) || entry.kind !== "external") continue;
    addEdge(entry.path ?? (typeof entry.slug === "string" ? `/${entry.slug}` : undefined), entry.href,
      `entries.${index}.${entry.path === undefined ? "slug" : "path"}`, `entries.${index}.href`);
  }
  if (input.redirects !== undefined && !Array.isArray(input.redirects)) add("redirects", "Redirect declarations must be an array");
  for (const [index, redirect] of (Array.isArray(input.redirects) ? input.redirects : []).entries()) {
    const path = `redirects.${index}`;
    if (!record(redirect) || !Object.keys(redirect).every(key => ["from", "to", "permanent"].includes(key))
      || typeof redirect.permanent !== "boolean") {
      add(path, "A closed redirect declaration with explicit boolean permanent is required"); continue;
    }
    addEdge(redirect.from, redirect.to, `${path}.from`, `${path}.to`);
  }
  for (const edge of edges.values()) {
    const seen = new Set<string>();
    let current: RedirectEdge | undefined = edge;
    while (current) {
      if (seen.has(current.source)) { add(edge.path, "Redirect chain contains a cycle"); break; }
      seen.add(current.source);
      current = current.destination.startsWith("/") ? edges.get(redirectKey(current.destination.split(/[?#]/, 1)[0]!)) : undefined;
    }
  }
  return findings;
}

/** Pure delegate for the checked public projection. External entry paths always
 * use permanent redirects (Next's 308 semantics); declarations retain their flag. */
export function projectContentMapRedirects(map: ContentMap): readonly ContentMapRedirect[] {
  return [
    ...map.entries.flatMap(entry => entry.kind === "external" ? [{
      source: entry.path, destination: entry.href, permanent: true,
    }] : []),
    ...(map.redirects ?? []).map(redirect => ({ source: redirect.from, destination: redirect.to, permanent: redirect.permanent })),
  ].sort((left, right) => left.source < right.source ? -1 : left.source > right.source ? 1 : 0);
}
