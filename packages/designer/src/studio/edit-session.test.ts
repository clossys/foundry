import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLibraryChange, libraryHash, loadCatalog, type ChangeSet, type LibraryData } from "../catalog-core/index.js";
import { EditSession, type EditSessionPorts } from "./edit-session.js";
import { valueHistoryChanges } from "./history.js";
import { emptyLibrary } from "./__fixtures__/studio.js";
const catalog = loadCatalog();
type Operation = ChangeSet["changes"][number];
const adopt = (slot: string, source = "lucide"): Operation => ({ op: "adopt", slot, source });
const settle = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
function host(initial = emptyLibrary()) {
  let library = initial;
  const save = vi.fn(async (changes: ChangeSet) => {
    if (changes.baseHash !== libraryHash(library)) return { ok: false as const, reason: "conflict" as const };
    library = applyLibraryChange(catalog, library, changes);
    return { ok: true as const, committed: structuredClone(library) };
  });
  const load = vi.fn(async () => structuredClone(library));
  const ports: EditSessionPorts<LibraryData, Operation, ChangeSet> = { copy: structuredClone, hash: libraryHash, changes: (snapshot, operations) => ({ baseHash: libraryHash(snapshot), changes: operations }), save, load, restore: (current, target, leaf, expected) => valueHistoryChanges(catalog, current, target, leaf, expected) };
  return { session: new EditSession(initial, ports), save, load, read: () => library, change: (next: LibraryData) => { library = next; } };
}
afterEach(() => vi.useRealTimers());
describe("per-edit Studio persistence with the actual token catalog", () => {
  it("commits discrete edits immediately, rebases only on fresh server truth and preserves exact provenance through Undo/Redo", async () => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(await h.session.flush()).toBe(true);
    const first = structuredClone(h.read());
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")]);
    expect(await h.session.flush()).toBe(true);
    const second = structuredClone(h.read());
    expect(h.save.mock.calls[1]?.[0].baseHash).toBe(libraryHash(first));
    h.session.undo(); await h.session.flush();
    expect(libraryHash(h.read())).toBe(libraryHash(first));
    expect(JSON.stringify(h.read())).toContain('"kind":"adopted"');
    h.session.redo(); await h.session.flush();
    expect(libraryHash(h.read())).toBe(libraryHash(second));
    expect(h.session.getSnapshot().status).toBe("saved");
  });
  it.each(["blur", "Enter", "layer leave", "controlled host leave"])("coalesces a rapid continuous field edit for 500 ms and awaits %s flush exactly once", async () => {
    vi.useFakeTimers(); const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")], "continuous", "source");
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")], "continuous", "source");
    await vi.advanceTimersByTimeAsync(499); expect(h.save).not.toHaveBeenCalled();
    expect(await h.session.flush()).toBe(true);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]?.[0].changes).toEqual([adopt("assets.icon-check", "phosphor")]);
    await vi.advanceTimersByTimeAsync(1000); expect(h.save).toHaveBeenCalledTimes(1);
  });
  it("does not coalesce two separate fields of the same leaf and automatically commits at 500 ms", async () => {
    vi.useFakeTimers(); const h = host();
    h.session.edit("themes.shadow", [{ op: "author", slot: "themes.shadow", tokens: { sm: { $type: "shadow", $value: "0 1px 2px 0 rgb(0 0 0 / 0.05)" } } }], "continuous", "sm");
    h.session.edit("themes.shadow", [{ op: "author", slot: "themes.shadow", tokens: { md: { $type: "shadow", $value: "0 4px 6px -1px rgb(0 0 0 / 0.1)" } } }], "continuous", "md");
    await vi.advanceTimersByTimeAsync(500); await settle();
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(Object.keys(h.read().fills[0]?.themes?.["shadow"] ?? {})).toEqual(["md", "sm"]);
  });
  it("retains a failed value and failed flush, lets unrelated edits persist, and retries the original CAS without silent overwrite", async () => {
    const h = host(); h.save.mockResolvedValueOnce({ ok: false, reason: "failed" });
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]);
    expect(await h.session.flush()).toBe(false);
    expect(h.session.getSnapshot().edits[0]?.operations).toEqual([adopt("assets.icon-check")]);
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]);
    expect(await h.session.flush()).toBe(false);
    expect(h.read().fills.some(fill => fill.$extensions["com.clossys.fill"].slot === "themes.border")).toBe(true);
    h.session.retry("assets.icon-check"); await h.session.flush();
    expect(h.session.getSnapshot().edits[0]?.status).toBe("conflict");
    h.session.retry("assets.icon-check", true); expect(await h.session.flush()).toBe(true);
    expect(h.read().fills).toHaveLength(2);
  });
  it("keeps a conflict leaf local until explicit Keep mine or Take theirs and leaves unrelated operations intact", async () => {
    const h = host(); h.change(applyLibraryChange(catalog, h.read(), { baseHash: libraryHash(h.read()), changes: [adopt("themes.border", "shadcn@aria")] }));
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    expect(h.session.getSnapshot().edits[0]?.status).toBe("conflict");
    expect(h.read().fills).toHaveLength(1);
    await h.session.takeTheirs("assets.icon-check");
    expect(h.session.getSnapshot().edits).toHaveLength(0); expect(h.read().fills).toHaveLength(1);
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    expect(h.read().fills).toHaveLength(2);
  });
  it("records the exact save response after-image, preserves an unrelated external leaf, and refuses a changed recorded leaf before Undo writes", async () => {
    const h = host();
    h.load.mockImplementationOnce(async () => { h.change(applyLibraryChange(catalog, h.read(), { baseHash: libraryHash(h.read()), changes: [adopt("themes.border", "shadcn@aria")] })); return structuredClone(h.read()); });
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    h.session.undo(); await h.session.flush();
    expect(h.read().fills.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual(["themes.border"]);
    h.session.redo(); await h.session.flush();
    h.change(applyLibraryChange(catalog, h.read(), { baseHash: libraryHash(h.read()), changes: [adopt("assets.icon-check", "phosphor")] }));
    // The adapter's fresh read exposes the external version; Undo first hits CAS, then the exact-leaf guard refuses it.
    const calls = h.save.mock.calls.length; h.session.undo(); await h.session.flush();
    expect(h.session.getSnapshot().historyFailure?.failure.reason).toBe("conflict");
    h.session.retry("assets.icon-check", true); await h.session.flush();
    expect(h.save).toHaveBeenCalledTimes(calls + 1);
    expect(h.session.getSnapshot().historyFailure?.failure.reason).toBe("conflict");
  });
  it("does not resubmit an acknowledged write when only reload failed, and invalidates Redo after a new edit", async () => {
    const h = host(); h.load.mockRejectedValueOnce(new Error("offline"));
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); expect(await h.session.flush()).toBe(false);
    h.session.retry("assets.icon-check"); expect(await h.session.flush()).toBe(true); expect(h.save).toHaveBeenCalledTimes(1);
    h.session.undo(); await h.session.flush(); expect(h.session.getSnapshot().canRedo).toBe(true);
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]); await h.session.flush(); expect(h.session.getSnapshot().canRedo).toBe(false);
  });
  it("refuses unsupported provenance reconstruction before invoking persistence", () => {
    const desired = applyLibraryChange(catalog, emptyLibrary(), { baseHash: libraryHash(emptyLibrary()), changes: [adopt("assets.icon-check")] });
    const current = applyLibraryChange(catalog, desired, { baseHash: libraryHash(desired), changes: [adopt("assets.icon-check", "phosphor")] });
    const withoutSource = { ...catalog, fills: catalog.fills.filter(fill => fill.$extensions["com.clossys.fill"].source !== "lucide") };
    expect(() => valueHistoryChanges(withoutSource, current, desired, "assets.icon-check", current)).toThrow(/exact provenance/);
    expect(libraryHash(current)).not.toBe(libraryHash(desired));
  });
});


