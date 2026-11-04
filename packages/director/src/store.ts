import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadCatalog, type StrategyCatalog } from "./catalog.js";
import { parseCell } from "./format/cell.js";
import { parseFinding } from "./format/finding.js";
import { CELL_ID_PATTERN, positiveInteger, RECORD_ID_PATTERN, sessionId } from "./format/ref.js";
import { validateRequest } from "./format/request.js";
import { parseSession } from "./format/session.js";
import { validateTree } from "./format/tree.js";
import type { FormatResult, StrategyModel, StrategyRootIssue } from "./format/types.js";

/**
 * Synchronously reads only the supplied root. Symlink files and directories are
 * rejected before enumeration/open; references never cause filesystem reads.
 * Missing optional directories are empty. Broken records produce path/line issues
 * while valid records remain available for diagnostics and quality checks.
 */
export function readStrategyRoot(root: string, options: { catalog?: StrategyCatalog } = {}): StrategyModel {
  const model: StrategyModel = { root: resolve(root), catalog: options.catalog ?? loadCatalog(), tree: undefined, cells: [], sessions: [], findings: [], requests: [], files: Object.create(null), issues: [] };
  const issue = (path: string, reason: StrategyRootIssue["reason"], message: string, line = 1) => model.issues.push({ path, line, reason, message });
  let anchor: string;
  try {
    if (lstatSync(model.root).isSymbolicLink()) { issue(".", "outside-root", "Symlink roots are not followed"); return model; }
    anchor = realpathSync(model.root);
    if (!lstatSync(anchor).isDirectory()) throw new Error("Root must be a directory");
  } catch { issue(".", "unreadable", "Strategy root is unreadable or is not a directory"); return model; }
  const inside = (path: string) => { const rel = relative(anchor, path); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
  function checked(path: string, directory: boolean, optional = false): string | undefined {
    const full = join(anchor, path);
    try {
      // Inspect every component rather than only the final filename.
      let current = anchor;
      for (const part of path.split("/")) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) { issue(path, "outside-root", "Symlink paths are not followed"); return undefined; }
      }
      const resolved = realpathSync(full);
      if (!inside(resolved)) { issue(path, "outside-root", "Path resolves outside the strategy root"); return undefined; }
      const stat = lstatSync(resolved);
      if (directory ? !stat.isDirectory() : !stat.isFile()) { issue(path, "invalid-path", directory ? "Expected a directory" : "Expected a regular file"); return undefined; }
      return resolved;
    } catch (error) {
      if (!(optional && (error as NodeJS.ErrnoException).code === "ENOENT")) issue(path, "unreadable", "Path could not be read");
      return undefined;
    }
  }
  function entries(path: string): string[] {
    const full = checked(path, true, true); if (!full) return [];
    try { return readdirSync(full).sort(); } catch { issue(path, "unreadable", "Directory could not be listed"); return []; }
  }
  function read(path: string): string | undefined {
    const full = checked(path, false); if (!full) return undefined;
    let fd: number | undefined;
    try {
      fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) { issue(path, "invalid-path", "Expected a regular file"); return undefined; }
      // Recheck the target after open, before reading its bytes.
      const current = checked(path, false); if (!current) return undefined;
      const opened = fstatSync(fd); const currentStat = lstatSync(current);
      if (opened.dev !== currentStat.dev || opened.ino !== currentStat.ino) { issue(path, "outside-root", "File changed during confinement checks"); return undefined; }
      const text = readFileSync(fd, "utf8"); model.files[path] = text; return text;
    } catch { issue(path, "unreadable", "File could not be read"); return undefined; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  function parsed<T>(path: string, result: FormatResult<T>, accept: (value: T) => void) {
    if (result.ok) accept(result.value);
    else for (const error of result.issues) issue(path, "invalid-format", `${error.path}: ${error.message}`, error.line);
  }
  function json<T>(path: string, validate: (value: unknown) => FormatResult<T>, accept: (value: T) => void) {
    const text = read(path); if (text === undefined) return;
    let value: unknown;
    try { value = JSON.parse(text); } catch (error) {
      const position = /position (\d+)/.exec(String(error));
      const line = position ? text.slice(0, Number(position[1])).split("\n").length : Number(/line (\d+)/.exec(String(error))?.[1] ?? 1);
      issue(path, "invalid-json", "Invalid JSON", line); return;
    }
    parsed(path, validate(value), accept);
  }
  json("tree.json", v => validateTree(v, model.catalog), tree => { model.tree = tree; });
  const known = new Set(model.catalog.cells.map(c => c.id));
  for (const id of entries("cells")) {
    const dir = `cells/${id}`;
    if (!CELL_ID_PATTERN.test(id) || !known.has(id)) { issue(dir, "invalid-path", "Unknown cell directory"); continue; }
    for (const name of entries(dir)) {
      const path = `${dir}/${name}`; const match = /^v([1-9]\d*)\.md$/.exec(name);
      if (!match || !positiveInteger(Number(match[1]))) { issue(path, "invalid-path", "Expected v<positive safe integer>.md"); continue; }
      const text = read(path); if (text === undefined) continue;
      parsed(path, parseCell(text, path), cell => {
        if (cell.id !== id || cell.version !== Number(match[1])) issue(path, "invalid-path", "Cell id/version disagrees with its path"); else model.cells.push(cell);
      });
    }
  }
  for (const name of entries("sessions")) {
    const path = `sessions/${name}`; const id = name.endsWith(".md") ? name.slice(0, -3) : "";
    if (!sessionId(id)) { issue(path, "invalid-path", "Expected YYYY-MM-DD-n.md"); continue; }
    const text = read(path); if (text !== undefined) parsed(path, parseSession(text, id, path), value => model.sessions.push(value));
  }
  for (const name of entries("findings")) {
    const path = `findings/${name}`; const id = name.endsWith(".md") ? name.slice(0, -3) : "";
    if (!RECORD_ID_PATTERN.test(id)) { issue(path, "invalid-path", "Expected a finding-id.md filename"); continue; }
    const text = read(path); if (text !== undefined) parsed(path, parseFinding(text, path), value => {
      if (value.id !== id) issue(path, "invalid-path", "Finding id disagrees with its filename"); else model.findings.push(value);
    });
  }
  for (const name of entries("requests")) {
    const path = `requests/${name}`;
    if (!/^REQ-\d{4}\.json$/.test(name)) { issue(path, "invalid-path", "Expected REQ-NNNN.json"); continue; }
    json(path, v => validateRequest(v, model.catalog), value => {
      if (`${value.id}.json` !== name) issue(path, "invalid-path", "Request id disagrees with its filename"); else model.requests.push(value);
    });
  }
  return model;
}
