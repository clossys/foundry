/** Read-only source assembly. Parsing and installed-package resolution belong to the host. */
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve, posix } from "node:path";
import { readActive, validateGenericTree } from "@clossys/strategist/cell-format";
import { generateSelection } from "../catalog-core/library.js";
import { assertComponentDescriptor, assertComponentFiles, componentDescriptorHash, componentOf, verifyComponentOutput, type ComponentFile, type ComponentDocument } from "../catalog-core/resolve-components.js";
import type { CatalogData, CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, LibraryData, Source } from "../catalog-core/types.js";
import { parseLibraryCell } from "../library-cli/cells.js";
import { libraryFiles } from "../library-cli/fs-library.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";

export interface SourceModule {
  path: string;
  content: string;
  ownerSlot?: string;
  /** Actual host-read source copied outside the library's receipt-owned paths. */
  origin?: "installed" | "consumer";
}
/** Half-open offsets include the complete quoted module literal, as reported by an AST. */
export interface SourceImport { specifier: string; start: number; end: number; names?: readonly string[] }
export interface SourceRequest {
  specifier: string;
  importer: SourceModule | undefined;
  names: readonly string[];
  /** Validated, selected, receipt-owned library files; never an upstream catalog. */
  files: ReadonlyMap<string, string>;
}
export type SourceResolution =
  | { kind: "source"; module: SourceModule }
  | { kind: "dependency"; name: string; version: string }
  | { kind: "builtin" };
