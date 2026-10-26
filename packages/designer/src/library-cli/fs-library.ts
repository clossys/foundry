import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve as pathResolve, sep } from "node:path";
import { applyLibraryChange, check, emit, generateSelection, libraryHash, parseFill, resolve, stableStringify, type CatalogData, type ChangeSet, type CheckResult, type EmitTarget, type LibraryData } from "../catalog-core/index.js";

import { applyCompositeLibraryChange, compositeLibraryHash, checkComposite, resolveComposite, emitComposite } from "../catalog-core/library-components.js";
import { assertComponentFiles, componentOf, type ComponentDocument } from "../catalog-core/resolve-components.js";
import type { CompositeCatalogData, CompositeLibraryData, CompositeChangeSet, CompositeCheckResult, CompositeEmitTarget, CompositeEngineInput } from "../catalog-core/types.js";

import { canonicalSurfacePortion, isSurfacePackageEntry, surfaceEntryOf, surfaceOutputs, surfaceSelection, verifySurfaceFiles } from "../catalog-core/surface-library.js";
import { runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import type { SurfaceResolutionOptions, SurfaceDocument, SurfaceEntry, SurfaceFile } from "../catalog-core/surface-types.js";
import type { DogfoodFinding, NeedRecord, NeedStatus, NeedCandidate } from "../catalog-core/dogfood.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { readSurfacePackageEvidence } from "./surface-package-evidence.js";

/** A host that omits the surfaces portion gets Foundry's own Section and Frame contracts; a host-supplied portion stays authoritative. */
const withSurfaces = (catalog: CompositeCatalogData): CompositeCatalogData => catalog.surfaces === undefined ? { ...catalog, surfaces: foundrySurfaceCatalog() } : catalog;
/** Host-passed resolution options are used as given. Otherwise, when surfaces are in play, package-pointer
 * evidence is read from the installed package barrels; measurements are never invented. */
async function surfaceOptionsFor(catalog: CompositeCatalogData, given: SurfaceResolutionOptions | undefined, inPlay: boolean): Promise<SurfaceResolutionOptions | undefined> {
  if (given !== undefined || !inPlay) return given;
  return { packages: await readSurfacePackageEvidence(catalog.surfaces?.fills ?? []), measurements: [] };
}

/** Paths a leaf owns, verified against the stored bytes; a package pointer owns none and has none to verify. */
const ownedSurfacePaths = (fill: SurfaceEntry, files: readonly SurfaceFile[]): string[] => { if (!isSurfacePackageEntry(fill)) verifySurfaceFiles(fill, files); return surfaceOutputs(fill).map(row => row.path); };
export const LIBRARY_EMIT_TARGETS: readonly EmitTarget[] = ["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"];

export class LibraryInputError extends Error {}
export class LibraryConflictError extends Error {}
export class LibraryCheckError extends Error {
  constructor(readonly result: CompositeCheckResult) { super("Consumer library check failed"); }
}

const queues = new Map<string, Promise<unknown>>();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []): boolean => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const safeMember = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(value) && !value.split(".").some(part => ["__proto__", "constructor", "prototype"].includes(part));

/** Validate the closed operation envelope before any engine mutation or filename generation. */
export function isLibraryChangeSet(value: unknown, catalog: CatalogData): value is ChangeSet {
  if (!record(value) || !exactKeys(value, ["baseHash", "changes"]) || typeof value.baseHash !== "string" || !/^fnv1a64:[a-f0-9]{16}$/.test(value.baseHash) || !Array.isArray(value.changes) || value.changes.length > 256) return false;
  const slots = new Set(catalog.slots.map(slot => slot.id));
  return value.changes.every(change => {
    if (!record(change) || typeof change.slot !== "string" || !slots.has(change.slot)) return false;
    switch (change.op) {
      case "remove": return exactKeys(change, ["op", "slot"]);
      case "adopt": return exactKeys(change, ["op", "slot", "source"], ["members"]) && typeof change.source === "string" && catalog.sources.some(source => source.id === change.source) && (change.members === undefined || Array.isArray(change.members) && change.members.length > 0 && change.members.every(safeMember));
      case "author": return exactKeys(change, ["op", "slot", "tokens"]) && record(change.tokens) && Object.keys(change.tokens).length > 0 && Object.entries(change.tokens).every(([member, token]) => safeMember(member) && record(token) && typeof token.$type === "string" && Object.hasOwn(token, "$value"));
      case "derive": return exactKeys(change, ["op", "slot", "rule", "inputs"]) && typeof change.rule === "string" && Array.isArray(change.inputs) && change.inputs.every(id => safeMember(id) && /^(tokens|assets)\.[a-z0-9-]+\./.test(id));
      default: return false;
    }
  });
}

/** Filenames are relative, portable and contained even when a future emitter adds new outputs. */
function containedPath(root: string, name: string): string {
  const parts = name.split("/");
  const path = pathResolve(root, name), inside = relative(root, path);
  if (!name || isAbsolute(name) || /^[a-z]:/i.test(name) || name.includes("\\") || parts.some(part => !part || part === "." || part === "..") || inside === ".." || inside.startsWith(".." + sep) || !inside) throw new LibraryInputError("Library path is outside root");
  return path;
}

