import type { StudioWriteResult } from "./types.js";

type WriteFailure = Exclude<StudioWriteResult<{ message: string }>, { ok: true }>;
export type EditWriteResult<S> = { ok: true; committed: S } | WriteFailure;
export class EditRefusal extends Error { constructor(readonly reason: "conflict" | "invalid", message: string) { super(message); } }
export type EditTiming = "discrete" | "continuous";
export interface LeafEdit<O> {
  readonly id: string;
  readonly leaf: string;
  readonly field: string;
  readonly operations: readonly O[];
  readonly status: "waiting" | "saving" | "failed" | "conflict";
  readonly failure?: WriteFailure;
}
interface HistoryEntry<S> { id: string; leaf: string; before: S; after: S }
interface HistoryRequest { readonly baseHash: string; readonly editId: string; readonly requestId: string; readonly direction: "undo" | "redo" }
export interface EditSessionState<S, O> {
  readonly committed: S;
  readonly edits: readonly LeafEdit<O>[];
  readonly revision: number;
  readonly status: "saving" | "saved" | "not-saved";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly historyFailure?: { readonly leaf: string; readonly request: HistoryRequest; readonly failure: WriteFailure };
}
export interface EditSessionPorts<S, O, C extends { baseHash: string }> {
  copy(snapshot: S): S;
  hash(snapshot: S): string;
  changes(snapshot: S, operations: readonly O[]): C;
  save(changes: C): Promise<EditWriteResult<S>>;
  restore(current: S, target: S, leaf: string, expected: S): C;
  load(): Promise<S>;
}
/** Serial per-edit CAS. This owns no persistence, source rewriting or conformance verdicts. */
export class EditSession<S, O, C extends { baseHash: string }> {
  private state: EditSessionState<S, O>;
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private undoEntries: HistoryEntry<S>[] = [];
  private redoEntries: HistoryEntry<S>[] = [];
  private running = false;
  private flushWaiters = new Set<(saved: boolean) => void>();
  private nextId = 0;
  private identity = globalThis.crypto.randomUUID();
  private attempts = new Map<string, C>();
  private beforeImages = new Map<string, S>();
  private historyAttempts = new Map<string, C>();
  private acknowledged = new Map<string, S>();
  private historyEntry?: HistoryEntry<S>;
  private queuedHistory?: { direction: "undo" | "redo"; editId: string; leaf: string; request?: HistoryRequest };
  private resolutions: { leaf: string; editIds: ReadonlySet<string>; done: () => void }[] = [];
  constructor(snapshot: S, private ports: EditSessionPorts<S, O, C>, private debounceMs = 500) {
    this.state = { committed: ports.copy(snapshot), edits: [], revision: 0, status: "saved", canUndo: false, canRedo: false };
  }
  getSnapshot = (): EditSessionState<S, O> => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<EditSessionState<S, O>> = {}): void {
    const next = { ...this.state, ...patch };
    const busy = this.running || !!this.queuedHistory || this.resolutions.length > 0 || next.edits.some(edit => edit.status === "waiting" || edit.status === "saving");
    const failed = next.edits.some(edit => edit.status === "failed" || edit.status === "conflict") || next.historyFailure !== undefined;
    this.state = { ...next, revision: this.state.revision + 1, status: failed ? "not-saved" : busy ? "saving" : "saved",
      canUndo: !this.running && !next.historyFailure && (next.edits.length > 0 || this.undoEntries.length > 0),
      canRedo: !this.running && next.edits.length === 0 && !next.historyFailure && this.redoEntries.length > 0 };
    this.listeners.forEach(listener => listener());
    if (!this.running && !this.queuedHistory && !this.resolutions.length && !this.nextCandidate(next.edits)) {
      const saved = next.edits.length === 0 && !next.historyFailure;
      for (const settle of this.flushWaiters) settle(saved);
      this.flushWaiters.clear();
    }
  }
  edit(leaf: string, operations: readonly O[], timing: EditTiming = "discrete", field = leaf): string | undefined {
    if (!leaf.trim()) throw new TypeError("Studio edit requires a leaf");
    if (!operations.length) return undefined;
    this.redoEntries = [];
    // Consecutive continuous values on the same leaf are one edit until its timer fires.
    const tail = this.state.edits.at(-1);
    const coalesce = timing === "continuous" && tail?.leaf === leaf && tail.field === field && tail.status === "waiting" && this.timers.has(tail.id);
    const id = coalesce ? tail.id : `${this.identity}-${++this.nextId}`;
    const edit: LeafEdit<O> = { id, leaf, field, operations: structuredClone(operations), status: "waiting" };
    this.publish({ edits: coalesce ? [...this.state.edits.slice(0, -1), edit] : [...this.state.edits, edit] });
    if (coalesce) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    if (timing === "continuous") this.timers.set(id, setTimeout(() => { this.timers.delete(id); void this.drain(); }, this.debounceMs));
    else void this.drain();
    return id;
  }
  /** Blur, Enter, layer navigation and unmount call this; no value is dropped. */
  flush(leaf?: string): Promise<boolean> {
    for (const edit of this.state.edits) if (leaf === undefined || edit.leaf === leaf) {
      const timer = this.timers.get(edit.id);
      if (timer) { clearTimeout(timer); this.timers.delete(edit.id); }
    }
    const completion = new Promise<boolean>(resolve => this.flushWaiters.add(resolve));
    void this.drain();
    this.publish();
    return completion;
  }
  retry(leaf: string, keepMine = false): void {
    if (keepMine) for (const edit of this.state.edits) if (edit.leaf === leaf && edit.status === "conflict") {
      this.attempts.delete(edit.id); this.beforeImages.delete(edit.id);
    }
    const failure = this.state.historyFailure;
    if (failure?.leaf === leaf) {
      // A retry survives an unrelated in-flight save. Only explicit conflict resolution may create a new CAS request.
      const rebase = keepMine && failure.failure.reason === "conflict" && !this.acknowledged.has(failure.request.requestId);
      this.queuedHistory = { direction: failure.request.direction, editId: failure.request.editId, leaf, ...(rebase ? {} : { request: failure.request }) };
    }
    this.publish({ edits: this.state.edits.map(edit => edit.leaf === leaf && (edit.status === "failed" || keepMine && edit.status === "conflict")
      ? { id: edit.id, leaf: edit.leaf, field: edit.field, operations: edit.operations, status: "waiting" } : edit) });
    void this.drain();
  }
  takeTheirs(leaf: string): Promise<void> {
    // Capture only edits visible at the user's resolution. Values entered while load awaits remain queued.
    const editIds = new Set(this.state.edits.filter(edit => edit.leaf === leaf).map(edit => edit.id));
    const completion = new Promise<void>(done => this.resolutions.push({ leaf, editIds, done }));
    void this.drain();
    return completion;
  }
  private async resolveTheirs(resolution: { leaf: string; editIds: ReadonlySet<string>; done: () => void }): Promise<void> {
    const { leaf, editIds, done } = resolution;
    this.running = true; this.publish();
    try {
      const committed = await this.ports.load();
      const failure = this.state.historyFailure;
      if (failure?.leaf === leaf) {
        this.undoEntries = this.undoEntries.filter(entry => entry.leaf !== leaf);
        this.redoEntries = this.redoEntries.filter(entry => entry.leaf !== leaf);
        this.historyAttempts.delete(failure.request.requestId); this.acknowledged.delete(failure.request.requestId); this.historyEntry = undefined;
        if (this.queuedHistory?.leaf === leaf) this.queuedHistory = undefined;
      }
      for (const id of editIds) {
        clearTimeout(this.timers.get(id)); this.timers.delete(id); this.attempts.delete(id);
        this.beforeImages.delete(id); this.acknowledged.delete(id);
      }
      this.publish({ committed, edits: this.state.edits.filter(edit => !editIds.has(edit.id)), ...(failure?.leaf === leaf ? { historyFailure: undefined } : {}) });
    } catch {
      this.publish({ edits: this.state.edits.map(edit => editIds.has(edit.id) ? { ...edit, status: "failed", failure: { ok: false, reason: "failed" } } : edit) });
    } finally { this.finishRun(); done(); }
  }
  private finishRun(): void {
    this.running = false;
    this.publish();
    void this.drain();
  }
  private nextCandidate(edits: readonly LeafEdit<O>[]): LeafEdit<O> | undefined {
    const blocked = new Set<string>(this.state.historyFailure ? [this.state.historyFailure.leaf] : []);
    for (const edit of edits) {
      if (edit.status === "failed" || edit.status === "conflict") blocked.add(edit.leaf);
      if (edit.status === "waiting" && !blocked.has(edit.leaf) && !this.timers.has(edit.id)) return edit;
    }
    return undefined;
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    const resolution = this.resolutions.shift();
    if (resolution) { await this.resolveTheirs(resolution); return; }
    const history = this.queuedHistory;
    if (history) {
      this.queuedHistory = undefined;
      await this.runHistory(history.direction, history.editId, history.leaf, history.request, true);
      return;
    }
    // A failed leaf does not stop unrelated leaves. Later edits of the failed leaf wait for its explicit resolution.
    const candidate = this.nextCandidate(this.state.edits);
    if (!candidate) return;
    const edit = candidate;
    this.running = true;
    this.publish({ edits: this.state.edits.map(current => current.id === edit.id ? { ...current, status: "saving" } : current) });
    const before = this.state.committed;
    let result: EditWriteResult<S>;
    try {
      let changes = this.attempts.get(edit.id);
      if (!changes) {
        changes = this.ports.changes(this.state.committed, edit.operations);
        if (changes.baseHash !== this.ports.hash(this.state.committed)) throw new TypeError("Studio edit baseHash differs from its recorded before image");
        this.attempts.set(edit.id, changes); this.beforeImages.set(edit.id, this.ports.copy(this.state.committed));
      }
      result = this.acknowledged.has(edit.id) ? { ok: true, committed: this.acknowledged.get(edit.id)! } : await this.ports.save(changes);
      if (result.ok) {
        const after = this.ports.copy(result.committed);
        this.acknowledged.set(edit.id, after);
        const committed = await this.ports.load();
        this.attempts.delete(edit.id);
        // An edit queued during Undo also invalidates the Redo entry created when that Undo completes.
        this.redoEntries = [];
        this.undoEntries.push({ id: edit.id, leaf: edit.leaf, before: this.beforeImages.get(edit.id) ?? this.ports.copy(before), after });
        this.acknowledged.delete(edit.id); this.beforeImages.delete(edit.id);
        this.publish({ committed, edits: this.state.edits.filter(current => current.id !== edit.id) });
      } else {
        const failure = result;
        // A conflict's authoritative image is refreshed without dropping the local edited value.
        let committed = this.state.committed;
        if (failure.reason === "conflict") { try { committed = await this.ports.load(); } catch { /* Explicit conflict remains, never silently rebased. */ } }
        this.publish({ committed, edits: this.state.edits.map(current => current.id === edit.id ? { ...current, status: failure.reason === "conflict" ? "conflict" : "failed", failure } : current) });
      }
    } catch {
      // Retain the original CAS request. An acknowledged write retries only its load; an ambiguous request cannot overwrite a newer version.
      this.publish({ edits: this.state.edits.map(current => current.id === edit.id ? { ...current, status: "failed", failure: { ok: false, reason: "failed" } } : current) });
    } finally { this.finishRun(); }
  }
  undo = (): void => {
    if (this.running || this.state.historyFailure) return;
    const local = this.state.edits.at(-1);
    if (local) {
      if (this.acknowledged.has(local.id)) { this.retry(local.leaf); return; }
      clearTimeout(this.timers.get(local.id)); this.timers.delete(local.id); this.attempts.delete(local.id); this.beforeImages.delete(local.id);
      this.publish({ edits: this.state.edits.slice(0, -1) });
      return;
    }
    const entry = this.undoEntries.at(-1);
    if (entry) void this.runHistory("undo", entry.id, entry.leaf);
  };
  redo = (): void => { const entry = this.redoEntries.at(-1); if (!this.running && !this.state.historyFailure && !this.state.edits.length && entry) void this.runHistory("redo", entry.id, entry.leaf); };
  private async runHistory(direction: "undo" | "redo", editId: string, leaf: string, retryRequest?: HistoryRequest, resolvingFailure = false): Promise<void> {
    if (this.running || (!resolvingFailure && (this.state.edits.length || this.state.historyFailure))) return;
    this.running = true;
    const request: HistoryRequest = retryRequest ?? { baseHash: this.ports.hash(this.state.committed), editId, direction, requestId: globalThis.crypto.randomUUID() };
    this.publish({ historyFailure: undefined });
    try {
      const source = direction === "undo" ? this.undoEntries : this.redoEntries;
      // Unrelated edits may have committed since this entry failed; resolve exactly the recorded entry.
      const index = source.findIndex(entry => entry.id === editId);
      const entry = source[index] ?? (this.historyEntry?.id === editId ? this.historyEntry : undefined);
      if (!entry) throw new TypeError("Studio history entry is unavailable");
      this.historyEntry = entry;
      let changes = this.historyAttempts.get(request.requestId);
      if (!changes) { changes = this.ports.restore(this.state.committed, direction === "undo" ? entry.before : entry.after, leaf, direction === "undo" ? entry.after : entry.before); this.historyAttempts.set(request.requestId, changes); }
      const result = this.acknowledged.has(request.requestId) ? { ok: true as const, committed: this.acknowledged.get(request.requestId)! } : await this.ports.save(changes);
      if (!result.ok) {
        let committed = this.state.committed;
        if (result.reason === "conflict") { try { committed = await this.ports.load(); } catch { /* Retain explicit conflict. */ } }
        this.publish({ committed, historyFailure: { leaf, request, failure: result } }); return;
      }
      this.acknowledged.set(request.requestId, result.committed);
      const committed = await this.ports.load();
      const target = direction === "undo" ? this.redoEntries : this.undoEntries;
      if (index >= 0) source.splice(index, 1);
      target.push(entry);
      this.historyEntry = undefined;
      this.acknowledged.delete(request.requestId); this.historyAttempts.delete(request.requestId);
      this.publish({ committed, historyFailure: undefined });
    } catch (error) { this.publish({ historyFailure: { leaf, request, failure: { ok: false, reason: error instanceof EditRefusal ? error.reason : "failed", findings: [{ message: error instanceof Error ? error.message : String(error) }] } } }); }
    finally { this.finishRun(); }
  }
}
