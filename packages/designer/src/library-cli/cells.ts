/** Designer's cell profile. The shared store owns version paths and activation. */
import * as fs from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { constants } from "node:fs";
import { activate, cellPath, isoDate, parseConfirmRef, parseDocument, parseLinkRef, positiveInteger, propose, readActive, serializeScalar, strings, tokenizeBody, validateGenericTree, type GenericTree } from "@clossys/strategist/cell-format";
import { generateSelection, loadCatalog, stableStringify, type CatalogData, type CompositeCatalogData, type CompositeEngineInput, type CompositeLibraryData, type LibraryData } from "../catalog-core/index.js";
import { loadNativeCompositeCatalog } from "./native-catalog.js";
import { componentOf, type ComponentDocument } from "../catalog-core/resolve-components.js";
import { surfaceEntryOf, surfaceSelection } from "../catalog-core/surface-library.js";
import type { SurfaceDocument, SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import { libraryFiles, readLibrary } from "./fs-library.js";
import { readSurfacePackageEvidence } from "./surface-package-evidence.js";
import { verifySurfacePackageInputs } from "./surface-pin-context.js";

const SLOT = /^(themes|assets|components|sections|frames)\.[a-z][a-z0-9-]*$(?![\s\S])/;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
type Catalog = CatalogData | CompositeCatalogData;
type Options = { catalog?: Catalog; check?: boolean; date?: string; componentOptions?: CompositeEngineInput["componentOptions"]; surfaceOptions?: SurfaceResolutionOptions };
export interface LibraryCell { id: string; version: number; fill: Record<string, any>; rationale: string | null; originKinds: string[]; sources: string[] }
function fail(path: string, line: number, message: string): never { throw new Error(`${path}:${line}: ${message}`); }
function fillSlot(fill: Record<string, any>, id: string): string | undefined {
  if (id.startsWith("components.")) return componentOf(fill as ComponentDocument).slot;
  if (/^(sections|frames)\./.test(id)) return surfaceEntryOf(fill as SurfaceDocument).slot;
  return fill.$extensions?.["com.clossys.fill"]?.slot;
}

/** Closed frontmatter and ordered body validation, with source locations. */
export function parseLibraryCell(source: string, path: string): LibraryCell {
  const parsed = parseDocument(source);
  if (!parsed.ok) fail(path, parsed.issues[0]!.line, parsed.issues[0]!.message);
  const { fields: f, fieldLines } = parsed.value;
  const allowed = ["id", "version", "status", "updated", "links", "confirmed", "note", "originKinds", "sources"];
  for (const key of Object.keys(f)) if (!allowed.includes(key)) fail(path, fieldLines[key]!, `Unknown key ${key}`);
  if (typeof f.id !== "string" || !SLOT.test(f.id) || !positiveInteger(f.version)) fail(path, 2, "Expected a Designer slot id and positive version");
  if (path.replaceAll("\\", "/") !== cellPath(f.id, f.version)) fail(path, 2, "Cell id/version disagrees with path");
  if (!["draft", "active", "retired"].includes(String(f.status)) || !isoDate(f.updated)) fail(path, 2, "Invalid status or updated date");
  if (!strings(f.links) || f.links.some(link => !parseLinkRef(link))) fail(path, fieldLines.links ?? 2, "Invalid links");
  if (f.status === "active" || f.confirmed !== undefined) {
    const confirm = typeof f.confirmed === "string" ? parseConfirmRef(f.confirmed) : undefined;
    if (!confirm || confirm.kind === "migration" && f.version !== 1) fail(path, fieldLines.confirmed ?? 2, "Invalid confirmation; migration requires version 1");
  }
  if (f.note !== undefined && typeof f.note !== "string") fail(path, fieldLines.note!, "Expected a note string");
  if (!strings(f.originKinds) || f.originKinds.some(kind => !["adopted", "authored", "derived", "composed"].includes(kind)) || !strings(f.sources)) fail(path, 2, "Expected originKinds and sources lists");
  const body = tokenizeBody(parsed.value.body);
  if (!body.ok) fail(path, body.issues[0]!.line, body.issues[0]!.message);
  let section = 0; const rationale: string[] = []; let fill: Record<string, any> | undefined;
  for (const token of body.value) {
    if (token.type === "raw" && token.text === "") continue;
    if (token.type === "heading" && token.depth === 2 && token.text === (section === 0 ? "Rationale" : section === 1 ? "Fill" : "")) { section++; continue; }
    if (section === 1 && token.type === "bullet") { rationale.push(token.text.slice(2)); continue; }
    if (section === 2 && token.type === "json" && !fill && object(token.value)) { fill = token.value; continue; }
    fail(path, token.line, "Expected Rationale bullets followed by exactly one Fill JSON block");
  }
  if (section !== 2 || !fill) fail(path, 1, "Expected Rationale and Fill sections");
  if (fillSlot(fill, f.id) !== f.id) fail(path, 1, "Fill slot disagrees with cell id");
  return { id: f.id, version: f.version, fill, rationale: rationale.length ? rationale.join("\n") : null, originKinds: f.originKinds, sources: f.sources };
}

/** Refuse aliases and special files on both source and output boundaries. */
async function safe(root: string, name = ""): Promise<string> {
  const base = resolve(root), target = resolve(base, name), rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) || name.includes("\\")) throw new Error("Cell output path escapes root");
  let cursor = target;
  for (;;) {
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error("Symbolic links are not followed"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return target;
}
async function text(root: string, name: string): Promise<string> {
  const handle = await fs.open(await safe(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new Error("Expected regular library file"); return await handle.readFile("utf8"); }
  finally { await handle.close(); }
}
async function readJson(root: string, name: string): Promise<any> { return JSON.parse(await text(root, name)); }
function defaultCatalog(composite: boolean): Catalog {
  const values = loadCatalog();
  return composite ? loadNativeCompositeCatalog(values) : values;
}
function valueLibrary(library: LibraryData | CompositeLibraryData): LibraryData {
  return "values" in library ? { ...library.values, source: library.source, ...(library.adoptedAt === undefined ? {} : { adoptedAt: library.adoptedAt }) } : library;
}

/** One-time migration. Existing destinations are refused rather than overwritten. */
export async function libraryToCells(libraryDir: string, cellRoot: string, options: Options = {}): Promise<void> {
  await safe(libraryDir); await safe(cellRoot);
  const metadata = await readJson(libraryDir, "metadata.json"), source = await readJson(libraryDir, "source.json");
  const composite = metadata.format === "composite-v1", catalog = options.catalog ?? defaultCatalog(composite);
  const library = await readLibrary(libraryDir, catalog as CompositeCatalogData) as LibraryData | CompositeLibraryData;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!isoDate(date)) throw new Error("Expected migration date YYYY-MM-DD");
  const values = valueLibrary(library), selection = generateSelection(values);
  const fills: Array<LibraryCell["fill"]> = [...values.fills];
  const ownedFiles = new Map<string, string>();
  if ("values" in library) {
    fills.push(...library.components.fills, ...(library.surfaces?.fills ?? []));
    for (const file of [...library.components.files, ...(library.surfaces?.files ?? [])]) ownedFiles.set(file.path, file.content);
  }
  const active = new Map<string, number>();
  const documents = new Map<string, string>();
  for (const fill of fills) {
    const id = fill.$extensions?.["com.clossys.fill"]?.slot ?? componentSlot(fill);
    if (typeof id !== "string" || !SLOT.test(id) || active.has(id)) throw new Error("Invalid or duplicate Designer fill slot");
    active.set(id, 1);
    const pick = selection.slots.find(pick => pick.slot === id);
    const rationale = pick?.rationale ?? null;
    if (rationale !== null && typeof rationale !== "string") throw new Error("Designer cell rationale must be a string or null");
    if (rationale !== null && (rationale.split("\n").some(line => !line.trim()))) throw new Error("Rationale requires nonempty bullet lines");
    const doc = `---\nid: ${id}\nversion: 1\nstatus: active\nupdated: ${date}\nlinks: []\nconfirmed: migration:${date}\noriginKinds: [${(pick?.originKinds ?? []).map(serializeScalar).join(", ")}]\nsources: [${(pick?.sources ?? []).map(serializeScalar).join(", ")}]\n---\n\n## Rationale\n${rationale === null ? "" : rationale.split("\n").map(line => `- ${line}\n`).join("")}\n## Fill\n\n\`\`\`json\n${json(fill)}\`\`\`\n`;
    parseLibraryCell(doc, cellPath(id, 1)); documents.set(cellPath(id, 1), doc);
  }
  let componentOptions = options.componentOptions === undefined ? undefined : { packageExports: options.componentOptions.packageExports ?? {} };
  if (componentOptions === undefined) {
    try { componentOptions = await readJson(libraryDir, "component-observations.json"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  if (componentOptions !== undefined) validateComponentOptions(componentOptions);
  const meta = { source, metadata, ...(componentOptions === undefined ? {} : { componentOptions }), ...(ownedFiles.size ? { files: Object.fromEntries(ownedFiles) } : {}), ...("values" in library && library.surfaces ? { surfaceSelection: surfaceSelection(library) } : {}) };
  const destination = await safe(cellRoot); await fs.mkdir(dirname(destination), { recursive: true }); await fs.mkdir(destination);
  try {
    for (const [path, content] of documents) { await fs.mkdir(dirname(join(destination, path)), { recursive: true }); await fs.writeFile(join(destination, path), content, { flag: "wx" }); }
    await fs.writeFile(join(destination, "tree.json"), json({ schemaVersion: 1, active: Object.fromEntries(active), retired: [], meta }), { flag: "wx" });
    await fs.writeFile(join(destination, "compile.json"), json({ schemaVersion: 1 }), { flag: "wx" });
  } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
}
function componentSlot(fill: Record<string, any>): string | undefined {
  try { return componentOf(fill as ComponentDocument).slot; } catch { /* Surface documents use a different extension. */ }
  try { return surfaceEntryOf(fill as SurfaceDocument).slot; } catch { return undefined; }
}
function validateComponentOptions(value: unknown): asserts value is NonNullable<CompositeEngineInput["componentOptions"]> {
  if (!object(value) || Object.keys(value).some(key => key !== "packageExports") || !object(value.packageExports) || Object.values(value.packageExports).some(names => !strings(names))) throw new Error("Expected component observations { packageExports: { <module>: string[] } }");
}

async function projection(root: string, options: Options): Promise<Map<string, string>> {
  const active = await readActive(root);
  const ids = (await fs.readdir(await safe(root, "cells"))).sort();
  const rawTree = await readJson(root, "tree.json"), parsed = validateGenericTree(rawTree, { cellIds: ids, maxDepth: 2 });
  if (!parsed.ok) throw new Error(parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  const tree: GenericTree = parsed.value;
  if (!object(tree.meta?.source) || !object(tree.meta?.metadata)) throw new Error("Expected Designer source and metadata in tree.meta");
  const metadata = structuredClone(tree.meta.metadata), composite = metadata.format === "composite-v1";
  const cells = active.map(cell => parseLibraryCell(cell.source, cell.path));
  const valueMetadata = composite ? metadata.values : metadata;
  if (!object(valueMetadata)) throw new Error("Invalid Designer metadata");
  const rationale = { ...(valueMetadata.rationale ?? {}) };
  for (const id of ids) delete rationale[id];
  for (const cell of cells) if (cell.rationale !== null) rationale[cell.id] = cell.rationale;
  if (Object.keys(rationale).length || valueMetadata.rationale !== undefined) valueMetadata.rationale = rationale;
  const values = { ...valueMetadata, source: tree.meta.source, fills: cells.filter(cell => /^(themes|assets)\./.test(cell.id)).map(cell => cell.fill) } as unknown as LibraryData;
  values.selection = generateSelection(values);
  const catalog = options.catalog ?? defaultCatalog(composite);
  // Compilation projects authored data and the existing index. Runtime code emission
  // remains the checked emit command and requires its own observed evidence.
  if (!composite) return libraryFiles(catalog as CatalogData, values, []);
  if (!("values" in catalog)) throw new Error("Composite cells require a composite catalog");
  const owned = new Map<string, unknown>(Object.entries(object(tree.meta.files) ? tree.meta.files : {}));
  const files = (paths: unknown): { path: string; content: string }[] => {
    if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || typeof owned.get(path) !== "string")) throw new Error("Missing owned file content in tree.meta.files");
    return paths.map(path => ({ path, content: owned.get(path) as string }));
  };
  const library = { source: tree.meta.source, ...(metadata.adoptedAt === undefined ? {} : { adoptedAt: metadata.adoptedAt }), values: { ...values }, components: { ...metadata.components, fills: cells.filter(cell => cell.id.startsWith("components.")).map(cell => cell.fill), files: files(metadata.files) }, ...(metadata.surfaces ? { surfaces: { version: 1, fills: cells.filter(cell => /^(sections|frames)\./.test(cell.id)).map(cell => cell.fill), files: files(metadata.surfaces.files) } } : {}) } as unknown as CompositeLibraryData;
  delete (library.values as unknown as Record<string, unknown>).source;
  if (library.surfaces) verifySurfacePackageInputs(catalog, library.surfaces.fills, slot => join(resolve(root), active.find(cell => cell.id === slot)!.path));
  const storedOptions = tree.meta.componentOptions;
  if (storedOptions !== undefined) validateComponentOptions(storedOptions);
  const componentOptions = options.componentOptions ?? storedOptions;
  const surfaceOptions = options.surfaceOptions ?? (library.surfaces ? { packages: await readSurfacePackageEvidence(catalog.surfaces?.fills ?? []), measurements: [] } : undefined);
  const result = libraryFiles(catalog, library, [], componentOptions, surfaceOptions);
  if (tree.meta.componentOptions !== undefined) result.set("component-observations.json", json(tree.meta.componentOptions));
  return result;
}

/** Compile active pointers only. Check is read-only and compares JSON by content. */
export async function compileLibraryCells(cellRoot: string, libraryDir: string, options: Options = {}): Promise<{ ok: boolean; drift: string[] }> {
  await safe(cellRoot); await safe(libraryDir);
  const files = await projection(cellRoot, options), drift: string[] = [];
  // Checked runtime resolutions are generated by emit, after observations exist.
  files.delete("resolved.json");
  let existing: string[] = [];
  try { existing = await fs.readdir(await safe(libraryDir, "fills")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const obsolete = existing.filter(name => SLOT.test(name.replace(/\.json$/, "")) && name.endsWith(".json") && !files.has(`fills/${name}`));
  for (const [path, content] of files) {
    await safe(libraryDir, path);
    try {
      const actual = await text(libraryDir, path);
      if (path.endsWith(".json") ? stableStringify(JSON.parse(actual)) !== stableStringify(JSON.parse(content)) : actual !== content) drift.push(path);
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) drift.push(path); else throw e; }
  }
  drift.push(...obsolete.map(name => `fills/${name}`));
  if (options.check) return { ok: !drift.length, drift };
  await fs.mkdir(await safe(libraryDir, "fills"), { recursive: true });
  for (const [path, content] of files) {
    const target = await safe(libraryDir, path); await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  for (const name of obsolete) await fs.unlink(await safe(libraryDir, `fills/${name}`));
  return { ok: true, drift: [] };
}

/** Shared verbs for both the installed CLI and the repository convenience script. */
export async function resolveDesignerCellRoot(explicit?: string, cwd = process.cwd()): Promise<string> {
  if (explicit !== undefined) return resolve(cwd, explicit);
  let cursor = resolve(cwd);
  for (;;) {
    try { await fs.lstat(join(cursor, ".git")); return join(cursor, "clossys", "agents", "designer"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const parent = dirname(cursor); if (parent === cursor) return join(resolve(cwd), "clossys", "agents", "designer"); cursor = parent;
  }
}
export async function runCellsCli(argv: string[], io = { out: (s: string) => console.log(s), error: (s: string) => console.error(s) }, cwd = process.cwd()): Promise<number> {
  try {
    const [verb, ...args] = argv, values = new Map<string, string>(), positional: string[] = []; let check = verb === "check";
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--check") { check = true; continue; }
      if (["--root", "--out", "--from", "--to", "--confirm"].includes(arg)) {
        if (values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Invalid ${arg}`);
        values.set(arg, args[++i]!);
      } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`); else positional.push(arg);
    }
    const allowed = new Map<string, string[]>([["migrate", ["--from", "--to", "--root"]], ["compile", ["--root", "--out"]], ["check", ["--root", "--out"]], ["propose", ["--root"]], ["activate", ["--root", "--confirm"]]]);
    if (!verb || !allowed.has(verb) || [...values.keys()].some(key => !allowed.get(verb)!.includes(key)) || check && !["compile", "check"].includes(verb)) throw new Error("Invalid cells verb or option");
    if (values.has("--to") && values.has("--root")) throw new Error("Use one migration target: --to or --root");
    if (verb === "migrate") {
      if (!values.get("--from") || positional.length || check) throw new Error("migrate --from <library> [--to <cell-root>]");
      await libraryToCells(resolve(cwd, values.get("--from")!), await resolveDesignerCellRoot(values.get("--to") ?? values.get("--root"), cwd));
    } else {
      const root = await resolveDesignerCellRoot(values.get("--root"), cwd);
      if (verb === "compile" || verb === "check") {
        if (!values.get("--out") || positional.length) throw new Error("compile --root <cells> --out <library> [--check]");
        const result = await compileLibraryCells(root, resolve(cwd, values.get("--out")!), { check });
        if (!result.ok) { io.error(`Cell compile drift: ${result.drift.join(", ")}`); return 1; }
      } else if (verb === "propose" && positional.length === 1) {
        const current = await readActive(root, positional[0]!); if (!current) throw new Error("No active Designer cell"); parseLibraryCell(current.source, current.path);
        const cell = await propose(root, positional[0]!); io.out(cell.path);
      }
      else if (verb === "activate" && positional.length && values.get("--confirm")) {
        await activate(root, positional, { confirm: values.get("--confirm")!, beforeActivate: context => { for (const cell of context.cells) parseLibraryCell(cell.source, cell.path); } });
      } else throw new Error("Expected cells compile|check|migrate|propose|activate");
    }
    return 0;
  } catch (error) { io.error(error instanceof Error ? error.message : String(error)); return 2; }
}