/** Reject symlinked roots and ancestors; a lexical root alone is not a containment boundary. */
async function directoryRoot(input: string): Promise<string> {
  const root = pathResolve(input);
  if (dirname(root) === root) throw new LibraryInputError("Library root must have a parent");
  let cursor = root;
  for (;;) {
    if (!(await fs.lstat(cursor)).isDirectory()) throw new LibraryInputError("Library root or ancestor is not a regular directory");
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return root;
}

async function regularFile(path: string): Promise<Buffer> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new LibraryInputError("Library entry is not a regular file");
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function evidenceFiles(root: string): Promise<Set<string>> {
  const paths = new Set<string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.add(path);
      else throw new LibraryInputError("Library contains a symlink or special file");
    }
  }
  await walk(root); return paths;
}

/** Readers and writers share a lock across workers and duplicate module instances. No stale-lock guessing. */
async function locked<T>(input: string, run: (root: string) => Promise<T>): Promise<T> {
  const root = pathResolve(input), previous = queues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await directoryRoot(root);
    const lock = join(dirname(root), `.${basename(root)}-lock`);
    await fs.mkdir(lock);
    try {
      // A failed rollback or interrupted swap leaves evidence; never serve it as a clean generation.
      await absent(join(dirname(root), `.${basename(root)}-staging`));
      await absent(join(dirname(root), `.${basename(root)}-backup`));
      return await run(root);
    } finally { await fs.rmdir(lock).catch(() => undefined); }
  });
  queues.set(root, next);
  try { return await next; } finally { if (queues.get(root) === next) queues.delete(root); }
}

