/** Shared structural types. Agent profiles validate their own keys and content. */
export interface FormatIssue { path: string; line: number; message: string }
export type FormatResult<T> = { ok: true; value: T } | { ok: false; issues: FormatIssue[] };
export interface CellRef { cell: string; version: number }
/** Legacy citation shape retained by readBullet without widening Strategist parsing. */
export type Ref = { kind: "cell"; ref: CellRef } | { kind: "msg"; session: string; line: string } | { kind: "finding"; id: string };
export interface Bullet { key?: string; text: string; refs: Ref[]; line: number }
export interface LinkRef extends CellRef { agent?: string }
export type ConfirmRef = { kind: "msg"; session: string; line: string } | { kind: "migration"; date: string };

// The final assertion also rejects the terminal newline that JavaScript's $ permits.
export const CELL_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$(?![\s\S])/;
export function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.length !== 10) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseLinkRef(text: string): LinkRef | undefined {
  if (text.trim() !== text || /[\r\n]/.test(text)) return undefined;
  const match = /^(?:([a-z][a-z0-9-]*):)?([^\s:@]+)@([1-9]\d*)$/.exec(text);
  if (!match || !CELL_ID_PATTERN.test(match[2]!) || !positiveInteger(Number(match[3]))) return undefined;
  return { ...(match[1] ? { agent: match[1] } : {}), cell: match[2]!, version: Number(match[3]) };
}
export function formatLinkRef(ref: LinkRef): string {
  const text = `${ref.agent === undefined ? "" : `${ref.agent}:`}${ref.cell}@${ref.version}`;
  if (!parseLinkRef(text)) throw new Error("Invalid cell link reference");
  return text;
}
/** Syntax only: stores enforce migration confirmation on version 1 at activation. */
export function parseConfirmRef(text: string): ConfirmRef | undefined {
  if (text.trim() !== text || /[\r\n]/.test(text)) return undefined;
  const migration = /^migration:(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (migration && isoDate(migration[1])) return { kind: "migration", date: migration[1] };
  const msg = /^msg:([A-Za-z0-9][A-Za-z0-9._-]*)#U([1-9]\d*)$/.exec(text);
  return msg && positiveInteger(Number(msg[2])) ? { kind: "msg", session: msg[1]!, line: `U${msg[2]}` } : undefined;
}
export function cellPath(id: string, n: number): string {
  if (!CELL_ID_PATTERN.test(id) || !positiveInteger(n)) throw new Error("Expected a cell id and positive safe version integer");
  return `cells/${id}/v${n}.md`;
}

export interface GenericTreeNode {
  id: string; name: string; children?: GenericTreeNode[]; cells?: string[];
  [key: string]: unknown;
}
export interface GenericTree {
  schemaVersion: 1; tree?: GenericTreeNode[]; active: Record<string, number | null>;
  retired?: string[]; meta?: Record<string, unknown>; [key: string]: unknown;
}
export interface GenericTreeOptions { cellIds: Iterable<string>; maxDepth?: number }
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateGenericTree(value: unknown, options: GenericTreeOptions): FormatResult<GenericTree> {
  const issues: FormatIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, line: 1, message });
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "tree", line: 1, message: "Expected a tree object" }] };
  const ids = [...options.cellIds]; const known = new Set(ids); const maxDepth = options.maxDepth ?? 2;
  if (!positiveInteger(maxDepth)) add("maxDepth", "Expected a positive safe group depth");
  if (ids.some(id => !CELL_ID_PATTERN.test(id)) || known.size !== ids.length) add("cellIds", "Expected unique shared cell ids");
  if (value.schemaVersion !== 1) add("schemaVersion", "Expected schemaVersion 1");
  if (!isPlainObject(value.active)) add("active", "Expected an active pointer object");
  else for (const [id, version] of Object.entries(value.active)) {
    if (!known.has(id)) add(`active.${id}`, "Unknown cell id");
    if (version !== null && !positiveInteger(version)) add(`active.${id}`, "Expected null or a positive safe version integer");
  }
  if (value.retired !== undefined) {
    if (!Array.isArray(value.retired) || value.retired.some(id => typeof id !== "string" || !known.has(id)) || new Set(value.retired).size !== value.retired.length) add("retired", "Expected unique known retired cell ids");
    else if (isPlainObject(value.active)) for (const id of value.retired as string[]) {
      if (value.active[id] !== undefined && value.active[id] !== null) add(`active.${id}`, "Retired cells cannot have an active version");
    }
  }
  if (value.meta !== undefined && !isPlainObject(value.meta)) add("meta", "Expected a metadata object");
  if (value.tree !== undefined) {
    const placements: string[] = []; const groups = new Set<string>(); const ancestors = new Set<unknown>();
    const walk = (nodes: unknown, path: string, depth: number): void => {
      if (!Array.isArray(nodes)) { add(path, "Expected a grouping array"); return; }
      if (depth > maxDepth || !positiveInteger(maxDepth)) { add(path, "Grouping exceeds maxDepth"); return; }
      nodes.forEach((node: unknown, i: number) => {
        const p = `${path}[${i}]`;
        if (!isPlainObject(node)) { add(p, "Expected a group"); return; }
        if (ancestors.has(node)) { add(p, "Cyclic grouping is unsupported"); return; }
        if (typeof node.id !== "string" || !node.id.trim() || groups.has(node.id) || known.has(node.id)) add(`${p}.id`, "Expected a unique group id distinct from cell ids");
        else groups.add(node.id);
        if (typeof node.name !== "string" || !node.name.trim()) add(`${p}.name`, "Expected a group name");
        if (node.cells !== undefined) {
          if (!Array.isArray(node.cells) || node.cells.some(id => typeof id !== "string")) add(`${p}.cells`, "Expected cell ids");
          else {
            if (depth < 2) add(`${p}.cells`, "Cells require at least two group levels");
            for (const id of node.cells as string[]) { placements.push(id); if (!known.has(id)) add(`${p}.cells`, "Unknown cell id"); }
          }
        }
        if (node.children !== undefined) {
          ancestors.add(node); walk(node.children, `${p}.children`, depth + 1); ancestors.delete(node);
        }
        if (node.children === undefined && node.cells === undefined) add(p, "Expected children or cells");
      });
    };
    walk(value.tree, "tree", 1);
    if (placements.length !== known.size || new Set(placements).size !== known.size || ids.some(id => !placements.includes(id))) add("tree", "Grouping must place every cell exactly once");
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as GenericTree };
}