export interface SourceClosureOptions {
  library: CompositeLibraryData;
  slots?: readonly string[];
  additionalEntries?: readonly SourceModule[];
  analyze: (source: SourceModule) => readonly SourceImport[];
  /** Must read actual local/installed source. Named barrels must be narrowed by the host. */
  resolve: (request: SourceRequest) => SourceResolution;
  /** Runs after import rewriting; for example, an AST printer can remove provenance comments. */
  transformSource?: (content: string, source: SourceModule) => string;
}
export interface SourceClosure {
  entries: { slot: string; export: string; path: string }[];
  files: ComponentFile[];
  dependencies: Record<string, string>;
}
function sourcePath(path: string): void {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || /[\\\u0000-\u001f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Source path must be relative and contained");
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Traverse actual source bytes without fetching, evaluating modules, or writing files.
 * The injected AST analyzer and resolver are the trusted syntax/package boundary. A
 * resolver must fail on absent sources and preserve manifest dependency ranges.
 */
export function collectSourceClosure(options: SourceClosureOptions): SourceClosure {
  const { library } = options;
  assertComponentFiles(library.components.files);
  const fills = new Map<string, ReturnType<typeof componentOf>>();
  for (const document of library.components.fills) {
    const fill = componentOf(document);
    if (fills.has(fill.slot)) throw new Error("Duplicate selected component");
    if (fill.source !== library.source.id) throw new Error("Selected component belongs to another library");
    assertComponentDescriptor(fill);
    const origin = (fill as ComponentDocument["components"][string]).origin;
    if (!origin || origin.kind === "adopted" && componentDescriptorHash(fill) !== origin.sha256) throw new Error("Selected component descriptor hash differs");
    if (fill.impl.kind === "source") verifyComponentOutput(fill, library.components.files);
    fills.set(fill.slot, fill);
  }
  const selected = new Set(options.slots ?? fills.keys());
  for (const slot of selected) if (!fills.has(slot)) throw new Error(`Missing selected component ${slot}`);
  for (const slot of selected) {
    const fill = fills.get(slot)!;
    for (const read of [...fill.reads.components, ...fill.composes]) if (!selected.has(read)) throw new Error(`Component dependency is outside selected library: ${read}`);
  }
  const owned = new Set([...selected].flatMap(slot => {
    const fill = fills.get(slot)!;
    return fill.impl.kind === "source" ? fill.outputSha256?.map(file => file.path) ?? [] : [];
  }));
  const files = new Map(library.components.files.filter(file => owned.has(file.path)).map(file => [file.path, file.content]));
  const modules = new Map<string, SourceModule>(), output = new Map<string, string>(), dependencies = new Map<string, string>();
  const assertSelected = (module: SourceModule) => {
    sourcePath(module.path);
    // Consumer-owned component paths use leaf folders. Installed package utility
    // folders have different layouts and use explicit ownerSlot when applicable.
    const leaf = module.origin === undefined ? /^components\/([a-z][a-z0-9-]*)\//.exec(module.path)?.[1] : undefined;
    if (module.ownerSlot !== undefined && !selected.has(module.ownerSlot) || leaf !== undefined && !selected.has(`components.${leaf}`)) throw new Error("Source component is outside selected library");
    if (module.origin === undefined && /^(?:components|adapters)\//.test(module.path) && !files.has(module.path)) throw new Error("Selected library source is not receipted");
    if (files.has(module.path) && files.get(module.path) !== module.content) throw new Error("Source differs from selected library bytes");
  };
  const dependency = (resolution: Extract<SourceResolution, { kind: "dependency" }>) => {
    if (!/^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(resolution.name) || resolution.name.includes("@clossys")) throw new Error("Firstparty packages must resolve to source");
    if (!resolution.version.trim() || /^(?:https?:|git|file:|link:|workspace:|catalog:)/i.test(resolution.version)) throw new Error("Dependency must preserve a manifest version range");
    const previous = dependencies.get(resolution.name);
    if (previous !== undefined && previous !== resolution.version) throw new Error(`Dependency range conflict for ${resolution.name}`);
    dependencies.set(resolution.name, resolution.version);
  };
  const visit = (module: SourceModule): void => {
    assertSelected(module);
    const previous = modules.get(module.path);
    if (previous) {
      if (previous.content !== module.content) throw new Error("Conflicting source bytes for one output path");
      return;
    }
    modules.set(module.path, module);
    const imports = [...options.analyze(module)].sort((a, b) => a.start - b.start);
    let last = 0;
    const edits: { start: number; end: number; text: string }[] = [];
    for (const imported of imports) {
      const literal = module.content.slice(imported.start, imported.end);
      if (!Number.isSafeInteger(imported.start) || !Number.isSafeInteger(imported.end) || imported.start < last || imported.end <= imported.start || imported.end > module.content.length || !["'", '"', "`"].includes(literal[0] ?? "") || literal.at(-1) !== literal[0]) throw new Error("Invalid or overlapping source import offsets");
      last = imported.end;
      const resolution = options.resolve({ specifier: imported.specifier, importer: module, names: imported.names ?? [], files });
      if (resolution.kind === "source") {
        visit(resolution.module);
        const relative = posix.relative(posix.dirname(module.path), resolution.module.path);
        edits.push({ start: imported.start, end: imported.end, text: JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`) });
      } else if (resolution.kind === "dependency") dependency(resolution);
      else if (resolution.kind !== "builtin") throw new Error("Unresolved source import");
    }
    let content = module.content;
    for (const edit of edits.reverse()) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    content = options.transformSource?.(content, module) ?? content;
    if (content.includes("@clossys")) throw new Error("Unresolved firstparty text remains in emitted source");
    output.set(module.path, content);
  };
  const entries: SourceClosure["entries"] = [];
  for (const slot of [...selected].sort(compare)) {
    const fill = fills.get(slot)!;
    if (fill.impl.kind === "composed") throw new Error("Selected component has no materialized source");
    const names = [fill.impl.export, ...(fill.secondaryExports?.map(item => item.export) ?? [])];
    let module: SourceModule;
    if (fill.impl.kind === "source") {
      const content = files.get(fill.impl.entry);
      if (content === undefined) throw new Error("Selected component source is missing");
      module = { path: fill.impl.entry, content, ownerSlot: slot };
    } else {
      const resolution = options.resolve({ specifier: fill.impl.module, importer: undefined, names, files });
      if (resolution.kind !== "source") throw new Error("Selected component requires actual source");
      module = { ...resolution.module, ownerSlot: resolution.module.ownerSlot ?? slot };
    }
    visit(module);
    for (const name of names) entries.push({ slot, export: name, path: module.path });
  }
  for (const module of options.additionalEntries ?? []) visit(module);
  return { entries, files: [...output].sort(([a], [b]) => compare(a, b)).map(([path, content]) => ({ path, content })), dependencies: Object.fromEntries([...dependencies].sort(([a], [b]) => compare(a, b))) };
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
/** Open a regular file only after checking every existing ancestor for aliases. */
async function readCellTree(root: string): Promise<string> {
  const path = join(resolve(root), "tree.json");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error("Symbolic links are not followed");
    if (dirname(cursor) === cursor) break;
  }
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error("Expected regular cell tree");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
type SourceLibraryOptions = Pick<CompositeEngineInput, "componentOptions" | "surfaceOptions">;
export function readActiveSourceLibrary(root: string, catalog: CatalogData): Promise<LibraryData>;
export function readActiveSourceLibrary(root: string, catalog: CompositeCatalogData, options?: SourceLibraryOptions): Promise<CompositeLibraryData>;
/** Reconstruct active cell data and run existing validators entirely in memory. */
export async function readActiveSourceLibrary(root: string, catalog: CatalogData | CompositeCatalogData, options: SourceLibraryOptions = {}): Promise<LibraryData | CompositeLibraryData> {
  const treeSource = await readCellTree(root), active = await readActive(root);
  const ids = (await fs.readdir(join(root, "cells"))).sort();
  const parsed = validateGenericTree(JSON.parse(treeSource), { cellIds: ids, maxDepth: 2 });
  if (!parsed.ok) throw new Error(parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  const tree = parsed.value;
  if (!object(tree.meta?.source) || !object(tree.meta?.metadata)) throw new Error("Expected Designer source and metadata in tree.meta");
  if (tree.meta.source.kind !== "consumer" || tree.meta.source.author !== "consumer" || typeof tree.meta.source.id !== "string" || typeof tree.meta.source.license !== "string") throw new Error("Invalid Designer consumer source");
  const source = structuredClone(tree.meta.source) as Source;
  const metadata = structuredClone(tree.meta.metadata), composite = metadata.format === "composite-v1";
  // Match the existing projection reader's fill-filename ordering, including
  // adjacent ids where one leaf name is a prefix of another.
  const cells = active.map(cell => parseLibraryCell(cell.source, cell.path)).sort((a, b) => compare(`${a.id}.json`, `${b.id}.json`));
  const valueMetadata = composite ? metadata.values : metadata;
  if (!object(valueMetadata)) throw new Error("Invalid Designer metadata");
  const rationale = { ...(valueMetadata.rationale ?? {}) };
  for (const id of ids) delete rationale[id];
  for (const cell of cells) if (cell.rationale !== null) rationale[cell.id] = cell.rationale;
  if (Object.keys(rationale).length || valueMetadata.rationale !== undefined) valueMetadata.rationale = rationale;
  const values = { ...valueMetadata, source, fills: cells.filter(cell => /^(tokens|assets)\./.test(cell.id)).map(cell => cell.fill) } as unknown as LibraryData;
  values.selection = generateSelection(values);
  let library: LibraryData | CompositeLibraryData = values;
  if (composite) {
    if (!("values" in catalog) || !object(metadata.components)) throw new Error("Composite cells require a composite catalog and metadata");
    const owned = object(tree.meta.files) ? tree.meta.files : {};
    const files = (paths: unknown): ComponentFile[] => {
      if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || typeof owned[path] !== "string")) throw new Error("Missing owned file content in tree.meta.files");
      return paths.map(path => ({ path, content: owned[path] as string }));
    };
    const { source: _source, ...valuePortion } = values;
    library = { source, ...(metadata.adoptedAt === undefined ? {} : { adoptedAt: metadata.adoptedAt }), values: valuePortion, components: { ...metadata.components, fills: cells.filter(cell => cell.id.startsWith("components.")).map(cell => cell.fill), files: files(metadata.files) }, ...(metadata.surfaces ? { surfaces: { version: 1, fills: cells.filter(cell => /^(sections|frames)\./.test(cell.id)).map(cell => cell.fill), files: files(metadata.surfaces.files) } } : {}) } as unknown as CompositeLibraryData;
    const stored = tree.meta.componentOptions;
    if (stored !== undefined && (!object(stored) || Object.keys(stored).some(key => key !== "packageExports") || !object(stored.packageExports) || Object.values(stored.packageExports).some(names => !Array.isArray(names) || names.some(name => typeof name !== "string")))) throw new Error("Invalid stored component package exports");
    const componentOptions = options.componentOptions ?? stored;
    const surfaceOptions = options.surfaceOptions ?? (library.surfaces ? { packages: await readSurfacePackageEvidence(catalog.surfaces?.fills ?? []), measurements: [] } : undefined);
    libraryFiles(catalog, library, [], componentOptions, surfaceOptions);
  } else {
    if ("values" in catalog) throw new Error("Value cells require a value catalog");
    libraryFiles(catalog, values, []);
  }
  if (await readCellTree(root) !== treeSource) throw new Error("Active cell tree changed while reading");
  return library;
}