async function absent(path: string): Promise<void> {
  try { await fs.lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new LibraryInputError("Unfinished library transaction");
}

/** Stable disk projection: consumer content only, with no seed recipe or implicit catalog fallback. */
export function libraryFiles(catalog: CatalogData, input: LibraryData, targets?: readonly EmitTarget[]): Map<string, string>;
export function libraryFiles(catalog: CompositeCatalogData, input: CompositeLibraryData, targets?: readonly CompositeEmitTarget[], componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Map<string, string>;
export function libraryFiles(catalog: CatalogData | CompositeCatalogData, input: LibraryData | CompositeLibraryData, targets?: readonly CompositeEmitTarget[], componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Map<string, string> {
  if ("values" in catalog) return compositeFiles(catalog, input as CompositeLibraryData, targets, componentOptions, surfaceOptions);
  targets ??= LIBRARY_EMIT_TARGETS;
  const copy = JSON.parse(stableStringify(input)) as LibraryData;
  const ids = new Set(catalog.slots.map(slot => slot.id));
  const fills = [...copy.fills].sort((a, b) => a.$extensions["com.clossys.fill"].slot < b.$extensions["com.clossys.fill"].slot ? -1 : 1);
  const names = fills.map(fill => fill.$extensions["com.clossys.fill"].slot);
  if (new Set(names).size !== names.length || names.some(id => !ids.has(id) || !/^(tokens|assets)\.[a-z][a-z0-9-]*$/.test(id))) throw new LibraryInputError("Invalid library slots");
  const library = { ...copy, fills, selection: generateSelection(copy) };
  const { source, selection, ...rest } = library;
  const metadata: Partial<LibraryData> = { ...rest }; delete metadata.fills;
  const files = new Map<string, string>([
    ["source.json", stableStringify(source)], ["metadata.json", stableStringify(metadata)], ["selection.json", stableStringify(selection)],
    ...fills.map(fill => [`fills/${fill.$extensions["com.clossys.fill"].slot}.json`, stableStringify(fill)] as [string, string]),
  ]);
  const resolved = resolve({ catalog, library });
  files.set("resolved.json", stableStringify(resolved));
  if (targets.some(target => !LIBRARY_EMIT_TARGETS.includes(target as EmitTarget))) throw new LibraryInputError("Unavailable emit target");
  for (const file of emit(resolved, targets as readonly EmitTarget[])) files.set(file.path, file.contents);
  files.set("index.ts", '// Generated consumer library. Do not edit.\nimport type { LibraryData } from "@clossys/designer/catalog";\nimport source from "./source.json";\nimport metadata from "./metadata.json";\nimport selection from "./selection.json";\n'
    + names.map((name, index) => `import fill${index} from "./fills/${name}.json";\n`).join("")
    + `export const library = { ...metadata, source, selection, fills: [${names.map((_, index) => `fill${index}`).join(", ")}] } as unknown as LibraryData;\n`);
  return files;
}

/** The composite projection owns an explicit source inventory; generated files never become source. */
function valuePortion(library: CompositeLibraryData): LibraryData {
  return { ...library.values, source: library.source, ...(library.adoptedAt === undefined ? {} : { adoptedAt: library.adoptedAt }) };
}
const COMPOSITE_TARGETS: readonly CompositeEmitTarget[] = [...LIBRARY_EMIT_TARGETS, "component-index", "components-consumption"];
function compositeFiles(catalog: CompositeCatalogData, input: CompositeLibraryData, targets: readonly CompositeEmitTarget[] | undefined = undefined, componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Map<string, string> {
  const copy = JSON.parse(stableStringify(input)) as CompositeLibraryData;
  targets ??= copy.surfaces === undefined ? COMPOSITE_TARGETS : [...COMPOSITE_TARGETS, "surface-index", "surfaces-consumption"];
  if(copy.surfaces!==undefined)copy.surfaces=canonicalSurfacePortion(copy.surfaces);
  const files = libraryFiles(catalog.values, valuePortion(copy), []);
  const { fills: _values, selection: _selection, ...values } = copy.values;
  const { fills, files: ownedFiles, ...components } = copy.components;
  assertComponentFiles(ownedFiles);
  const ids = new Set(catalog.components.slots.map(slot => slot.id)), seen = new Set<string>();
  for (const fill of fills) {
    const slot = componentOf(fill).slot;
    if (!/^components\.[a-z][a-z0-9-]*$/.test(slot) || !ids.has(slot) || seen.has(slot)) throw new LibraryInputError("Invalid library component slots");
    seen.add(slot); files.set(`fills/${slot}.json`, stableStringify(fill));
  }
  files.set("metadata.json", stableStringify({ format: "composite-v1", ...(copy.adoptedAt === undefined ? {} : { adoptedAt: copy.adoptedAt }), values, components, files: ownedFiles.map(file => file.path), ...(copy.surfaces===undefined?{}:{surfaces:{version:1,files:copy.surfaces.files.map(file=>file.path)}}) }));
  for (const file of ownedFiles) files.set(file.path, file.content);
  if(copy.surfaces){for(const doc of copy.surfaces.fills){const fill=surfaceEntryOf(doc);if(!catalog.surfaces?.slots.some(slot=>slot.id===fill.slot))throw new LibraryInputError("Unknown surface contract");files.set(`fills/${fill.slot}.json`,stableStringify(doc));}for(const file of copy.surfaces.files){if(files.has(file.path))throw new LibraryInputError("Overlapping surface ownership");files.set(file.path,file.content);}files.set("surface-selection.json",stableStringify(surfaceSelection(copy)));}
  const profile = resolveComposite({ catalog, library: copy, componentOptions, surfaceOptions });
  files.set("resolved.json", stableStringify(profile));
  for (const file of emitComposite(profile, targets)) {
    if (ownedFiles.some(owned => owned.path === file.path && owned.content !== file.contents)) throw new LibraryInputError("Emitted file conflicts with owned source");
    files.set(file.path, file.contents);
  }
  const valueNames = copy.values.fills.map(fill => fill.$extensions["com.clossys.fill"].slot).sort();
  const componentNames = [...seen].sort();
  files.set("index.ts", '// Generated consumer library. Do not edit.\nimport type { CompositeLibraryData } from "@clossys/designer/catalog";\nimport source from "./source.json";\nimport metadata from "./metadata.json";\nimport selection from "./selection.json";\n'
    + [...valueNames, ...componentNames, ...(copy.surfaces?.fills.map(doc=>surfaceEntryOf(doc).slot)??[])].map((name, index) => `import fill${index} from "./fills/${name}.json";\n`).join("")
    + `export const library = { source, ...${JSON.stringify(copy.adoptedAt === undefined ? {} : { adoptedAt: copy.adoptedAt })}, values: { ...metadata.values, selection, fills: [${valueNames.map((_, index) => `fill${index}`).join(", ")}] }, components: { ...metadata.components, fills: [${componentNames.map((_, index) => `fill${index + valueNames.length}`).join(", ")}], files: ${JSON.stringify(ownedFiles)} }${copy.surfaces===undefined?"":`, surfaces: { version: 1, fills: [${copy.surfaces.fills.map((_,index)=>`fill${index+valueNames.length+componentNames.length}`).join(", ")}], files: ${JSON.stringify(copy.surfaces.files)} }`} } as unknown as CompositeLibraryData;\n`);
  return files;
}
async function readCompositeUnlocked(root: string, catalog: CompositeCatalogData): Promise<CompositeLibraryData> {
  await evidenceFiles(root); await readNeedsUnlocked(root);
  const parse = async (name: string): Promise<unknown> => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(root, name))));
  const metadata = await parse("metadata.json");
  if (record(metadata) && metadata.format === undefined) {
    const { source, adoptedAt, ...values } = await readUnlocked(root, catalog.values);
    return { source, ...(adoptedAt === undefined ? {} : { adoptedAt }), values, components: { fills: [], files: [] } };
  }
  const source = await parse("source.json"), selection = await parse("selection.json");
  if(record(metadata)&&metadata.surfaces!==undefined&&new TextDecoder("utf-8",{fatal:true}).decode(await regularFile(containedPath(root,"metadata.json")))!==stableStringify(metadata))throw new LibraryInputError("Noncanonical opted-in metadata");
  if (!record(source) || source.kind !== "consumer" || source.author !== "consumer" || typeof source.id !== "string" || typeof source.license !== "string"
    || !record(metadata) || !exactKeys(metadata, ["format", "values", "components", "files"], ["adoptedAt", "surfaces"]) || metadata.format !== "composite-v1"
    || !record(metadata.values) || !exactKeys(metadata.values, [], ["complete", "baseline", "rubricVersion", "strategy", "direction", "rationale"])
    || !record(metadata.components) || !exactKeys(metadata.components, [], ["selection"]) || !Array.isArray(metadata.files) || !metadata.files.every(name => typeof name === "string")) throw new LibraryInputError("Invalid composite metadata");
  const valueIds = new Set(catalog.values.slots.map(slot => slot.id)), componentIds = new Set(catalog.components.slots.map(slot => slot.id));
  const fills: LibraryData["fills"][number][] = [], components: ComponentDocument[] = [], surfaces: SurfaceDocument[]=[];
  if(metadata.surfaces!==undefined&&(!record(metadata.surfaces)||!exactKeys(metadata.surfaces,["version","files"])||metadata.surfaces.version!==1||!Array.isArray(metadata.surfaces.files)||!metadata.surfaces.files.every(name=>typeof name==="string")))throw new LibraryInputError("Invalid surface inventory");
  for (const name of (await fs.readdir(join(root, "fills"))).sort()) {
    const id = name.replace(/\.json$/, "");
    if (name !== `${id}.json`) throw new LibraryInputError("Unknown library fill filename");
    const raw = await parse(`fills/${name}`);
    if (/^components\.[a-z][a-z0-9-]*$/.test(id) && componentIds.has(id)) {
      const fill = raw as ComponentDocument;
      if (componentOf(fill).slot !== id) throw new LibraryInputError("Invalid library component fill");
      components.push(fill);
    } else if(/^(sections|frames)\.[a-z][a-z0-9-]*$/.test(id)) {
      if(metadata.surfaces===undefined||!catalog.surfaces?.slots.some(slot=>slot.id===id))throw new LibraryInputError("Orphan or unknown surface fill");
      const doc=raw as SurfaceDocument;if(surfaceEntryOf(doc).slot!==id||await regularFile(containedPath(root,`fills/${name}`)).then(buffer=>buffer.toString("utf8"))!==stableStringify(canonicalSurfacePortion({version:1,fills:[doc],files:[]}).fills[0]))throw new LibraryInputError("Noncanonical surface fill");surfaces.push(doc);
    } else {
      if (!valueIds.has(id)) throw new LibraryInputError("Unknown library fill filename");
      const parsed = parseFill(raw);
      if (!parsed.fill || parsed.findings.some(finding => finding.severity === "error") || parsed.fill.$extensions["com.clossys.fill"].slot !== id) throw new LibraryInputError("Invalid library fill");
      fills.push(parsed.fill);
    }
  }
  const ownedFiles = await Promise.all(metadata.files.map(async name => ({ path: name as string, content: new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(root, name as string))) })));
  assertComponentFiles(ownedFiles);
  const library = { source, ...(metadata.adoptedAt === undefined ? {} : { adoptedAt: metadata.adoptedAt }), values: { ...metadata.values, fills, selection }, components: { ...metadata.components, fills: components, files: ownedFiles } } as unknown as CompositeLibraryData;
  if(metadata.surfaces!==undefined){
    const inventory=metadata.surfaces as {version:1;files:string[]};const surfaceFiles=await Promise.all(inventory.files.map(async name=>({path:name,content:new TextDecoder("utf-8",{fatal:true}).decode(await regularFile(containedPath(root,name)))})));
    const portion=canonicalSurfacePortion({version:1,fills:surfaces,files:surfaceFiles});const claimed=new Set(portion.fills.flatMap(doc=>ownedSurfacePaths(surfaceEntryOf(doc),portion.files)));
    if(portion.files.some(file=>!claimed.has(file.path)||ownedFiles.some(component=>component.path===file.path))||stableStringify(inventory.files)!==stableStringify(portion.files.map(file=>file.path)))throw new LibraryInputError("Orphan/overlapping/noncanonical surface inventory");
    for(const file of portion.files.filter(file=>file.path.startsWith("surfaces/receipts/"))){let receipt:unknown;try{receipt=JSON.parse(file.content);}catch{throw new LibraryInputError("Invalid surface receipt");}if(file.content!==stableStringify(receipt))throw new LibraryInputError("Noncanonical surface receipt");}
    library.surfaces=portion;const expected=stableStringify(surfaceSelection(library));if(new TextDecoder("utf-8",{fatal:true}).decode(await regularFile(containedPath(root,"surface-selection.json")))!==expected)throw new LibraryInputError("Surface selection drift");
  }
  if (stableStringify(generateSelection(valuePortion(library))) !== stableStringify(selection)) throw new LibraryInputError("Library selection drift");
  return library;
}
async function checkCompositeUnlocked(root: string, catalog: CompositeCatalogData, library: CompositeLibraryData, componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Promise<CompositeCheckResult> {
  const paths = await evidenceFiles(root);
  return checkComposite({ catalog, library, componentOptions, surfaceOptions, fileExists: name => { try { return paths.has(containedPath(root, name)); } catch { return false; } } });
}

async function readUnlocked(root: string, catalog: CatalogData): Promise<LibraryData> {
  await evidenceFiles(root);
  await readNeedsUnlocked(root);
  const parse = async (name: string): Promise<unknown> => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(root, name))));
  const source = await parse("source.json"), metadata = await parse("metadata.json"), selection = await parse("selection.json");
  if (!record(source) || source.kind !== "consumer" || source.author !== "consumer" || typeof source.id !== "string" || typeof source.license !== "string" || !record(metadata) || !exactKeys(metadata, [], ["complete", "baseline", "adoptedAt", "rubricVersion", "strategy", "direction", "rationale"])) throw new LibraryInputError("Invalid library metadata");
  const allowed = new Set(catalog.slots.map(slot => `${slot.id}.json`));
  const entries = await fs.readdir(join(root, "fills"));
  const fills = [];
  for (const name of entries.sort()) {
    if (!allowed.has(name)) throw new LibraryInputError("Unknown library fill filename");
    const parsed = parseFill(await parse(`fills/${name}`));
    if (!parsed.fill || parsed.findings.some(finding => finding.severity === "error") || parsed.fill.$extensions["com.clossys.fill"].slot + ".json" !== name) throw new LibraryInputError("Invalid library fill");
    fills.push(parsed.fill);
  }
  const library = { ...metadata, source, fills, selection } as unknown as LibraryData;
  if (stableStringify(generateSelection(library)) !== stableStringify(selection)) throw new LibraryInputError("Library selection drift");
  return library;
}

