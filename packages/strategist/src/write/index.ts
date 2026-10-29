/** Local strategy writes. Activation checks the entire confirmation batch before mutation. */
import { readStrategyRoot } from "../store.js";
import { parseRef, formatRef } from "../format/ref.js";
import { checkCell } from "../checks/index.js";
import type { StrategyRequest } from "../format/types.js";
import { commitChanges, metadata, readBytes, withWriteLock, type Change } from "./transaction.js";

export interface ProposeOptions { from?: number; option?: string; requestIds?: string[]; today?: string }
export interface ActivateOptions { confirm?: string; judgeVerdicts?: Record<string, "pass" | "fail"> }
export interface NewRequest {
  raisedBy: string; kind: "missing" | "contradiction" | "tripwire" | "drift" | "reading" | "change";
  cells: string[]; detail: string; today?: string;
}
function date(today = new Date().toISOString().slice(0, 10)): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today)) || new Date(today).toISOString().slice(0, 10) !== today) throw new Error("Expected an ISO date");
  return today;
}
function modelAt(root: string) {
  const model = readStrategyRoot(root);
  if (!model.tree || model.issues.length) throw new Error(`Cannot write an invalid strategy root: ${model.issues.map(i => i.reason).join("; ")}`);
  return model as typeof model & { tree: NonNullable<typeof model.tree> };
}
type Model = ReturnType<typeof modelAt>;
function cellId(model: Model, id: string): void {
  if (!model.catalog.cells.some(c => c.id === id)) throw new Error("Unknown catalog cell");
}
function cellRef(text: string) {
  const ref = parseRef(text);
  if (ref?.kind !== "cell") throw new Error("Expected a cell version reference");
  return ref.ref;
}
function cellPath(id: string, version: number): string { return `cells/${id}/v${version}.md`; }
function requestPath(id: string): string {
  if (!/^REQ-\d{4}$/.test(id)) throw new Error("Expected a request id");
  return `requests/${id}.json`;
}
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function requestJson(request: StrategyRequest): string {
  return json({ ...request, resolvedBy: request.resolvedBy ? formatRef(request.resolvedBy) : null });
}
function assertSnapshot(model: Model): void {
  for (const [path, bytes] of Object.entries(model.files)) {
    if (readBytes(model.root, path) !== bytes) throw new Error(`Strategy source changed during validation: ${path}`);
  }
}
function linkedDrafts(model: Model, requestIds: string[], id: string, ref: string): Change[] {
  if (new Set(requestIds).size !== requestIds.length) throw new Error("Duplicate request id");
  return requestIds.map(requestId => {
    const request = model.requests.find(r => r.id === requestId);
    if (!request || !["open", "drafted"].includes(request.status) || !request.cells.includes(id)) throw new Error("Request cannot be linked to this draft");
    const path = requestPath(requestId);
    return { path, before: readBytes(model.root, path), after: requestJson({ ...request, status: "drafted", resolvedBy: parseRef(ref)! }) };
  });
}