function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function holdNextSave(h: ReturnType<typeof host>) {
  const release = deferred<void>();
  const save = h.save.getMockImplementation()!;
  h.save.mockImplementationOnce(async changes => { await release.promise; return save(changes); });
  return release;
}
describe("serialized history and edits across deferred transport boundaries", () => {
  it.each(["undo", "redo"] as const)("drains an edit arriving during %s, binds its CAS to the fresh history version and invalidates Redo", async direction => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    if (direction === "redo") { h.session.undo(); await h.session.flush(); }
    const held = holdNextSave(h);
    h.session[direction]();
    const historyCall = h.save.mock.calls.length;
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]);
    const flushed = h.session.flush();
    let finished = false; void flushed.then(() => { finished = true; });
    await settle();
    expect(h.save).toHaveBeenCalledTimes(historyCall);
    expect(finished).toBe(false);
    held.resolve(); await settle();
    expect(h.save).toHaveBeenCalledTimes(historyCall + 1);
    expect(await flushed).toBe(true);
    const historyResponse = await h.save.mock.results[historyCall - 1]!.value;
    expect(historyResponse.ok).toBe(true);
    if (historyResponse.ok) expect(h.save.mock.calls[historyCall]![0].baseHash).toBe(libraryHash(historyResponse.committed));
    expect(h.session.getSnapshot().committed).toEqual(h.read());
    expect(h.read().fills.some(fill => fill.$extensions["com.clossys.fill"].slot === "themes.border")).toBe(true);
    expect(h.session.getSnapshot().canRedo).toBe(false);
  });
  it("requires explicit failed-history resolution, preserves queued same-leaf values and unrelated writes, and retries the recorded entry after newer history", async () => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    h.save.mockResolvedValueOnce({ ok: false, reason: "failed" });
    h.session.undo(); expect(await h.session.flush()).toBe(false);
    expect(h.session.getSnapshot().canUndo).toBe(false);
    const failedCall = h.save.mock.calls.length;
    h.session.undo(); h.session.redo(); await settle();
    expect(h.save).toHaveBeenCalledTimes(failedCall);
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")]);
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]);
    expect(await h.session.flush()).toBe(false);
    expect(h.session.getSnapshot().edits).toHaveLength(1);
    const originalRequest = h.save.mock.calls[failedCall - 1]![0];
    h.session.retry("assets.icon-check"); await h.session.flush();
    expect(h.save.mock.calls.at(-1)![0]).toEqual(originalRequest);
    expect(h.session.getSnapshot().historyFailure?.failure.reason).toBe("conflict");
    h.session.retry("assets.icon-check", true); await settle();
    expect(h.session.getSnapshot().historyFailure).toBeUndefined();
    expect(await h.session.flush()).toBe(true);
    expect(h.read().fills).toHaveLength(2);
    expect(h.session.getSnapshot().committed).toEqual(h.read());
    expect(h.session.getSnapshot().edits).toHaveLength(0);
    expect(h.session.getSnapshot().canRedo).toBe(false);
  });
  it("queues a failed-history Retry requested while an unrelated save is in flight", async () => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    h.save.mockResolvedValueOnce({ ok: false, reason: "failed" });
    h.session.undo(); await h.session.flush();
    const held = holdNextSave(h);
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]);
    h.session.retry("assets.icon-check");
    held.resolve(); await settle();
    expect(h.save).toHaveBeenCalledTimes(4);
    expect(h.session.getSnapshot().historyFailure?.failure.reason).toBe("conflict");
    expect(await h.session.flush()).toBe(false);
  });
  it("retries only the acknowledged history reload before draining an edit queued on that leaf", async () => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    const held = holdNextSave(h);
    h.load.mockRejectedValueOnce(new Error("history reload offline"));
    h.session.undo();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")]);
    held.resolve(); await settle();
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(await h.session.flush()).toBe(false);
    h.session.retry("assets.icon-check", true); await settle();
    expect(h.save).toHaveBeenCalledTimes(3);
    expect(await h.session.flush()).toBe(true);
    expect(h.session.getSnapshot().historyFailure).toBeUndefined();
    expect(h.session.getSnapshot().committed).toEqual(h.read());
    expect(h.read().fills).toHaveLength(1);
  });
  it("serializes Take theirs behind an unrelated save so its load cannot publish an older committed version", async () => {
    const h = host(); h.save.mockResolvedValueOnce({ ok: false, reason: "failed" });
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    const held = holdNextSave(h);
    h.session.edit("themes.border", [adopt("themes.border", "shadcn@aria")]);
    const resolved = h.session.takeTheirs("assets.icon-check");
    await settle(); expect(h.load).not.toHaveBeenCalled();
    held.resolve(); await resolved; await h.session.flush();
    expect(h.session.getSnapshot().committed).toEqual(h.read());
    expect(h.read().fills.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual(["themes.border"]);
    expect(h.session.getSnapshot().edits).toHaveLength(0);
  });
  it("retains the exact in-flight Redo entry when a new edit invalidates Redo before its acknowledged reload fails", async () => {
    const h = host();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    h.session.undo(); await h.session.flush();
    const held = holdNextSave(h);
    h.load.mockRejectedValueOnce(new Error("redo reload offline"));
    h.session.redo();
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")]);
    held.resolve(); await settle();
    expect(h.save).toHaveBeenCalledTimes(3);
    expect(await h.session.flush()).toBe(false);
    h.session.retry("assets.icon-check"); await settle();
    expect(h.session.getSnapshot().historyFailure).toBeUndefined();
    expect(h.save).toHaveBeenCalledTimes(4);
    expect(await h.session.flush()).toBe(true);
    expect(h.session.getSnapshot().committed).toEqual(h.read());
    expect(h.session.getSnapshot().canRedo).toBe(false);
  });
  it("preserves a newer value entered while the Take theirs load is pending", async () => {
    const h = host(); h.save.mockResolvedValueOnce({ ok: false, reason: "failed" });
    h.session.edit("assets.icon-check", [adopt("assets.icon-check")]); await h.session.flush();
    const held = deferred<void>(); const load = h.load.getMockImplementation()!;
    h.load.mockImplementationOnce(async () => { await held.promise; return load(); });
    const resolved = h.session.takeTheirs("assets.icon-check");
    h.session.edit("assets.icon-check", [adopt("assets.icon-check", "phosphor")]);
    const flushed = h.session.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    held.resolve(); await resolved;
    expect(await flushed).toBe(true);
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls.at(-1)![0].changes).toEqual([adopt("assets.icon-check", "phosphor")]);
    expect(h.session.getSnapshot().committed).toEqual(h.read());
  });

});