export function readLibrary(root: string, catalog: CatalogData): Promise<LibraryData>;
export function readLibrary(root: string, catalog: CompositeCatalogData): Promise<CompositeLibraryData>;
export async function readLibrary(root: string, catalog: CatalogData | CompositeCatalogData): Promise<LibraryData | CompositeLibraryData> {
  return locked<LibraryData | CompositeLibraryData>(root, path => "values" in catalog ? readCompositeUnlocked(path, withSurfaces(catalog)) : readUnlocked(path, catalog));
}

async function checkUnlocked(root: string, catalog: CatalogData, library: LibraryData): Promise<CheckResult> {
  const paths = await evidenceFiles(root);
  return check({ catalog, library, resolved: resolve({ catalog, library }), fileExists: name => {
    try { return paths.has(containedPath(root, name)); } catch { return false; }
  } });
}

export function checkLibrary(root: string, catalog: CatalogData): Promise<CheckResult>;
export function checkLibrary(root: string, catalog: CompositeCatalogData, componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Promise<CompositeCheckResult>;
export async function checkLibrary(root: string, catalog: CatalogData | CompositeCatalogData, componentOptions?: CompositeEngineInput["componentOptions"], surfaceOptions?: SurfaceResolutionOptions): Promise<CompositeCheckResult> {
  return locked(root, async path => {
    if (!("values" in catalog)) return checkUnlocked(path, catalog, await readUnlocked(path, catalog));
    const composite = withSurfaces(catalog), library = await readCompositeUnlocked(path, composite);
    return checkCompositeUnlocked(path, composite, library, componentOptions, await surfaceOptionsFor(composite, surfaceOptions, library.surfaces !== undefined));
  });
}

/** Stage an entire generation. A failed stage is invisible; failed second rename restores the old root. */
async function persistLibrary(root: string, files: ReadonlyMap<string, string>, replaceFills = true, ownership?: { previous: readonly string[]; next: readonly string[] }): Promise<void> {
  const staging = join(dirname(root), `.${basename(root)}-staging`), backup = join(dirname(root), `.${basename(root)}-backup`);
  // Validate the complete map before touching any path, including future emitter outputs.
  for (const name of files.keys()) containedPath(staging, name);
  if(ownership)for(const paths of [ownership.previous,ownership.next]){if(new Set(paths).size!==paths.length)throw new LibraryInputError("Duplicate projection ownership");for(const name of paths)containedPath(staging,name);}
  await evidenceFiles(root);
  let moved = false, committed = false, staged = false;
  try {
    await fs.mkdir(staging); staged = true;
    for (const name of await fs.readdir(root)) await fs.cp(join(root, name), join(staging, name), { recursive: true, errorOnExist: true, force: false });
    // Projection cleanup inside the existing staging generation; transaction order is unchanged.
    if(ownership)for(const name of ownership.previous.filter(name=>!ownership.next.includes(name))){const path=containedPath(staging,name);try{await regularFile(path);await fs.unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
    if (replaceFills) { await fs.rm(join(staging, "fills"), { recursive: true }); await fs.mkdir(join(staging, "fills")); }
    for (const [name, content] of files) {
      const path = containedPath(staging, name);
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path + ".tmp", content, { flag: "wx" }); await fs.rename(path + ".tmp", path);
    }
    await directoryRoot(root);
    await fs.rename(root, backup); moved = true;
    await fs.rename(staging, root); committed = true;
  } catch (error) {
    if (moved && !committed) await fs.rename(backup, root);
    throw error;
  } finally {
    if (!committed && staged) await fs.rm(staging, { recursive: true, force: true });
  }
  // The committed generation stays successful; leftover backup evidence closes subsequent operations.
  await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

/** Explicit changes only. CAS, validation, checking and the swap happen under one shared lock. */
export async function writeLibrary(root: string, catalog: CatalogData, changes: ChangeSet): Promise<LibraryData> {
  const snapshot: unknown = structuredClone(changes);
  if (!isLibraryChangeSet(snapshot, catalog)) throw new LibraryInputError("Invalid library changeset");
  return locked(root, async path => {
    const current = await readUnlocked(path, catalog);
    if (snapshot.baseHash !== libraryHash(current)) throw new LibraryConflictError("Changeset baseHash does not match library");
    const library = applyLibraryChange(catalog, current, snapshot);
    const result = await checkUnlocked(path, catalog, library);
    if (!result.ok) throw new LibraryCheckError(result);
    await persistLibrary(path, libraryFiles(catalog, library));
    return library;
  });
}

/** Composite CAS, validation and persistence reuse the same lock and disk boundary as value writes. */
export async function writeCompositeLibrary(root: string, hostCatalog: CompositeCatalogData, changes: CompositeChangeSet, componentOptions?: CompositeEngineInput["componentOptions"], hostSurfaceOptions?: SurfaceResolutionOptions): Promise<CompositeLibraryData> {
  const snapshot = runtimeSnapshot(changes), catalog = withSurfaces(hostCatalog);
  if(!isCompositeChangeSet(snapshot,catalog))throw new LibraryInputError("Invalid composite changeset");
  return locked(root, async path => {
    const current = await readCompositeUnlocked(path, catalog);
    if (snapshot.baseHash !== compositeLibraryHash(current)) throw new LibraryConflictError("Changeset baseHash does not match library");
    const surfaceOptions = await surfaceOptionsFor(catalog, hostSurfaceOptions, current.surfaces !== undefined || snapshot.changes.some(operation => operation.portion === "surfaces"));
    const library = applyCompositeLibraryChange(catalog, current, snapshot, surfaceOptions?{componentOptions,surfaceOptions}:undefined);
    const result = await checkCompositeUnlocked(path, catalog, library, componentOptions, surfaceOptions);
    if (!result.ok) throw new LibraryCheckError(result);
    const files = libraryFiles(catalog, library, undefined, componentOptions, surfaceOptions);
    if (compositeLibraryHash(library) !== compositeLibraryHash(current)) {
      const projection=current.surfaces!==undefined||library.surfaces!==undefined?await projectionOwnership(path,projectionManagedPaths(catalog,current),files):undefined;
      await persistLibrary(path, files, true, projection);
    }
    return library;
  });
}

export function emitLibrary(root: string, catalog: CatalogData, options?: { check?: boolean; targets?: readonly EmitTarget[] }): Promise<{ ok: boolean; drift: string[] }>;
export function emitLibrary(root: string, catalog: CompositeCatalogData, options?: { check?: boolean; targets?: readonly CompositeEmitTarget[]; componentOptions?: CompositeEngineInput["componentOptions"]; surfaceOptions?: SurfaceResolutionOptions }): Promise<{ ok: boolean; drift: string[] }>;
export async function emitLibrary(root: string, hostCatalog: CatalogData | CompositeCatalogData, hostOptions: { check?: boolean; targets?: readonly CompositeEmitTarget[]; componentOptions?: CompositeEngineInput["componentOptions"]; surfaceOptions?: SurfaceResolutionOptions } = {}): Promise<{ ok: boolean; drift: string[] }> {
  return locked(root, async path => {
    const composite = "values" in hostCatalog, catalog = composite ? withSurfaces(hostCatalog) : hostCatalog;
    const library = composite ? await readCompositeUnlocked(path, catalog as CompositeCatalogData) : await readUnlocked(path, catalog as CatalogData);
    const options = composite ? { ...hostOptions, surfaceOptions: await surfaceOptionsFor(catalog as CompositeCatalogData, hostOptions.surfaceOptions, (library as CompositeLibraryData).surfaces !== undefined) } : hostOptions;
    const result = composite ? await checkCompositeUnlocked(path, catalog as CompositeCatalogData, library as CompositeLibraryData, options.componentOptions, options.surfaceOptions) : await checkUnlocked(path, catalog as CatalogData, library as LibraryData);
    if (!result.ok) throw new LibraryCheckError(result);
    // Legacy value folders keep their existing generated bytes and default targets.
    const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(path, "metadata.json"))));
    const files = composite && metadata.format === "composite-v1"
      ? libraryFiles(catalog as CompositeCatalogData, library as CompositeLibraryData, options.targets, options.componentOptions, options.surfaceOptions)
      : libraryFiles(composite ? (catalog as CompositeCatalogData).values : catalog as CatalogData, composite ? valuePortion(library as CompositeLibraryData) : library as LibraryData, options.targets as readonly EmitTarget[] | undefined);
    const drift: string[] = [];
    for (const [name, contents] of files) {
      try { if (new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(path, name))) !== contents) drift.push(name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") drift.push(name); else throw error; }
    }
    if (options.check) return { ok: drift.length === 0, drift };
    let projection:{previous:string[];next:string[]}|undefined;
    if(composite&&(library as CompositeLibraryData).surfaces!==undefined){const complete=projectionManagedPaths(catalog as CompositeCatalogData,library as CompositeLibraryData);projection=await projectionOwnership(path,complete,new Map([...complete,...files]));}
    await persistLibrary(path, files, true, projection);
    return { ok: true, drift };
  });
}


