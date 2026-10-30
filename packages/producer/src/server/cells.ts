import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_PACKAGES, resolveAgent, type AgentKind } from "../agents.js";
import type { AgentCells, CellSummary } from "./contract.js";
import type { StudioReportSink } from './studio-render-policy.js';

export const AGENT_KINDS = Object.keys(AGENT_PACKAGES) as AgentKind[];
export const CELL_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$(?![\s\S])/;
interface StoredCell extends Omit<CellSummary, "fields"> { source: string; document: { fields: Record<string, unknown> } }
const modules = new Map<string, Promise<any>>();
/** Resolve through the scaffold mapping, then load the package's shipped Node API. */
export function agentModule(agent: AgentKind, relativeFile: string): Promise<any> {
  const selected = resolveAgent(agent);
  const url = pathToFileURL(join(selected.packageRoot, "dist", relativeFile)).href;
  let loaded = modules.get(url);
  if (!loaded) { loaded = import(url); modules.set(url, loaded); }
  return loaded;
}

export function agentRoot(root: string, agent: AgentKind): string { return join(root, "clossys", "agents", agent); }

/** Missing roots are readable state; aliases and malformed roots fail closed. */
export async function hasCellTree(root: string): Promise<boolean> {
  let cursor = resolve(root, "tree.json");
  let present = true;
  for (;;) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Symbolic links are not followed"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return present;
}

export async function readCells(root: string, agent: AgentKind, activeOnly = false): Promise<StoredCell[]> {
  // Every current agent uses this profile-independent store for active pointers.
  // It validates paths, frontmatter, tree versions and symlinks before opening cells.
  const store = await agentModule("director", "cell-format/index.js");
  const cells: StoredCell[] = await (activeOnly ? store.readActive : store.listCells)(agentRoot(root, agent));
  // Agent-specific parsers own the profile's content rather than Producer.
  if (agent === "designer") {
    const profile = await agentModule(agent, "library-cli/cells.js");
    for (const cell of cells) profile.parseLibraryCell(cell.source, cell.path);
  } else if (agent === "writer") {
    const profile = await agentModule(agent, "cells/parse.js");
    for (const cell of cells) profile.parseWriterCell(cell.source, cell.path);
  } else if (agent === "publisher") {
    // Publisher's projection API checks generated outputs and cross-agent links.
    // Its underlying shared store is the read API for drafts as well as actives.
    resolveAgent(agent);
  } else {
    const profile = await agentModule(agent, "index.js");
    for (const cell of cells) {
      const parsed = profile.parseCell(cell.source, cell.path);
      if (!parsed.ok) throw new Error("Invalid Director cell profile");
    }
  }
  return cells;
}

