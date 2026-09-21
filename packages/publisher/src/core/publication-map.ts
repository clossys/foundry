import type { ComposeFinding } from "./types.js";

/** Where a publication-map entry is reached in the host application. */
export type PublicationMapLocation =
  | { kind: "path"; path: string }
  | { kind: "slide"; index: number };

/** One routable or ordered surface the host application publishes through a named template. */
export interface PublicationMapEntry {
  id: string;
  template: string;
  documentId: string;
  location: PublicationMapLocation;
}

/**
 * The host-owned wiring between URL paths, slide order, and the
 * `SurfaceDocument` instances publisher seals. Sits beside
 * `SurfaceDocument` in the core contract: publisher validates and resolves
 * the map; the host remains the router adapter.
 */
export interface PublicationMap {
  entries: readonly PublicationMapEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseLocation(value: unknown, pathPrefix: string): { location?: PublicationMapLocation; findings: ComposeFinding[] } {
  const findings: ComposeFinding[] = [];
  if (!isPlainObject(value)) {
    findings.push({ rule: "location-shape", severity: "error", message: "location must be an object", path: pathPrefix });
    return { findings };
  }
  if (value.kind === "path") {
    if (typeof value.path !== "string") {
      findings.push({ rule: "location-path-shape", severity: "error", message: 'path location requires a string "path"', path: `${pathPrefix}.path` });
      return { findings };
    }
    if (value.path.trim().length === 0) {
      findings.push({ rule: "location-path-empty", severity: "error", message: "path location path must not be empty", path: `${pathPrefix}.path` });
    }
    return { location: { kind: "path", path: value.path }, findings };
  }
  if (value.kind === "slide") {
    if (typeof value.index !== "number" || !Number.isFinite(value.index)) {
      findings.push({ rule: "location-slide-index-shape", severity: "error", message: 'slide location requires a finite number "index"', path: `${pathPrefix}.index` });
      return { findings };
    }
    if (value.index < 0) {
      findings.push({ rule: "location-slide-index-negative", severity: "error", message: "slide location index must not be negative", path: `${pathPrefix}.index` });
    }
    return { location: { kind: "slide", index: value.index }, findings };
  }
  findings.push({ rule: "location-kind", severity: "error", message: 'location kind must be "path" or "slide"', path: `${pathPrefix}.kind` });
  return { findings };
}

/**
 * Validates a publication map against the templates the host has registered.
 * Returns findings only; never throws.
 */
export function validatePublicationMap(map: unknown, knownTemplates: readonly string[]): ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  const templateSet = new Set(knownTemplates);
  const seenIds = new Set<string>();

  if (!isPlainObject(map) || !Array.isArray(map.entries)) {
    findings.push({ rule: "map-shape", severity: "error", message: "publication map must be an object with an entries array", path: "entries" });
    return findings;
  }

  map.entries.forEach((entry, index) => {
    const entryPath = `entries[${index}]`;
    if (!isPlainObject(entry)) {
      findings.push({ rule: "entry-shape", severity: "error", message: "each entry must be an object", path: entryPath });
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      findings.push({ rule: "entry-id-shape", severity: "error", message: "entry id must be a non-empty string", path: `${entryPath}.id` });
    } else if (seenIds.has(entry.id)) {
      findings.push({ rule: "entry-id-duplicate", severity: "error", message: `duplicate entry id "${entry.id}"`, path: `${entryPath}.id` });
    } else {
      seenIds.add(entry.id);
    }
    if (!isNonEmptyString(entry.template)) {
      findings.push({ rule: "entry-template-shape", severity: "error", message: "entry template must be a non-empty string", path: `${entryPath}.template` });
    } else if (!templateSet.has(entry.template)) {
      findings.push({
        rule: "entry-template-unknown",
        severity: "error",
        message: `template "${entry.template}" is not registered`,
        path: `${entryPath}.template`,
      });
    }
    if (!isNonEmptyString(entry.documentId)) {
      findings.push({ rule: "entry-document-id-shape", severity: "error", message: "entry documentId must be a non-empty string", path: `${entryPath}.documentId` });
    }
    const locationResult = parseLocation(entry.location, `${entryPath}.location`);
    findings.push(...locationResult.findings);
  });

  return findings;
}

/** Every URL path declared on the map, in entry order. */
export function listPublicationMapPaths(map: PublicationMap): string[] {
  const paths: string[] = [];
  for (const entry of map.entries) {
    if (entry.location.kind === "path") {
      paths.push(entry.location.path);
    }
  }
  return paths;
}

/** The first map entry that answers to `path`, if any. */
export function findPublicationMapEntryByPath(map: PublicationMap, path: string): PublicationMapEntry | undefined {
  return map.entries.find((entry) => entry.location.kind === "path" && entry.location.path === path);
}

/** The first map entry bound to `index` in a slide deck, if any. */
export function findPublicationMapEntryBySlideIndex(map: PublicationMap, index: number): PublicationMapEntry | undefined {
  return map.entries.find((entry) => entry.location.kind === "slide" && entry.location.index === index);
}

/**
 * Fails when a host route path has no matching path location on the map.
 * Slide locations do not satisfy web routes.
 */
export function validatePublicationMapRoutes(routes: readonly string[], map: PublicationMap): ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  const mappedPaths = new Set(listPublicationMapPaths(map));
  for (const route of routes) {
    if (!mappedPaths.has(route)) {
      findings.push({
        rule: "route-missing-from-map",
        severity: "error",
        message: `route "${route}" is absent from the publication map`,
        path: "routes",
      });
    }
  }
  return findings;
}