export const NEED_STATUSES: readonly NeedStatus[] = ["open", "proposed", "approved", "built", "closed"];
const needId = (value: unknown): value is string => typeof value === "string" && /^NEED-(?:00[1-9]|0[1-9]\d|[1-9]\d{2,})$/.test(value) && Number.isSafeInteger(Number(value.slice(5))) && Number(value.slice(5)) < Number.MAX_SAFE_INTEGER;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f]/.test(value);
export function isNeedCandidate(value: unknown): value is NeedCandidate {
  return record(value) && exactKeys(value, ["library", "slotId", "reason"]) && ["shadcn@aria", "starter", "foundry"].includes(String(value.library)) && typeof value.slotId === "string" && /^(components|sections|frames|assets|tokens)\.[a-z][a-z0-9-]*$/.test(value.slotId) && text(value.reason);
}
export function isNeedRecord(value: unknown): value is NeedRecord {
  if (!record(value) || !exactKeys(value, ["id", "raisedBy", "missing", "kind", "status", "candidate", "evidence", "createdBy", "createdAt", "updatedAt", "closedBy"])) return false;
  if (!needId(value.id) || !text(value.raisedBy) || !text(value.missing) || !["slot", "member", "leaf"].includes(String(value.kind)) || !NEED_STATUSES.includes(value.status as NeedStatus) || !["dogfood-check", "skill", "owner"].includes(String(value.createdBy))) return false;
  if (!(value.candidate === null || isNeedCandidate(value.candidate)) || value.status !== "open" && value.candidate === null || !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || !text(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) < Date.parse(value.createdAt as string) || !(value.closedBy === null || text(value.closedBy)) || value.status === "closed" && !text(value.closedBy)) return false;
  return Array.isArray(value.evidence) && value.evidence.length > 0 && value.evidence.every(row => record(row) && exactKeys(row, ["file", "line", "code"], ["benchmark"]) && text(row.file) && Number.isInteger(row.line) && Number(row.line) > 0 && /^DF[1-6]$/.test(String(row.code)) && (row.benchmark === undefined || text(row.benchmark)));
}
async function readNeedsUnlocked(root: string): Promise<NeedRecord[]> {
  const directory = containedPath(root, "needs");
  try { if (!(await fs.lstat(directory)).isDirectory()) throw new LibraryInputError("Needs must be a regular directory"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const needs: NeedRecord[] = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const id = name.replace(/\.json$/, "");
    if (!needId(id) || name !== `${id}.json`) throw new LibraryInputError("Invalid NEED filename");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await regularFile(containedPath(root, `needs/${name}`)))); }
    catch { throw new LibraryInputError("Invalid NEED file"); }
    if (!isNeedRecord(value) || value.id !== id) throw new LibraryInputError("Invalid NEED record");
    if (needs.some(row => row.raisedBy === value.raisedBy && row.missing === value.missing)) throw new LibraryInputError("Duplicate NEED capability");
    needs.push(value);
  }
  return needs;
}
/** Read under the shared transaction lock; no NEED or consumer output is created/changed. */
export async function readNeeds(input: string): Promise<NeedRecord[]> {
  return locked(input, async root => { await evidenceFiles(root); return readNeedsUnlocked(root); });
}
/** Writes only an explicit root, under the existing transaction/containment boundary. */
export async function writeNeeds(input: string, findings: readonly DogfoodFinding[], now = new Date().toISOString()): Promise<NeedRecord[]> {
  return locked(input, async root => {
    await evidenceFiles(root);
    const needs = await readNeedsUnlocked(root), changed = new Map<string, string>();
    let next = Math.max(0, ...needs.map(row => Number(row.id.slice(5)))) + 1;
    for (const finding of findings) {
      if (!["DF1", "DF3", "DF5"].includes(finding.code) || finding.slotId || !finding.missing) continue;
      let need = needs.find(row => row.raisedBy === finding.raisedBy && row.missing === finding.missing);
      if (!need) { need = { id: `NEED-${String(next++).padStart(3, "0")}`, raisedBy: finding.raisedBy, missing: finding.missing, kind: "leaf", status: "open", candidate: null, evidence: [], createdBy: "dogfood-check", createdAt: now, updatedAt: now, closedBy: null }; needs.push(need); }
      const evidence = { file: finding.file, line: finding.line, code: finding.code };
      if (!need.evidence.some(row => row.file === evidence.file && row.line === evidence.line && row.code === evidence.code)) {
        need.evidence.push(evidence); need.updatedAt = now;
        if (!isNeedRecord(need)) throw new LibraryInputError("Invalid NEED evidence");
        changed.set(`needs/${need.id}.json`, stableStringify(need));
      }
    }
    if (changed.size) await persistLibrary(root, changed, false);
    return needs;
  });
}
export async function setNeed(input: string, id: string, change: { status: NeedStatus; candidate?: NeedCandidate; closedBy?: string }, now = new Date().toISOString()): Promise<NeedRecord> {
  if (!needId(id) || !record(change) || !exactKeys(change, ["status"], ["candidate", "closedBy"]) || !NEED_STATUSES.includes(change.status) || change.candidate !== undefined && !isNeedCandidate(change.candidate)) throw new LibraryInputError("Invalid NEED update");
  return locked(input, async root => {
    await evidenceFiles(root); const needs = await readNeedsUnlocked(root), need = needs.find(row => row.id === id);
    if (!need) throw new LibraryInputError("NEED does not exist");
    const before = NEED_STATUSES.indexOf(need.status), after = NEED_STATUSES.indexOf(change.status);
    if (after < before || after > before + 1) throw new LibraryInputError("NEED status must move one step forward");
    const updated = { ...need, ...change, updatedAt: now };
    if (!isNeedRecord(updated)) throw new LibraryInputError("Invalid NEED update: candidate or closure evidence required");
    await persistLibrary(root, new Map([[`needs/${id}.json`, stableStringify(updated)]]), false); return updated;
  });
}
/** Closed composite dispatch; existing value/component validators retain their contracts. */
export function isCompositeChangeSet(value:unknown,hostCatalog:CompositeCatalogData):value is CompositeChangeSet {
  const catalog=withSurfaces(hostCatalog);
  try{value=runtimeSnapshot(value);}catch{return false;}
  if(!record(value)||!exactKeys(value,["baseHash","changes"],["bundles","surfaceBundles"])||typeof value.baseHash!=="string"||!/^sha256:[a-f0-9]{64}$/.test(value.baseHash)||!Array.isArray(value.changes)||value.changes.length>256||value.bundles!==undefined&&!Array.isArray(value.bundles)||value.surfaceBundles!==undefined&&!Array.isArray(value.surfaceBundles))return false;
  return value.changes.every(operation=>{
    if(!record(operation)||!exactKeys(operation,["portion","change"])||!record(operation.change))return false;const change=operation.change;
    if(operation.portion==="values")return isLibraryChangeSet({baseHash:"fnv1a64:"+"0".repeat(16),changes:[change]},catalog.values);
    if(operation.portion!=="components"&&operation.portion!=="surfaces"||typeof change.slot!=="string")return false;
    if(!(operation.portion==="components"?catalog.components.slots:catalog.surfaces?.slots??[]).some(slot=>slot.id===change.slot))return false;
    switch(change.op){case "remove":return exactKeys(change,["op","slot"]);case "adopt":return exactKeys(change,["op","slot","source"],operation.portion==="components"?["members"]:[])&&typeof change.source==="string";case "author":return exactKeys(change,["op","slot","fill","files"],operation.portion==="surfaces"?["note"]:[])&&record(change.fill)&&Array.isArray(change.files);case "derive":return exactKeys(change,["op","slot","rule","inputs"])&&typeof change.rule==="string"&&Array.isArray(change.inputs);case "compose":return operation.portion==="components"&&exactKeys(change,["op","slot","rule"])&&typeof change.rule==="string";default:return false;}
  });
}
/** Path ownership only, recomputed from the reader's validated metadata and exact fill receipts.
 * These are the finite existing default-target paths. This never emits a blocked old module.
 * Only the checked next-generation map supplies persisted generated bytes.
 */
