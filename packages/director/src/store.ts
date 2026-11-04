import { resolve } from "node:path";
import { loadCatalog, type StrategyCatalog } from "./catalog.js";
import { parseCell } from "./format/cell.js";
import { parseFinding } from "./format/finding.js";
import { CELL_ID_PATTERN, positiveInteger, RECORD_ID_PATTERN, sessionId } from "./format/ref.js";
import { validateRequest } from "./format/request.js";
import { parseSession } from "./format/session.js";
import { validateTree } from "./format/tree.js";
import type { FormatResult, StrategyModel, StrategyRootIssue } from "./format/types.js";
import { storeFault, type DirectorStoreReader } from "./store-io.js";

type Issue = [StrategyRootIssue["reason"], string];
/** One fault vocabulary for every reader, so messages stay stable whoever reads. */
function faultIssue(error: unknown, operation: "list" | "read"): Issue {
  switch (storeFault(error)) {
    case "symlink": return ["outside-root", "Symlink paths are not followed"];
    case "outside": return ["outside-root", "Path resolves outside the strategy root"];
    case "changed": return ["outside-root", "File changed during confinement checks"];
    case "not-directory": return ["invalid-path", "Expected a directory"];
    case "not-file": return ["invalid-path", "Expected a regular file"];
    case "io": return ["unreadable", operation === "list" ? "Directory could not be listed" : "File could not be read"];
    default: return ["unreadable", "Path could not be read"];
  }
}

/**
 * Reads only the supplied root, through the injected store reader. Symlink files
 * and directories are refused by the reader; references never cause reads.
 * Missing optional directories are empty. Broken records produce path/line issues
 * while valid records remain available for diagnostics and quality checks.
 */
export function readStrategyRoot(root: string, store: DirectorStoreReader, options: { catalog?: StrategyCatalog } = {}): StrategyModel {
  const model: StrategyModel = { root: resolve(root), catalog: options.catalog ?? loadCatalog(), tree: undefined, cells: [], sessions: [], findings: [], requests: [], files: Object.create(null), issues: [] };
  const issue = (path: string, reason: StrategyRootIssue["reason"], message: string, line = 1) => model.issues.push({ path, line, reason, message });
  try {
    const entry = store.stat(model.root, ".");
    if (entry?.type === "symlink") { issue(".", "outside-root", "Symlink roots are not followed"); return model; }
    if (entry?.type !== "directory") throw new Error("Root must be a directory");
  } catch (error) {
    if (storeFault(error) === "root-symlink") issue(".", "outside-root", "Symlink roots are not followed");
    else issue(".", "unreadable", "Strategy root is unreadable or is not a directory");
    return model;
  }
  function entries(path: string): string[] {
    try { return store.list(model.root, path) ?? []; }
    catch (error) { issue(path, ...faultIssue(error, "list")); return []; }
  }
  function read(path: string): string | undefined {
    try {
      const text = store.read(model.root, path);
      if (text === undefined) { issue(path, "unreadable", "Path could not be read"); return undefined; }
      model.files[path] = text; return text;
    } catch (error) { issue(path, ...faultIssue(error, "read")); return undefined; }
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