/** Read-only Studio previews retain real status and confirmation findings, without activating anything. */
export async function readStudioCells(root: string, agent: AgentKind, report: StudioReportSink, activeOnly = false): Promise<StoredCell[]> {
  const base = agentRoot(root, agent), store = await agentModule('director', 'cell-format/index.js');
  if (!await hasCellTree(base)) return [];
  const read = async (name: string) => {
    const target = join(base, name);
    let cursor = target;
    for (;;) {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links are not followed');
      const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
    }
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (!(await handle.stat()).isFile()) throw new Error('Expected a regular cell file'); return await handle.readFile('utf8'); }
    finally { await handle.close(); }
  };
  const tree = JSON.parse(await read('tree.json'));
  const cellRoot = join(base, 'cells');
  let entries: Dirent[];
  try { if ((await lstat(cellRoot)).isSymbolicLink()) throw new Error('Symbolic links are not followed'); entries = await readdir(cellRoot, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []; else throw error; }
  const ids = entries.map(entry => entry.name);
  const valid = store.validateGenericTree(tree, { cellIds: ids, maxDepth: 3 });
  if (!valid.ok) throw new Error('Invalid agent tree');
  const cells: StoredCell[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !CELL_ID.test(entry.name)) throw new Error('Invalid cell directory');
    for (const version of await readdir(join(cellRoot, entry.name), { withFileTypes: true })) {
      const match = /^v([1-9]\d*)\.md$/.exec(version.name), number = Number(match?.[1]);
      if (!version.isFile() || version.isSymbolicLink() || !match || !Number.isSafeInteger(number)) throw new Error('Invalid cell version file');
      if (activeOnly && tree.active[entry.name] !== number) continue;
      const path = `cells/${entry.name}/${version.name}`, source = await read(path), parsed = store.parseDocument(source);
      if (!parsed.ok) throw new Error('Invalid cell document');
      const fields = parsed.value.fields;
      if (fields.id !== entry.name || fields.version !== number || !['active', 'draft', 'retired'].includes(fields.status) || !store.isoDate(fields.updated)) throw new Error('Invalid cell identity or status');
      if (fields.links !== undefined && (!Array.isArray(fields.links) || fields.links.some((link: unknown) => typeof link !== 'string' || !store.parseLinkRef(link)))) throw new Error('Invalid cell links');
      const confirmation = typeof fields.confirmed === 'string' ? store.parseConfirmRef(fields.confirmed) : undefined;
      if ((fields.status === 'active' || fields.confirmed !== undefined) && (!confirmation || confirmation.kind === 'migration' && number !== 1) || activeOnly && fields.status !== 'active') report({ gate: 'render-cell-confirmations', blocking: false, state: 'reported', message: `Unconfirmed Studio preview: ${entry.name}@${number}` });
      cells.push({ id: entry.name, version: number, status: fields.status, path, source, document: parsed.value });
    }
  }
  if (activeOnly) for (const [id, version] of Object.entries(tree.active)) if (version !== null && !cells.some(cell => cell.id === id && cell.version === version)) throw new Error('An active cell target is missing');
  return cells.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}

export function summary(cell: StoredCell): CellSummary {
  return { id: cell.id, version: cell.version, status: cell.status, path: cell.path, fields: cell.document.fields };
}
export async function inventory(root: string, agent: AgentKind, report?: StudioReportSink): Promise<AgentCells> {
  let packageName: string = AGENT_PACKAGES[agent][0];
  try {
    packageName = resolveAgent(agent).packageName;
    if (!await hasCellTree(agentRoot(root, agent))) return { agent, packageName, state: "missing", cells: [], message: "Agent cells are not initialized" };
    const all = report ? await readStudioCells(root, agent, report) : await readCells(root, agent);
    const latest = new Map<string, StoredCell>();
    for (const cell of all) if ((latest.get(cell.id)?.version ?? 0) < cell.version) latest.set(cell.id, cell);
    const handle = await open(join(agentRoot(root, agent), "tree.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let tree: Record<string, unknown>;
    try { tree = JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
    const store = await agentModule("director", "cell-format/index.js");
    const validated = store.validateGenericTree(tree, { cellIds: [...latest.keys()], maxDepth: 3 });
    if (!validated.ok) throw new Error("Invalid agent tree");
    return { agent, packageName, state: "ready", tree, cells: [...latest.values()].map(summary) };
  } catch {
    return { agent, packageName, state: "error", cells: [], message: "Agent cells could not be read; check the agent package and cell format" };
  }
}

export interface CompileResult { agent: "designer" | "writer"; state: "compiled" | "missing" | "error"; output?: string; message?: string }
/** Projections belong under the consumer's agent root, away from legacy libraries. */
export async function compileCells(root: string, check = false): Promise<CompileResult[]> {
  const results: CompileResult[] = [];
  for (const agent of ["designer", "writer"] as const) {
    try {
    const source = agentRoot(root, agent);
    if (!await hasCellTree(source)) { results.push({ agent, state: "missing" }); continue; }
    const output = join(source, "compiled");
    // Validate the source boundary before compilation, including symlink ancestors.
    await readCells(root, agent, true);
    if (agent === "designer") {
      const api = await agentModule(agent, "library-cli/cells.js");
      const result = await api.compileLibraryCells(source, output, { check });
      if (!result.ok) throw new Error("Designer compiled output has drift");
    } else {
      const api = await agentModule(agent, "cells/compile.js");
      await api.compileWriterCells(source, output, { check });
    }
    results.push({ agent, state: "compiled", output: `clossys/agents/${agent}/compiled` });
    } catch {
      results.push({ agent, state: "error", message: "Cell compilation failed; check the agent's cells and compile inputs" });
    }
  }
  return results;
}