function projectionManagedPaths(catalog:CompositeCatalogData,library:CompositeLibraryData):Map<string,string>{
  const paths=new Set(libraryFiles(catalog.values,valuePortion(library)).keys());
  for(const doc of library.components.fills){const fill=componentOf(doc);paths.add(`fills/${fill.slot}.json`);paths.add(`components/${fill.slot.slice(11)}/index.ts`);}
  for(const file of library.components.files)paths.add(file.path);
  for(const path of ["component-index.ts","components-consumption.json","notices/components.json"])paths.add(path);
  if(library.components.fills.some(doc=>componentOf(doc).reads.assets.length))paths.add("adapters/glyphs.ts");
  if(library.surfaces!==undefined){const portion=canonicalSurfacePortion(library.surfaces);for(const doc of portion.fills){const fill=surfaceEntryOf(doc);ownedSurfacePaths(fill,portion.files);paths.add(`fills/${fill.slot}.json`);paths.add(fill.slot.replace(".","/")+"/index.ts");}for(const file of portion.files)paths.add(file.path);for(const path of ["surface-index.ts","surface-selection.json","surfaces-consumption.json","notices/surfaces.json"])paths.add(path);}
  return new Map([...paths].map(path=>[path,""]));
}
/** Finite projection ownership. Host files never become cleanup candidates. */
async function projectionOwnership(root:string,previousFiles:ReadonlyMap<string,string>,nextFiles:ReadonlyMap<string,string>):Promise<{previous:string[];next:string[]}>{
  const previous=[...previousFiles.keys()],next=[...nextFiles.keys()];
  for(const paths of [previous,next]){if(new Set(paths).size!==paths.length)throw new LibraryInputError("Duplicate projection ownership");for(const name of paths)containedPath(root,name);}
  const present=await evidenceFiles(root);for(const name of next)if(!previousFiles.has(name)){const path=containedPath(root,name);let exists=false;try{await fs.lstat(path);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT"&&(error as NodeJS.ErrnoException).code!=="ENOTDIR")throw error;}if(exists||[...present].some(file=>path.startsWith(file+sep)))throw new LibraryInputError("Managed surface output collides with unowned host file");}
  return {previous,next};
}