/** Allocate a fresh version; --from selects the source, never the destination. */
export function propose(root: string, id: string, options: ProposeOptions = {}) {
  return withWriteLock(root, () => {
    const model = modelAt(root); cellId(model, id);
    const versions = model.cells.filter(c => c.id === id).map(c => c.version);
    const version = Math.max(0, ...versions) + 1;
    if (!Number.isSafeInteger(version)) throw new Error("Cell version limit reached");
    if (options.from !== undefined && (!Number.isSafeInteger(options.from) || options.from < 1)) throw new Error("Expected a positive source version");
    if (options.option !== undefined && !/^[A-Z]$/.test(options.option)) throw new Error("Expected one option letter A–Z");
    const path = cellPath(id, version), today = date(options.today);
    if (readBytes(root, path) !== undefined) throw new Error("Draft destination already exists");
    let text: string;
    const sourceVersion = options.from ?? (versions.length ? Math.max(...versions) : undefined);
    if (sourceVersion !== undefined) {
      const source = model.cells.find(c => c.id === id && c.version === sourceVersion);
      if (!source) throw new Error("Source cell version does not exist");
      const bytes = readBytes(root, cellPath(id, source.version));
      if (bytes === undefined) throw new Error("Source file is unreadable");
      text = metadata(bytes, { version: String(version), status: "draft", updated: today, confirmed: undefined, ...(options.option ? { note: `option ${options.option}` } : {}) });
    } else {
      const contract = model.catalog.cells.find(c => c.id === id)!;
      text = `---\nid: ${id}\nversion: ${version}\nstatus: draft\nupdated: ${today}\ncites: []\nfeeds: []\nfunctions: [${contract.functions.join(", ")}]\n${options.option ? `note: option ${options.option}\n` : ""}---\n\n## Direction\n${contract.mustContain.map(k => `- ${k.key}: <${k.hint}>`).join("\n")}\n\n## Because\n- <Add a reason and its evidence refs.>\n\n## Watch\n- If <signal> <comparator> <threshold> by <date>, then <action>.\n`;
    }
    const ref = `${id}@${version}`;
    const changes = [{ path, after: text }, ...linkedDrafts(model, options.requestIds ?? [], id, ref)];
    assertSnapshot(model);
    commitChanges(root, changes);
    return { cell: id, version, path, status: "draft" as const };
  });
}

/** A listed yes covers the full preceding playback and cannot select two options of one cell. */
function confirmation(model: Model, refs: string[], confirm: string | undefined): void {
  const parsed = confirm ? parseRef(confirm) : undefined;
  if (parsed?.kind !== "msg" || !/^U\d+$/.test(parsed.line)) throw new Error("Activation requires a user confirmation ref");
  const session = model.sessions.find(s => s.id === parsed.session);
  const lines = session?.lines;
  const index = lines?.findIndex(line => line.id === parsed.line) ?? -1;
  const previous = lines?.[index - 1];
  if (index < 1 || !previous || previous.role !== "strategist") throw new Error("Confirmation must immediately follow a strategist playback");
  const listed = [...previous.text.matchAll(/(?<![\w.@-])[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@[1-9]\d*(?=$|[\s,;:)\]!?]|\.(?=\s|$))/gu)].map(m => m[0]);
  if (!listed.length || new Set(listed).size !== listed.length || listed.length !== refs.length || listed.some(ref => !refs.includes(ref))) throw new Error("Activation must match the exact playback batch");
}

