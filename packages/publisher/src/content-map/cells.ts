/** Node-side authoring boundary. Runtime consumers keep reading checked ContentMaps. */
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join, resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { readActive, serializeScalar, parseLinkRef, isoDate, type GenericTreeNode, type StoredCell } from "@clossys/strategist/cell-format";
import { checkContentMap, checkedContentMap } from "./check.js";
import type { ContentMap, ContentMapNode } from "./contract.js";

type JsonObject = Record<string, any>;
export interface CellCompileFinding { readonly severity: "warning" | "error"; readonly message: string }
export interface CellCompileOptions { readonly check?: boolean; readonly agentRoots?: Readonly<Record<string, string>> }
interface Publication extends JsonObject { id: string; format: ContentMap["format"]; entryIds: Record<string, string>; entryOrder: string[]; entryMeta: Record<string, JsonObject> }
const PAGE_ID = /^page\.[a-z][a-z0-9-]*$/;
const KEYS = new Set(["id", "version", "status", "updated", "links", "confirmed", "note", "kind", "title", "path", "slug", "pageConfig", "icon", "description", "keywords", "planItemId", "frame", "sections", "href", "indexing", "indexingReason", "lastModified"]);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function error(path: string, message: string): never { throw new TypeError(`${path}: ${message}`); }
async function safe(root: string, path: string): Promise<string> {
  const base = resolve(root), target = resolve(base, path), rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) error(path, "Path escapes cell root");
  let current = target;
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) error(path, "Symbolic links are not followed"); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return target;
}
async function put(root: string, path: string, source: string) {
  const target = await safe(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, source);
}
async function readJson(root: string, path: string): Promise<any> { return JSON.parse(await readFile(await safe(root, path), "utf8")); }
function pageId(id: string) { const value = `page.${id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`; if (!PAGE_ID.test(value)) error(id, "Cannot derive a permanent page cell id"); return value; }
function publicationId(id: unknown): asserts id is string { if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id) || id.includes("..")) error("publication", "Expected a safe publication identity"); }
function fields(source: JsonObject): string { return Object.entries(source).map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(serializeScalar).join(", ")}]` : serializeScalar(value)}`).join("\n"); }
function cellSource(entry: ContentMapNode, id: string, date: string, route?: JsonObject): string {
  const source = entry.kind === "external" ? { href: entry.href } : "planItemId" in entry.source ? { planItemId: entry.source.planItemId } : { frame: entry.source.frameId, sections: entry.source.sectionIds };
  const front: JsonObject = { id, version: 1, status: "active", updated: date, links: [], confirmed: `migration:${date}`, kind: entry.kind, title: entry.title, ...(entry.path === undefined ? { slug: entry.slug } : { path: entry.path }), ...source };
  for (const key of ["pageConfig", "icon", "description", "keywords", "lastModified"] as const) if (entry[key] !== undefined) front[key] = entry[key];
  if (entry.indexing !== undefined) { front.indexing = entry.indexing.mode; if (entry.indexing.reason !== undefined) front.indexingReason = entry.indexing.reason; }
  let body = "## Copy\n";
  for (const [title, data] of [["Constructs", entry.constructs], ["Manifest", entry.manifest], ["Actions", entry.actions], ["Body", entry.body], ["Route", route]] as const) if (data !== undefined) body += `\n## ${title}\n\`\`\`json\n${json(data)}\`\`\`\n`;
  return `---\n${fields(front)}\n---\n\n${body}`;
}
function blocks(cell: StoredCell): Record<string, unknown> {
  const lines = cell.document.body; const result: Record<string, unknown> = {}; let previous = -1;
  const headings = ["Copy", "Constructs", "Manifest", "Actions", "Body", "Route"];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; if (!line.text.trim()) continue;
    const heading = /^## (.+)$/.exec(line.text)?.[1]; const position = headings.indexOf(heading ?? "");
    if (position < 0 || position <= previous) error(cell.path, `line ${line.line}: Expected ordered Copy, Constructs, Manifest, Actions, Body or Route sections`);
    previous = position;
    if (heading === "Copy") {
      const copy: string[] = [];
      while (i + 1 < lines.length && !lines[i + 1]!.text.startsWith("## ")) {
        const row = lines[++i]!; if (!row.text.trim()) continue;
        if (!/^- [^:]+: writer:[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(row.text)) error(cell.path, `line ${row.line}: Expected a Writer cell copy bullet`);
        copy.push(row.text);
      }
      result.Copy = copy; continue;
    }
    while (i + 1 < lines.length && !lines[i + 1]!.text.trim()) i++;
    if (lines[++i]?.text !== "```json") error(cell.path, "Expected one fenced json block");
    const content: string[] = [];
    while (++i < lines.length && lines[i]!.text !== "```") content.push(lines[i]!.text);
    if (i >= lines.length) error(cell.path, "Unclosed json block");
    try { result[heading!] = JSON.parse(content.join("\n")); } catch { error(cell.path, "Invalid fenced JSON"); }
  }
  if (!Object.hasOwn(result, "Copy")) error(cell.path, "Expected Copy section");
  return result;
}
function parsePage(cell: StoredCell, entryId: string, parentId: string | undefined, order: number, meta: JsonObject): { entry: JsonObject; route?: JsonObject } {
  const f = cell.document.fields;
  if (!PAGE_ID.test(cell.id)) error(cell.path, "Expected a permanent page cell id");
  for (const key of Object.keys(f)) if (!KEYS.has(key)) error(cell.path, `line ${cell.document.fieldLines[key]}: Unknown frontmatter key ${key}`);
  if (!["page", "slide", "section", "external"].includes(f.kind as string)) error(cell.path, "kind must be page, slide, section or external; groups belong in tree.json");
  if (!Array.isArray(f.links)) error(cell.path, "links list is required");
  if (typeof f.title !== "string" || !f.title.trim() || (f.path === undefined) === (f.slug === undefined)) error(cell.path, "Expected title and exactly one path or slug");
  if (f.kind === "external") {
    if (f.path === undefined || typeof f.href !== "string") error(cell.path, "External cells require path and href");
    if (["planItemId", "frame", "sections", "pageConfig"].some(key => f[key] !== undefined)) error(cell.path, "External cells cannot carry source or pageConfig keys");
  } else {
    if (f.href !== undefined) error(cell.path, "Only external cells can carry href");
    if (f.planItemId !== undefined && (f.frame !== undefined || f.sections !== undefined)) error(cell.path, "Conflicting source keys");
    if (f.planItemId === undefined && (typeof f.frame !== "string" || !Array.isArray(f.sections))) error(cell.path, "Expected planItemId or frame and sections");
  }
  if (f.indexing === undefined && f.indexingReason !== undefined) error(cell.path, "indexingReason requires indexing");
  const body = blocks(cell);
  const pin = meta.pin ? { nav: true as const, ...(meta.pin.group && parentId ? { group: parentId } : {}) } : undefined;
  const entry: JsonObject = { id: entryId, ...(parentId ? { parentId } : {}), order, title: f.title, kind: f.kind, ...(f.path === undefined ? { slug: f.slug } : { path: f.path }), ...(f.kind === "external" ? { href: f.href } : { source: f.planItemId === undefined ? { frameId: f.frame, sectionIds: f.sections } : { planItemId: f.planItemId } }), ...(pin ? { pin } : {}) };
  for (const key of ["pageConfig", "icon", "description", "keywords", "lastModified"]) if (f[key] !== undefined) entry[key] = f[key];
  if (f.indexing !== undefined) entry.indexing = { mode: f.indexing, ...(f.indexingReason === undefined ? {} : { reason: f.indexingReason }) };
  if (body.Constructs !== undefined) entry.constructs = body.Constructs;
  if (body.Manifest !== undefined) entry.manifest = body.Manifest;
  if (Object.hasOwn(body, "Actions")) entry.actions = body.Actions;
  if (Object.hasOwn(body, "Body")) entry.body = body.Body;
  if (body.Route !== undefined && !object(body.Route)) error(cell.path, "Route metadata must be an object");
  return { entry, ...(body.Route === undefined ? {} : { route: body.Route as JsonObject }) };
}
/** Narrow parsed cell data only after the complete public contract accepts it. */
function assertCompiledMap(map: unknown): asserts map is ContentMap {
  const findings = checkContentMap(map);
  if (findings.length) error("content-map", `Content map refused: ${findings.map(finding => `${finding.code} ${finding.path}`).join("; ")}`);
}
async function load(root: string, options: CellCompileOptions = {}) {
  const active = await readActive(root), tree = await readJson(root, "tree.json"), cells = new Map(active.map(cell => [cell.id, cell]));
  if (!Array.isArray(tree.meta?.publications) || !Array.isArray(tree.tree)) error("tree.json", "Publisher publications and tree are required");
  const maps: ContentMap[] = [], findings: CellCompileFinding[] = [], routePacks: { id: string; pack: JsonObject }[] = [];
  const publications = new Set<string>(), compiledCells = new Set<string>();
  for (const pub of tree.meta.publications as Publication[]) {
    publicationId(pub.id); if (!object(pub.entryIds) || !object(pub.entryMeta) || !Array.isArray(pub.entryOrder)) error("tree.json", "Expected migration identities and pass-through headers");
    if (publications.has(pub.id)) error(pub.id, "Duplicate publication identity"); publications.add(pub.id);
    const top = tree.tree.find((node: GenericTreeNode) => node.id === pub.id); if (!top) error(pub.id, "Publication tree missing");
    const entries: JsonObject[] = [], routes = new Map<string, JsonObject>();
    const walk = (node: JsonObject, parentId?: string, order = 0) => {
      let parent = parentId;
      if (node.entry !== undefined) {
        if (!object(node.entry) || node.entry.kind !== "group") error("tree.json", "Only group entries belong in grouping nodes");
        const entry = { ...node.entry, id: node.id, title: node.name, order, ...(parentId ? { parentId } : {}) };
        entries.push(entry); parent = entry.id;
      }
      (node.cells ?? []).forEach((id: string, index: number) => {
        const cell = cells.get(id); if (!cell) return;
        const entryId = pub.entryIds[id]; if (typeof entryId !== "string") error(id, "Missing stable source entry identity");
        if (compiledCells.has(id)) error(id, "Cell belongs to more than one publication"); compiledCells.add(id);
        const parsed = parsePage(cell, entryId, parent, index, pub.entryMeta[id] ?? {}); entries.push(parsed.entry);
        if (parsed.route) routes.set(entryId, parsed.route);
      });
      (node.children ?? []).forEach((child: JsonObject, index: number) => walk(child, parent, index));
    };
    walk(top);
    entries.sort((a, b) => { const ia = pub.entryOrder.indexOf(a.id), ib = pub.entryOrder.indexOf(b.id); return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib); });
    const map = { version: 1, publicationId: pub.id, format: pub.format, entries, ...(pub.actions === undefined ? {} : { actions: pub.actions }), ...(pub.redirects === undefined ? {} : { redirects: pub.redirects }) };
    assertCompiledMap(map);
    maps.push(map);
    if (pub.routePack !== undefined) {
      if (!object(pub.routePack)) error(pub.id, "Invalid route pack header");
      const compiledRoutes = entries.filter(entry => entry.kind !== "group" && entry.kind !== "external").map(entry => {
        const metadata = routes.get(entry.id); if (!metadata) error(entry.id, "Missing Route metadata");
        return { ...metadata, instanceId: entry.id, path: entry.path ?? `/${entry.slug}`, label: entry.title, ...(entry.keywords === undefined ? {} : { keywords: entry.keywords }) };
      });
      routePacks.push({ id: pub.id, pack: { ...pub.routePack, routes: compiledRoutes } });
    }
  }
  for (const cell of active) if (!compiledCells.has(cell.id)) error(cell.id, "Active cell is not placed in a declared publication");
  for (const cell of active) for (const value of cell.document.fields.links as string[]) {
    const ref = parseLinkRef(value); if (!ref) error(cell.path, "Invalid cell link");
    const agent = ref.agent ?? "publisher", otherRoot = options.agentRoots?.[agent] ?? (agent === "publisher" ? root : join(dirname(resolve(root)), agent));
    let other: any;
    try { other = await readJson(otherRoot, "tree.json"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; findings.push({ severity: "warning", message: `Linked ${agent} root unavailable for ${value}` }); continue; }
    if (other.active?.[ref.cell] !== ref.version) findings.push({ severity: "warning", message: `Unresolved cell link ${value}` });
    else { try { await readFile(await safe(otherRoot, `cells/${ref.cell}/v${ref.version}.md`)); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; findings.push({ severity: "warning", message: `Unresolved cell file ${value}` }); } }
  }
  return { maps, findings, routePacks };
}
/** Read active cells without writing generated outputs. */
export async function contentMapFromCells(root: string, publicationId: string, options: CellCompileOptions = {}): Promise<ContentMap> {
  const result = await load(root, options), map = result.maps.find(row => row.publicationId === publicationId);
  if (!map) error(publicationId, "Unknown publication"); return map;
}
/** Compile outputs remain generated; --check compares content without repairing edits. */
export async function compileContentMaps(root: string, options: CellCompileOptions = {}): Promise<{ maps: readonly ContentMap[]; findings: readonly CellCompileFinding[] }> {
  const { maps, findings, routePacks } = await load(root, options);
  const outputs: [string, unknown][] = maps.map(map => [`content-map/${map.publicationId}.json`, map]);
  for (const { id, pack } of routePacks) outputs.push([`route-pack/${id}.json`, pack]);
  outputs.push(["compile.json", { schemaVersion: 1, outputs: outputs.map(([path]) => path) }]);
  for (const [path, value] of outputs) {
    if (options.check) { let existing: unknown; try { existing = await readJson(root, path); } catch { error(path, "Generated output missing or invalid"); } if (!equal(existing, value)) error(path, "Generated output drift"); }
    else await put(root, path, json(value));
  }
  return { maps, findings };
}
/** One-time migration: existing roots are refused, never overwritten. */
export async function contentMapToCells(map: ContentMap, root: string, options: { date?: string; routePack?: JsonObject } = {}): Promise<void> {
  checkedContentMap(map); publicationId(map.publicationId);
  const date = options.date ?? new Date().toISOString().slice(0, 10); if (!isoDate(date)) error("date", "Expected a calendar date");
  try { if ((await readdir(await safe(root, "."))).length) error(root, "Migration target must be empty"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  const ids: Record<string, string> = {}, entryMeta: Record<string, JsonObject> = {}, texts: [string, string][] = [];
  const rootNode: JsonObject = { id: map.publicationId, name: map.publicationId, children: [] }, nodes = new Map<string, JsonObject>();
  for (const entry of map.entries.filter(entry => entry.kind === "group")) {
    const { id, title, parentId: _parent, order: _order, ...rest } = entry;
    nodes.set(id, { id, name: title, entry: rest, children: [], cells: [] });
  }
  const ordered = [...map.entries].sort((a, b) => a.order - b.order);
  for (const entry of ordered.filter(entry => entry.kind === "group")) {
    const parent = entry.parentId ? nodes.get(entry.parentId) : rootNode;
    if (!parent) error(entry.id, "Group parent missing"); parent.children.push(nodes.get(entry.id));
  }
  let ungrouped: JsonObject | undefined;
  for (const entry of ordered.filter(entry => entry.kind !== "group")) {
    const id = pageId(entry.id); if (ids[id]) error(id, "Cell identity collision across entries"); ids[id] = entry.id;
    if (entry.pin) entryMeta[id] = { pin: entry.pin };
    let parent = entry.parentId ? nodes.get(entry.parentId) : undefined;
    if (entry.parentId && !parent) error(entry.id, "Page-parent section topology is not supported by this migration");
    if (!parent) { if (!ungrouped) { ungrouped = { id: `${map.publicationId}.pages`, name: "Pages", cells: [] }; rootNode.children.push(ungrouped); } parent = ungrouped; }
    parent.cells.push(id);
    const originalRoute = options.routePack?.routes.find((route: JsonObject) => route.instanceId === entry.id);
    let route: JsonObject | undefined;
    if (originalRoute) { const { instanceId: _id, path: _path, label: _label, keywords: _keywords, ...extras } = originalRoute; route = extras; }
    texts.push([`cells/${id}/v1.md`, cellSource(entry, id, date, route)]);
  }
  const publication: Publication = { id: map.publicationId, format: map.format, entryIds: ids, entryOrder: map.entries.map(entry => entry.id), entryMeta, ...(map.actions === undefined ? {} : { actions: map.actions }), ...(map.redirects === undefined ? {} : { redirects: map.redirects }) };
  if (options.routePack) { const { routes: _routes, ...header } = options.routePack; publication.routePack = header; }
  const tree = { schemaVersion: 1, tree: [rootNode], active: Object.fromEntries(Object.keys(ids).map(id => [id, 1])), retired: [], meta: { publications: [publication] } };
  // Validate the full migration before creating any source file.
  for (const [path, source] of texts) { if (!source) error(path, "Empty cell"); }
  for (const [path, source] of texts) await put(root, path, source);
  await put(root, "tree.json", json(tree)); await compileContentMaps(root);
}
/** Static legacy route-pack migration. Extras live with their route; header/aliases stay in tree metadata. */
export async function routePackToCells(pack: unknown, root: string, options: { date?: string } = {}): Promise<void> {
  if (!object(pack) || !Array.isArray(pack.routes) || !pack.routes.length || typeof pack.packId !== "string") error("route-pack", "Expected a named route pack with routes");
  const map: ContentMap = { version: 1, publicationId: pack.packId, format: "web.page.responsive", entries: pack.routes.map((route: JsonObject, index: number) => {
    if (!object(route) || typeof route.instanceId !== "string" || typeof route.path !== "string" || typeof route.label !== "string") error("route-pack", "Expected literal route identity, path and label");
    return { id: route.instanceId, order: index, title: route.label, path: route.path, kind: "page", source: { planItemId: route.instanceId }, ...(route.keywords === undefined ? {} : { keywords: route.keywords }) };
  }) };
  await contentMapToCells(map, root, { ...options, routePack: pack });
}
