import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_PACKAGES, resolveAgent, type AgentKind } from "../agents.js";
import type { AgentCells, CellSummary } from "./contract.js";

export const AGENT_KINDS = Object.keys(AGENT_PACKAGES) as AgentKind[];
export const CELL_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$(?![\s\S])/;
export interface StoredCell extends Omit<CellSummary, "fields"> { source: string; document: { fields: Record<string, unknown>; body: { text: string }[] } }
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
    const catalog = (await agentModule(agent, "catalog-core/index.js")).loadBuildCatalog();
    for (const cell of cells) {
      const parsed = profile.parseLibraryCell(cell.source, cell.path);
      const slot = catalog.slots.find((entry: { id: string }) => entry.id === cell.id);
      if (!slot) throw new Error("The Designer source slot has no native contract");
      const { layer, contract } = slot;
      const valueKind = contract.kind === "token" ? contract.$type : contract.kind === "asset" ? contract.valueKind : undefined;
      cell.native = { agent: "designer", kind: contract.kind, layer, ...(typeof valueKind === "string" ? { valueKind } : {}), fill: parsed.fill, rationale: parsed.rationale, originKinds: parsed.originKinds, sources: parsed.sources };
    }
  } else if (agent === "writer") {
    const profile = await agentModule(agent, "cells/parse.js");
    for (const cell of cells) {
      const parsed = profile.parseWriterCell(cell.source, cell.path);
      cell.native = { agent: "writer", kind: "writer", locales: parsed.locales, records: parsed.records };
    }
  } else if (agent === "publisher") {
    // Publisher's projection API checks generated outputs and cross-agent links.
    // Its underlying shared store is the read API for drafts as well as actives.
    resolveAgent(agent);
  } else {
    const profile = await agentModule(agent, "index.js");
    for (const cell of cells) {
      const parsed = profile.parseCell(cell.source, cell.path);
      if (!parsed.ok) throw new Error("Invalid Director cell profile");
      const bullet = (entry: { key?: string; text: string }) => `- ${entry.key ? `${entry.key}: ` : ""}${entry.text}`;
      cell.native = { agent: "director", kind: "director", sections: [
        { title: "Direction", value: parsed.value.direction.map(bullet).join("\n") },
        { title: "Because", value: parsed.value.because.map(bullet).join("\n") },
        { title: "Watch", value: parsed.value.watch.map(bullet).join("\n") },
      ] };
    }
  }
  return cells;
}

export function summary(cell: StoredCell): CellSummary {
  return { id: cell.id, version: cell.version, status: cell.status, path: cell.path, fields: cell.document.fields, ...(cell.native ? { native: cell.native } : {}) };
}
export async function inventory(root: string, agent: AgentKind): Promise<AgentCells> {
  let packageName: string = AGENT_PACKAGES[agent][0];
  try {
    packageName = resolveAgent(agent).packageName;
    if (!await hasCellTree(agentRoot(root, agent))) return { agent, packageName, state: "missing", cells: [], message: "Agent cells are not initialized" };
    const all = await readCells(root, agent);
    await readCells(root, agent, true);
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
