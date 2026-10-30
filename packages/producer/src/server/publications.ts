import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ContentMap, ContentMapBreadcrumb, ContentMapCommandGroup, ContentMapNavigation, ContentMapOutlineNode } from "@clossys/publisher/content-map";
import { agentModule, agentRoot, readCells } from "./cells.js";

export interface ConsumerPublication {
  id: string;
  title: string;
  format: ContentMap["format"];
  source: "cells" | "content-map";
  map: ContentMap;
  entryId?: string;
  navigation?: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: Record<string, readonly ContentMapBreadcrumb[]>;
  outline: readonly ContentMapOutlineNode[];
  /** Only explicitly declared, existing app directories enter this mapping. */
  target?: { appDirectory?: string; entryId?: string; path?: string };
}
export interface ConsumerAppsResponse {
  state: "ready" | "missing" | "error";
  publications: ConsumerPublication[];
  message?: string;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9.-]*$/.test(value) && !value.includes("..");

/** Check every ancestor, including absent leaves, before opening consumer data. */
async function safePath(root: string, path: string): Promise<string> {
  const base = resolve(root), target = resolve(base, path), rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new TypeError("Publication path escapes its root");
  let cursor = target;
  for (;;) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError("Publication symbolic links are not followed"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return target;
}
async function readJson(root: string, path: string): Promise<unknown> {
  const handle = await open(await safePath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new TypeError("Expected a publication file"); return JSON.parse(await handle.readFile("utf8")); }
  finally { await handle.close(); }
}
async function optionalJson(root: string, path: string): Promise<unknown> {
  try { return await readJson(root, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function appTarget(root: string, map: ContentMap, metadata: unknown): Promise<ConsumerPublication["target"]> {
  if (metadata === undefined) return undefined;
  if (!object(metadata)) throw new TypeError("Invalid publication route metadata");
  const target: NonNullable<ConsumerPublication["target"]> = {};
  const directories = [metadata.appDir, metadata.appRoot, metadata.siteDir].filter(value => value !== undefined);
  if (directories.length) {
    if (directories.some(value => typeof value !== "string" || !value || /[\\\x00-\x1f\x7f]/.test(value) || /^[a-z]:/i.test(value) || isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === "..")) || new Set(directories).size !== 1) throw new TypeError("Invalid declared app directory");
    const directory = directories[0] as string;
    if (!(await lstat(await safePath(root, directory))).isDirectory()) throw new TypeError("Declared app directory is unavailable");
    target.appDirectory = directory;
  }
  if (metadata.defaultRoute !== undefined) {
    const entry = map.entries.find(row => row.id === metadata.defaultRoute && row.kind !== "group" && row.kind !== "external");
    if (!entry) throw new TypeError("Declared publication entry is unavailable");
    target.entryId = entry.id; target.path = entry.path ?? `/${entry.slug}`;
  }
  return Object.keys(target).length ? target : undefined;
}

/** Runtime discovery reads the consumer's canonical Publisher root. It never
 * compiles cells, repairs generated maps or consults the installed Studio map. */
export async function consumerApps(root: string): Promise<ConsumerAppsResponse> {
  try {
    const publisherRoot = agentRoot(root, "publisher");
    await safePath(publisherRoot, ".");
    const tree = await optionalJson(publisherRoot, "tree.json");
    if (tree !== undefined && (!object(tree) || tree.meta !== undefined && !object(tree.meta))) throw new TypeError("Invalid Publisher tree");
    const declarations = object(tree) && object(tree.meta) ? tree.meta.publications : undefined;
    if (declarations !== undefined && !Array.isArray(declarations)) throw new TypeError("Invalid Publisher publications");
    // The shared store validates grouping, active pointers and cell boundaries
    // even when there are no publications to send through Publisher's reader.
    const active = tree === undefined ? [] : await readCells(root, "publisher", true);
    if (!declarations?.length && active.length) throw new TypeError("Active Publisher cells require publication declarations");
    const sources = new Map<string, { map: ContentMap; title: string; source: ConsumerPublication["source"]; metadata?: unknown }>();
    const [api, cells] = await Promise.all([agentModule("publisher", "content-map/index.js"), declarations?.length ? agentModule("publisher", "content-map/cells.js") : Promise.resolve(undefined)]);
    for (const declaration of declarations ?? []) {
      if (!object(declaration) || !identity(declaration.id) || sources.has(declaration.id)) throw new TypeError("Invalid or repeated publication identity");
      const map: ContentMap = await cells.contentMapFromCells(publisherRoot, declaration.id);
      const group = object(tree) && Array.isArray(tree.tree) ? tree.tree.find(node => object(node) && node.id === declaration.id) : undefined;
      const title = object(group) && typeof group.name === "string" && group.name.trim() ? group.name : declaration.id;
      sources.set(declaration.id, { map, title, source: "cells", metadata: declaration.routePack });
    }
    let filenames: string[] = [];
    // A cell-authored publication set also owns removals. Stale generated files
    // must not resurrect a publication removed from the consumer's tree.
    try { if (declarations === undefined) filenames = await readdir(await safePath(publisherRoot, "content-map")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const filename of filenames.sort()) {
      if (!filename.endsWith(".json")) continue;
      const id = filename.slice(0, -5);
      if (!identity(id)) throw new TypeError("Invalid published map filename");
      await safePath(publisherRoot, join("content-map", filename));
      const map = await readJson(publisherRoot, join("content-map", filename));
      if (api.checkContentMap(map).length || !object(map) || map.publicationId !== id) throw new TypeError("Invalid published content map");
      sources.set(id, { map: map as unknown as ContentMap, title: id, source: "content-map", metadata: await optionalJson(publisherRoot, join("route-pack", filename)) });
    }
    const publications: ConsumerPublication[] = [];
    for (const [id, source] of sources) {
      const { map, title, metadata } = source;
      const target = await appTarget(root, map, metadata);
      const entryId = target?.entryId ?? [...map.entries].filter(entry => entry.kind === "page" || entry.kind === "section").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0]?.id;
      const web = map.format === "web.page.responsive";
      publications.push({ id, title, format: map.format, source: source.source, map, ...(entryId ? { entryId } : {}),
        ...(web && entryId ? { navigation: api.projectNavigation(map, entryId) } : {}),
        commands: web ? api.projectCommands(map) : [],
        breadcrumbs: web ? Object.fromEntries(map.entries.map(entry => [entry.id, api.projectBreadcrumbs(map, entry.id)])) : {},
        outline: api.projectOutline(map), ...(target ? { target } : {}) });
    }
    return publications.length ? { state: "ready", publications } : { state: "missing", publications: [], message: "Publisher publications are not initialized" };
  } catch {
    return { state: "error", publications: [], message: "Publisher publications could not be read; check the publication maps and cell format" };
  }
}
