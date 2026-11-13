import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ContentMap, ContentMapBreadcrumb, ContentMapCommandGroup, ContentMapNavigation, ContentMapOutlineNode } from "@clossys/publisher/content-map";
import { readPinnedPublication, resolvePublicationTitles } from "../publish/pinned-publication.js";
import { writerCopy } from "../records/writer-copy.js";
import { agentModule } from "./cells.js";
import { hasSlotModel, listSlots, readCandidate, readIa } from "../records/slots.js";

export interface ConsumerPublication {
  id: string;
  /** The publication's own name (its tree name); absent when the publication names none. */
  title?: string;
  format: ContentMap["format"];
  source: "slots";
  map: ContentMap;
  entryId?: string;
  navigation?: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: Record<string, readonly ContentMapBreadcrumb[]>;
  outline: readonly ContentMapOutlineNode[];
  /** Only explicitly declared, existing app directories enter this mapping. */
  target?: { appDirectory?: string; entryId?: string; path?: string; devServerUrl?: string };
}
export interface ConsumerAppsResponse {
  state: "ready" | "missing" | "error";
  publications: ConsumerPublication[];
  message?: string;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);

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
async function appTarget(root: string, map: ContentMap, metadata: unknown): Promise<ConsumerPublication["target"]> {
  if (metadata === undefined) return undefined;
  if (!object(metadata)) throw new TypeError("Invalid publication route metadata");
  const target: NonNullable<ConsumerPublication["target"]> = {};
  if (metadata.devServerUrl !== undefined) {
    if (typeof metadata.devServerUrl !== "string" || metadata.devServerUrl.trim() !== metadata.devServerUrl) throw new TypeError("Invalid declared app server URL");
    const url = new URL(metadata.devServerUrl);
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) throw new TypeError("App server must use a declared local HTTP URL");
    target.devServerUrl = url.href;
  }
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
    const consumer = join(root, "clossys");
    const sources = new Map<string, { map: ContentMap; title?: string; source: ConsumerPublication["source"]; metadata?: unknown }>();
    const api = await agentModule("publisher", "content-map/index.js");
    if (hasSlotModel(consumer) && readIa(consumer, "publisher")) {
      // The slot model is authoritative: only pinned publication slots publish.
      for (const entry of listSlots(consumer, "publisher")) {
        if (!entry.pin || !entry.id.startsWith("publication.")) continue;
        const id = entry.id.slice("publication.".length);
        const { map, routePack } = resolvePublicationTitles(consumer, await readPinnedPublication(consumer, id));
        const candidate = readCandidate(consumer, "publisher", entry.id, entry.pin.candidate);
        if (candidate.sha256 !== entry.pin.sha256) throw new TypeError("Publisher publication pin hash drift");
        const tree = (JSON.parse(candidate.bytes) as { meta?: { tree?: { name?: unknown } } }).meta?.tree;
        const named = typeof tree?.name === "string" && tree.name.trim() ? writerCopy(consumer).text(tree.name) : undefined;
        sources.set(id, { map, ...(named ? { title: named } : {}), source: "slots", ...(routePack ? { metadata: routePack } : {}) });
      }
      return await projectPublications(root, sources, api);
    }
    // Without a Publisher slot model there are no publications to read.
    return await projectPublications(root, sources, api);
  } catch {
    return { state: "error", publications: [], message: "Publisher publications could not be read; check the pinned publication slots" };
  }
}

async function projectPublications(root: string, sources: ReadonlyMap<string, { map: ContentMap; title?: string; source: ConsumerPublication["source"]; metadata?: unknown }>, api: any): Promise<ConsumerAppsResponse> {
  const publications: ConsumerPublication[] = [];
  for (const [id, source] of sources) {
    const { map, title, metadata } = source;
    const target = await appTarget(root, map, metadata);
    const entryId = target?.entryId ?? [...map.entries].filter(entry => entry.kind === "page" || entry.kind === "section").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0]?.id;
    const web = map.format === "web.page.responsive";
    publications.push({ id, ...(title ? { title } : {}), format: map.format, source: source.source, map, ...(entryId ? { entryId } : {}),
      ...(web && entryId ? { navigation: api.projectNavigation(map, entryId) } : {}),
      commands: web ? api.projectCommands(map) : [],
      breadcrumbs: web ? Object.fromEntries(map.entries.map(entry => [entry.id, api.projectBreadcrumbs(map, entry.id)])) : {},
      outline: api.projectOutline(map), ...(target ? { target } : {}) });
  }
  return publications.length ? { state: "ready", publications } : { state: "missing", publications: [], message: "Publisher publications are not initialized" };
}