export function activate(root: string, refs: string[], options: ActivateOptions) {
  return withWriteLock(root, () => {
    const model = modelAt(root);
    if (!refs.length || new Set(refs).size !== refs.length) throw new Error("Expected unique activation refs");
    const targets = refs.map(text => {
      const ref = cellRef(text); cellId(model, ref.cell);
      if (formatRef({ kind: "cell", ref }) !== text) throw new Error("Expected canonical cell references");
      const cell = model.cells.find(c => c.id === ref.cell && c.version === ref.version);
      if (!cell || cell.status !== "draft") throw new Error("Activation target must be a draft");
      return cell;
    });
    if (new Set(targets.map(c => c.id)).size !== targets.length) throw new Error("One option per cell may activate");
    confirmation(model, refs, options.confirm);
    const confirmed = parseRef(options.confirm!)!;
    const active = { ...model.tree.active };
    for (const cell of targets) active[cell.id] = cell.version;
    const retires = (cell: typeof targets[number]) => cell.status === "active" || (cell.status === "draft" && /^option [A-Z]$/.test(cell.note ?? ""));
    const prospective = {
      ...model, tree: { ...model.tree, active },
      cells: model.cells.map(cell => targets.includes(cell)
        ? { ...cell, status: "active" as const, confirmed }
        : targets.some(t => t.id === cell.id) && retires(cell) ? { ...cell, status: "retired" as const } : cell),
    };
    const findings = prospective.cells.filter(cell => targets.some(t => t.id === cell.id && t.version === cell.version))
      .flatMap(cell => checkCell(cell, { model: prospective, judgeVerdicts: options.judgeVerdicts }));
    if (findings.some(f => f.severity === "hard" || (f.severity === "judge" && f.verdict === "fail"))) throw new Error(`Activation blocked: ${findings.filter(f => f.severity === "hard" || f.verdict === "fail").map(f => f.rule).join(", ")}`);
    const changes: Change[] = [];
    for (const cell of model.cells.filter(cell => targets.some(t => t.id === cell.id))) {
      const path = cellPath(cell.id, cell.version), before = readBytes(root, path);
      if (before === undefined) throw new Error("Cell file disappeared");
      if (targets.includes(cell)) changes.push({ path, before, after: metadata(before, { status: "active", confirmed: options.confirm! }) });
      else if (retires(cell)) changes.push({ path, before, after: metadata(before, { status: "retired" }) });
    }
    changes.push({ path: "tree.json", before: readBytes(root, "tree.json"), after: json(prospective.tree) });
    for (const request of model.requests) {
      if (request.status === "drafted" && request.resolvedBy && refs.includes(formatRef(request.resolvedBy))) {
        const path = requestPath(request.id);
        changes.push({ path, before: readBytes(root, path), after: requestJson({ ...request, status: "resolved" }) });
      }
    }
    assertSnapshot(model);
    commitChanges(root, changes);
    return { activated: refs, findings };
  });
}

export function listRequests(root: string) { return modelAt(root).requests; }
export function createRequest(root: string, input: NewRequest) {
  return withWriteLock(root, () => {
    const model = modelAt(root);
    if (!input.raisedBy?.trim() || !input.detail?.trim() || !["missing", "contradiction", "tripwire", "drift", "reading", "change"].includes(input.kind) || !Array.isArray(input.cells) || !input.cells.length || new Set(input.cells).size !== input.cells.length) throw new Error("Invalid new request");
    input.cells.forEach(id => cellId(model, id));
    const next = Math.max(0, ...model.requests.map(r => Number(r.id.slice(4)))) + 1;
    if (next > 9999) throw new Error("Request id limit reached");
    const id = `REQ-${String(next).padStart(4, "0")}`;
    const request = { id, raisedBy: input.raisedBy, kind: input.kind, cells: input.cells, detail: input.detail, status: "open" as const, opened: date(input.today), resolvedBy: null };
    const path = requestPath(id);
    if (readBytes(root, path) !== undefined) throw new Error("Request destination already exists");
    assertSnapshot(model);
    commitChanges(root, [{ path, after: json(request) }]);
    return request;
  });
}
/** Repair a linked request after activation; this cannot activate or invent a confirmation. */
export function resolveRequest(root: string, id: string, target: string, confirm: string) {
  return withWriteLock(root, () => {
    const model = modelAt(root), request = model.requests.find(r => r.id === id), ref = cellRef(target);
    const cell = model.cells.find(c => c.id === ref.cell && c.version === ref.version);
    if (!request || request.status !== "drafted" || (!request.resolvedBy || formatRef(request.resolvedBy) !== target) || !request.cells.includes(ref.cell) || cell?.status !== "active" || model.tree.active[ref.cell] !== ref.version || !cell.confirmed || formatRef(cell.confirmed) !== confirm) throw new Error("Request resolution requires its linked, user-confirmed active draft");
    // Check Q7 against the original full listing, which may include other active cells.
    const findings = checkCell(cell, { model });
    if (findings.some(f => f.rule === "Q7" && f.severity === "hard")) throw new Error("Invalid activation confirmation");
    const path = requestPath(id), resolved = { ...request, status: "resolved" as const };
    assertSnapshot(model);
    commitChanges(root, [{ path, before: readBytes(root, path), after: requestJson(resolved) }]);
    return resolved;
  });
}
