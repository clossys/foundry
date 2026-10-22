// @vitest-environment jsdom
/**
 * The showing step, tested for the three properties that make it a loop
 * rather than a read-only page:
 *
 *   1. A verdict is rendered per item, by the SAME `decideHolding` the gates
 *      and the CLI use — not by a second rendering-side rule that could drift.
 *   2. Correction and erasure are reachable through the same call shape as
 *      reading. A surface that shows a person their record and makes deletion
 *      a support ticket has observation without correction, and an open loop.
 *   3. An erasure the host could not confirm does NOT remove the row. Telling
 *      someone their data is gone when nobody checked is the failure this
 *      whole role exists to prevent.
 */
import { act, render as renderComponent, renderHook, waitFor } from "@testing-library/react";
import { Activity, StrictMode, Suspense, createElement, startTransition, use, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DeletionEffect, HeldItem } from "../schema.js";
import { useHeldRecord, type HeldRecordClient, type HeldRecordEntry, type UseHeldRecordResult } from "./useHeldRecord.js";

const NOW = "2026-08-22T12:00:00.000Z";

function item(overrides: Partial<HeldItem> = {}): HeldItem {
  return {
    itemId: "item_1",
    subjectId: "sub_1",
    actorId: "actor_1",
    heldSince: "2026-08-01T00:00:00.000Z",
    holdingClass: "authored-notes",
    origin: "authored",
    provenance: { kind: "event", sourceEventId: "evt_1" },
    belief: null,
    ...overrides,
  };
}

function entry(overrides: Partial<HeldRecordEntry> = {}): HeldRecordEntry {
  return {
    item: item(),
    retention: { status: "declared", days: 90 },
    reach: { status: "reachable", surface: "account-data-page" },
    source: {
      status: "retained",
      event: { eventId: "evt_1", subjectId: "sub_1", actorId: "actor_1", occurredAt: "2026-07-01T00:00:00.000Z", kind: "note-written" },
    },
    disposition: { status: "standing" },
    ...overrides,
  };
}

function client(entries: readonly HeldRecordEntry[], forgetEffect: DeletionEffect = "erased"): HeldRecordClient & { forget: ReturnType<typeof vi.fn> } {
  const forget = vi.fn(async () => forgetEffect);
  return {
    read: async () => entries,
    correct: async (_subjectId: string, next: HeldItem) => next,
    forget,
  };
}

function options(c: HeldRecordClient) {
  return { subjectId: "sub_1", actorId: "surface_1", now: NOW, client: c };
}

/**
 * Every case below builds its client ONCE, outside the render callback, and
 * closes over it. That is not a test-tidiness preference: `useHeldRecord`'s
 * read effect is keyed on the client's identity, so a fresh object per render
 * would re-read forever. A consumer wiring this hook has the same obligation
 * — memoize the client, or hoist it — and the hook is deliberately not
 * written to paper over an unstable one, because a hook that silently
 * tolerated it would make the runaway fetch invisible instead of impossible.
 */
function render(c: HeldRecordClient, now: string = NOW) {
  return renderHook(() => useHeldRecord({ ...options(c), now }));
}

type Mutation = (record: UseHeldRecordResult) => Promise<void>;

/**
 * A parent holding the hook and a child that calls a mutation from its own
 * effect. React runs a child's effects before its parent's, so the child's
 * call lands before the hook's read effect for the same commit has run: on
 * first mount, and in the same commit as a client swap.
 */
function childCaller(callWhen: (c: HeldRecordClient) => boolean, call: Mutation) {
  const seen: { current: UseHeldRecordResult | undefined } = { current: undefined };
  function Child({ record, c }: { record: UseHeldRecordResult; c: HeldRecordClient }) {
    useEffect(() => {
      if (callWhen(c)) void call(record);
    }, [c]);
    return null;
  }
  function Parent({ c }: { c: HeldRecordClient }) {
    const record = useHeldRecord(options(c));
    seen.current = record;
    return createElement(Child, { record, c });
  }
  return { seen, Parent };
}

/**
 * The hook inside an `Activity` boundary, whose effects are torn down while
 * hidden but whose state is kept. The probe renders one element labelled with
 * `label`, so a test can see when a commit made while hidden has landed.
 */
function inActivity() {
  const seen: { current: UseHeldRecordResult | undefined } = { current: undefined };
  function Probe({ c, label }: { c: HeldRecordClient; label: string }) {
    seen.current = useHeldRecord(options(c));
    return createElement("span", { "data-client": label });
  }
  const tree = (c: HeldRecordClient, mode: "visible" | "hidden", label = "") =>
    createElement(Activity, { mode, children: createElement(Probe, { c, label }) });
  return { seen, tree };
}

/**
 * The hook inside a `Suspense` boundary next to a sibling that suspends while
 * `wait` is pending. Rendering with a pending `wait` after the content has
 * been shown re-suspends it: React shows the fallback and tears down the
 * hidden content's layout effects, but keeps its passive effects, so the read
 * does not run again when the content returns.
 */
function inSuspense() {
  const seen: { current: UseHeldRecordResult | undefined } = { current: undefined };
  function Probe({ c }: { c: HeldRecordClient }) {
    seen.current = useHeldRecord(options(c));
    return createElement("span");
  }
  function Gate({ wait }: { wait: Promise<void> | undefined }) {
    if (wait) use(wait);
    return null;
  }
  const tree = (c: HeldRecordClient, wait?: Promise<void>) =>
    createElement(Suspense, {
      fallback: createElement("p", null, "fallback"),
      children: [createElement(Probe, { key: "probe", c }), createElement(Gate, { key: "gate", wait })],
    });
  return { seen, tree };
}

function probe(container: HTMLElement): HTMLElement {
  const span = container.querySelector("span");
  if (!span) throw new Error("the probe has not rendered");
  return span;
}

function deferredMutations(entries: readonly HeldRecordEntry[] = [entry()]) {
  const corrections: Array<(stored: HeldItem) => void> = [];
  const erasures: Array<(effect: DeletionEffect) => void> = [];
  const c: HeldRecordClient = {
    read: async () => entries,
    correct: () => new Promise((resolve) => { corrections.push(resolve); }),
    forget: () => new Promise((resolve) => { erasures.push(resolve); }),
  };
  return { c, corrections, erasures };
}

/**
 * A client backed by a small store, whose corrections and erasures stay
 * pending until the test settles them. A stored correction or a confirmed
 * erasure also changes what the next `read` returns, as a host's store would,
 * so a read that runs again after the reply does not undo it. `reads` records
 * every read, so a test can tell the hook's own state from a fresh read.
 */
function heldStore(initial: readonly HeldRecordEntry[] = [entry()]) {
  let held = [...initial];
  let gate: Promise<void> | undefined;
  const reads: string[] = [];
  const corrections: Array<{ resolve: (stored: HeldItem) => void; reject: (error: Error) => void }> = [];
  const erasures: Array<{ resolve: (effect: DeletionEffect) => void; reject: (error: Error) => void }> = [];
  const c: HeldRecordClient = {
    read: async (subjectId) => {
      reads.push(subjectId);
      if (gate) await gate;
      return held;
    },
    correct: () =>
      new Promise((resolve, reject) => {
        corrections.push({
          resolve: (stored) => {
            held = held.map((each) => (each.item.itemId === stored.itemId ? { ...each, item: stored } : each));
            resolve(stored);
          },
          reject,
        });
      }),
    forget: (_subjectId, itemId) =>
      new Promise((resolve, reject) => {
        erasures.push({
          resolve: (effect) => {
            if (effect === "erased") held = held.filter((each) => each.item.itemId !== itemId);
            resolve(effect);
          },
          reject,
        });
      }),
  };
  /** Holds every later read until the returned function is called. */
  const holdReads = () => {
    let release!: () => void;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      gate = undefined;
      release();
    };
  };
  return { c, reads, corrections, erasures, holdReads };
}

/**
 * Every reply the current client can give to a pending call, each with what
 * the person must be shown once it lands: the effect an erasure observed, the
 * stored correction, or the failure. `failure` marks the replies that land in
 * `error`, which a read that runs again clears as it starts, as it does on
 * every read.
 */
const pendingReplies: ReadonlyArray<{
  name: string;
  call: Mutation;
  reply: (store: ReturnType<typeof heldStore>) => void;
  check: (record: UseHeldRecordResult) => void;
  failure?: true;
}> = [
  {
    name: "a confirmed erasure",
    call: (record) => record.forget("item_1"),
    reply: (store) => store.erasures[0]!.resolve("erased"),
    check: (record) => {
      expect(record.lastForgetEffect).toBe("erased");
      expect(record.rows).toHaveLength(0);
    },
  },
  {
    name: "an erasure nobody confirmed",
    call: (record) => record.forget("item_1"),
    reply: (store) => store.erasures[0]!.resolve("unknown"),
    check: (record) => {
      expect(record.lastForgetEffect).toBe("unknown");
      expect(record.rows).toHaveLength(1);
    },
  },
  {
    name: "a failed erasure",
    call: (record) => record.forget("item_1"),
    reply: (store) => store.erasures[0]!.resolve("failed"),
    check: (record) => {
      expect(record.lastForgetEffect).toBe("failed");
      expect(record.rows).toHaveLength(1);
    },
  },
  {
    name: "a rejected erasure",
    call: (record) => record.forget("item_1"),
    reply: (store) => store.erasures[0]!.reject(new Error("erasure failed")),
    failure: true,
    check: (record) => {
      expect((record.error as Error | undefined)?.message).toBe("erasure failed");
      expect(record.rows).toHaveLength(1);
    },
  },
  {
    name: "a stored correction",
    call: (record) => record.correct(item({ holdingClass: "corrected-notes" })),
    reply: (store) => store.corrections[0]!.resolve(item({ holdingClass: "corrected-notes" })),
    check: (record) => expect(record.rows[0]?.entry.item.holdingClass).toBe("corrected-notes"),
  },
  {
    name: "a rejected correction",
    call: (record) => record.correct(item({ holdingClass: "corrected-notes" })),
    reply: (store) => store.corrections[0]!.reject(new Error("correction failed")),
    failure: true,
    check: (record) => {
      expect((record.error as Error | undefined)?.message).toBe("correction failed");
      expect(record.rows[0]?.entry.item.holdingClass).toBe("authored-notes");
    },
  },
];

/**
 * Replies to the CURRENT client that must reach the surface. Each is a reply
 * the person is owed: a confirmed erasure, or a failure they need to see. The
 * synchronous variants pin that a client throwing before it returns a promise
 * is judged the same way as one that rejects.
 */
const currentClientReplies: ReadonlyArray<{ name: string; make: () => HeldRecordClient; call: Mutation; check: (record: UseHeldRecordResult) => void }> = [
  {
    name: "a confirmed erasure reaches lastForgetEffect",
    make: () => client([entry()], "erased"),
    call: (record) => record.forget("item_1"),
    check: (record) => expect(record.lastForgetEffect).toBe("erased"),
  },
  {
    name: "a rejected erasure reaches error",
    make: () => ({ ...client([entry()]), forget: async () => { throw new Error("erasure failed"); } }),
    call: (record) => record.forget("item_1"),
    check: (record) => expect((record.error as Error | undefined)?.message).toBe("erasure failed"),
  },
  {
    name: "a rejected correction reaches error",
    make: () => ({ ...client([entry()]), correct: async () => { throw new Error("correction failed"); } }),
    call: (record) => record.correct(item()),
    check: (record) => expect((record.error as Error | undefined)?.message).toBe("correction failed"),
  },
  {
    name: "a synchronously thrown erasure failure reaches error",
    make: () => ({ ...client([entry()]), forget: () => { throw new Error("erasure threw"); } }),
    call: (record) => record.forget("item_1"),
    check: (record) => expect((record.error as Error | undefined)?.message).toBe("erasure threw"),
  },
  {
    name: "a synchronously thrown correction failure reaches error",
    make: () => ({ ...client([entry()]), correct: () => { throw new Error("correction threw"); } }),
    call: (record) => record.correct(item()),
    check: (record) => expect((record.error as Error | undefined)?.message).toBe("correction threw"),
  },
];

/**
 * Runs a scenario on a real root OUTSIDE `act`, so React schedules work the
 * way it does in a browser: a commit runs its layout effects synchronously and
 * leaves its passive effects to a later task. Inside `act` every effect has
 * run before any reply can arrive, which hides a reply that settles in
 * between — the window a client answering within microtasks lands in.
 */
async function outsideAct(scenario: (root: Root, container: HTMLElement) => Promise<void>): Promise<void> {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await scenario(root, container);
  } finally {
    root.unmount();
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

/** Polls on timers, never inside `act`, until `check` stops throwing. */
function settle(check: () => void): Promise<void> {
  return vi.waitFor(check, { timeout: 2_000, interval: 1 });
}

/**
 * Like `childCaller`, but the child calls from a LAYOUT effect, which React
 * runs inside the commit, before any passive effect of that commit. With
 * `"after-commit"` the call is made from a microtask once the commit is done,
 * standing for code that calls through the fresh callback before passive
 * effects have run. `showChild: false` renders the hook without the child, so
 * a test can mount the child in a later commit.
 */
function layoutCaller(callWhen: (c: HeldRecordClient) => boolean, call: Mutation, timing: "in-commit" | "after-commit" = "in-commit") {
  const seen: { current: UseHeldRecordResult | undefined } = { current: undefined };
  function Child({ record, c }: { record: UseHeldRecordResult; c: HeldRecordClient }) {
    useLayoutEffect(() => {
      if (!callWhen(c)) return;
      if (timing === "in-commit") void call(record);
      else queueMicrotask(() => void call(record));
    }, [c]);
    return null;
  }
  function Parent({ c, showChild = true }: { c: HeldRecordClient; showChild?: boolean }) {
    const record = useHeldRecord(options(c));
    seen.current = record;
    return showChild ? createElement(Child, { record, c }) : null;
  }
  return { seen, Parent };
}

const swaps = [
  ["an ordinary update", (update: () => void) => update()],
  ["a transition", (update: () => void) => startTransition(update)],
] as const;

/**
 * A client whose corrections and erasures stay pending until the test
 * settles them, each recorded with the subject it was made for. Its read
 * labels every item with the subject and `label`, so a test can tell which
 * read is shown.
 */
function pendingCalls(label: string) {
  const corrections: Array<{ subjectId: string; resolve: (stored: HeldItem) => void; reject: (error: Error) => void }> = [];
  const erasures: Array<{ subjectId: string; resolve: (effect: DeletionEffect) => void; reject: (error: Error) => void }> = [];
  const c: HeldRecordClient = {
    read: async (subjectId) => [entry({ item: item({ subjectId, holdingClass: label }) })],
    correct: (subjectId) => new Promise((resolve, reject) => { corrections.push({ subjectId, resolve, reject }); }),
    forget: (subjectId) => new Promise((resolve, reject) => { erasures.push({ subjectId, resolve, reject }); }),
  };
  return { c, corrections, erasures };
}

function last<T>(calls: readonly T[]): T {
  const call = calls[calls.length - 1];
  if (call === undefined) throw new Error("no call has been made");
  return call;
}

/**
 * What the current surface can be showing when a later call is made, each
 * left by a real call to the current client: the erasure effect it reports,
 * or the failure in `error`.
 */
const shownStates: ReadonlyArray<{
  shown: string;
  show: (record: UseHeldRecordResult, calls: ReturnType<typeof pendingCalls>) => Promise<void>;
  error?: string;
  effect?: DeletionEffect;
}> = [
  ...(["erased", "unknown", "failed"] as const).map((effect) => ({
    shown: `the erasure effect "${effect}"`,
    show: (record: UseHeldRecordResult, calls: ReturnType<typeof pendingCalls>) => {
      const pending = record.forget("item_1");
      last(calls.erasures).resolve(effect);
      return pending;
    },
    effect,
  })),
  {
    shown: "a rejected erasure's error",
    show: (record, calls) => {
      const pending = record.forget("item_1");
      last(calls.erasures).reject(new Error("erasure failed"));
      return pending;
    },
    error: "erasure failed",
  },
  {
    shown: "a rejected correction's error",
    show: (record, calls) => {
      const pending = record.correct(item({ holdingClass: "corrected-notes" }));
      last(calls.corrections).reject(new Error("correction failed"));
      return pending;
    },
    error: "correction failed",
  },
];

const callTimeCases = (["client", "subject"] as const).flatMap((change) =>
  (["correct", "forget"] as const).flatMap((mutation) => shownStates.map((state) => ({ change, mutation, ...state }))),
);

/**
 * Renders the hook with one client and subject, keeps the callbacks of that
 * commit, then changes the client or the subject. For a subject change the
 * same client serves both subjects.
 */
async function afterChange(change: "client" | "subject") {
  const first = pendingCalls("first-client-notes");
  const current = change === "client" ? pendingCalls("current-client-notes") : first;
  const subjectId = change === "client" ? "sub_1" : "sub_2";
  const { result, rerender } = renderHook(({ c, subjectId: subject }) => useHeldRecord({ ...options(c), subjectId: subject }), {
    initialProps: { c: first.c, subjectId: "sub_1" },
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const outdated = result.current;
  rerender({ c: current.c, subjectId });
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.rows[0]?.entry.item).toMatchObject({
      subjectId,
      holdingClass: change === "client" ? "current-client-notes" : "first-client-notes",
    });
  });
  return { result, outdated, first, current };
}

function failure(record: UseHeldRecordResult): string | undefined {
  return (record.error as Error | undefined)?.message;
}

describe("useHeldRecord", () => {
  it("reads everything held about the person and renders a verdict per item", async () => {
    const { result } = render(client([entry()]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.holding).toEqual({ kind: "held", basis: { kind: "authored", sourceEventId: "evt_1" } });
  });

  it("renders an unjustifiable holding as unjustifiable to the person it is about", async () => {
    const unjustifiable = entry({ item: item({ provenance: { kind: "none", namedReason: "imported" } }), source: { status: "missing", namedReason: "no event on record" } });
    const { result } = render(client([unjustifiable]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows[0]?.holding).toMatchObject({ kind: "unjustifiable", fault: { kind: "no-source-event" } });
  });

  it("shows a belief that constrains without confirmation as unjustifiable, not as a normal holding", async () => {
    const constraining = entry({
      item: item({
        itemId: "item_belief",
        origin: "inferred",
        belief: { beliefClass: "scheduling-preference", inferredAt: "2026-08-01T00:00:00.000Z", use: { mode: "constrains", confirmation: null } },
      }),
    });
    const { result } = render(client([constraining]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows[0]?.holding).toMatchObject({ kind: "unjustifiable", fault: { kind: "belief-used-as-constraint" } });
  });

  it("drops an item about a different person rather than rendering it", async () => {
    // A surface showing one person another person's record would be the exact
    // defect `checkVisibility` reports, committed by the surface built to
    // prevent it.
    const { result } = render(client([entry(), entry({ item: item({ itemId: "item_other", subjectId: "sub_other" }) })]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((row) => row.entry.item.itemId)).toEqual(["item_1"]);
  });

  it("applies a correction through the same call shape as reading", async () => {
    const { result } = render(client([entry()]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.correct(item({ holdingClass: "corrected-notes" }));
    });
    expect(result.current.rows[0]?.entry.item.holdingClass).toBe("corrected-notes");
  });

  it.each(["correct", "forget"] as const)("applies the current client's reply to a %s from a child mount effect", async (mutation) => {
    const held = deferredMutations();
    let pending: Promise<void> | undefined;
    const { seen, Parent } = childCaller(
      () => true,
      (record) => (pending = mutation === "correct" ? record.correct(item({ holdingClass: "corrected-notes" })) : record.forget("item_1")),
    );
    renderComponent(createElement(Parent, { c: held.c }));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    expect(mutation === "correct" ? held.corrections : held.erasures).toHaveLength(1);

    // Replied after the read has landed, so the reply has a row to apply to.
    await act(async () => {
      if (mutation === "correct") held.corrections[0]!(item({ holdingClass: "corrected-notes" }));
      else held.erasures[0]!("erased");
      await pending;
    });
    if (mutation === "correct") {
      expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("corrected-notes");
    } else {
      expect(seen.current?.lastForgetEffect).toBe("erased");
      expect(seen.current?.rows).toHaveLength(0);
    }
  });

  it.each(["correct", "forget"] as const)("applies the replacement client's reply to a %s from a child effect after a client swap", async (mutation) => {
    const oldClient = client([entry()]);
    const oldCorrect = vi.spyOn(oldClient, "correct");
    const replacement = deferredMutations([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
    let pending: Promise<void> | undefined;
    const { seen, Parent } = childCaller(
      (c) => c === replacement.c,
      (record) => (pending = mutation === "correct" ? record.correct(item({ holdingClass: "corrected-notes" })) : record.forget("item_1")),
    );
    const { rerender } = renderComponent(createElement(Parent, { c: oldClient }));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    rerender(createElement(Parent, { c: replacement.c }));
    await waitFor(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
    expect(mutation === "correct" ? replacement.corrections : replacement.erasures).toHaveLength(1);
    expect(mutation === "correct" ? oldCorrect : oldClient.forget).not.toHaveBeenCalled();

    await act(async () => {
      if (mutation === "correct") replacement.corrections[0]!(item({ holdingClass: "corrected-notes" }));
      else replacement.erasures[0]!("erased");
      await pending;
    });
    if (mutation === "correct") {
      expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("corrected-notes");
    } else {
      expect(seen.current?.lastForgetEffect).toBe("erased");
      expect(seen.current?.rows).toHaveLength(0);
    }
  });

  it.each(["correct", "forget"] as const)("a deferred mutation reply from a replaced client is ignored (%s)", async (mutation) => {
    let resolveCorrection!: (stored: HeldItem) => void;
    let resolveForget!: (effect: DeletionEffect) => void;
    const oldClient: HeldRecordClient = {
      read: async () => [entry()],
      correct: () => new Promise((resolve) => { resolveCorrection = resolve; }),
      forget: () => new Promise((resolve) => { resolveForget = resolve; }),
    };
    const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
    const { result, rerender } = renderHook(({ c }) => useHeldRecord(options(c)), { initialProps: { c: oldClient } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending!: Promise<void>;
    act(() => {
      pending = mutation === "correct" ? result.current.correct(item()) : result.current.forget("item_1");
    });
    rerender({ c: replacement });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));

    await act(async () => {
      if (mutation === "correct") resolveCorrection(item({ holdingClass: "old-client-notes" }));
      else resolveForget("erased");
      await pending;
    });
    expect(result.current.rows[0]?.entry.item.holdingClass).toBe("new-client-notes");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.lastForgetEffect).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it.each(["correct", "forget"] as const)("ignores a deferred %s error from a replaced client", async (mutation) => {
    let rejectMutation!: (error: Error) => void;
    const deferred = () => new Promise<never>((_resolve, reject) => { rejectMutation = reject; });
    const oldClient: HeldRecordClient = { read: async () => [entry()], correct: deferred, forget: deferred };
    const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
    const { result, rerender } = renderHook(({ c }) => useHeldRecord(options(c)), { initialProps: { c: oldClient } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending!: Promise<void>;
    act(() => {
      pending = mutation === "correct" ? result.current.correct(item()) : result.current.forget("item_1");
    });
    rerender({ c: replacement });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
    await act(async () => {
      rejectMutation(new Error("old client failed"));
      await pending;
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.rows[0]?.entry.item.holdingClass).toBe("new-client-notes");
    expect(result.current.lastForgetEffect).toBeUndefined();
  });

  it.each(["correct", "forget"] as const)("ignores a deferred %s reply after the subject changes", async (mutation) => {
    let resolveCorrection!: (stored: HeldItem) => void;
    let resolveForget!: (effect: DeletionEffect) => void;
    const currentClient: HeldRecordClient = {
      read: async (subjectId) => [entry({ item: item({ subjectId }) })],
      correct: () => new Promise((resolve) => { resolveCorrection = resolve; }),
      forget: () => new Promise((resolve) => { resolveForget = resolve; }),
    };
    const { result, rerender } = renderHook(({ subjectId }) => useHeldRecord({ ...options(currentClient), subjectId }), {
      initialProps: { subjectId: "sub_1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = mutation === "correct" ? result.current.correct(item()) : result.current.forget("item_1");
    });
    rerender({ subjectId: "sub_2" });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.subjectId).toBe("sub_2"));
    await act(async () => {
      if (mutation === "correct") resolveCorrection(item({ holdingClass: "old-subject-notes" }));
      else resolveForget("erased");
      await pending;
    });
    expect(result.current.rows[0]?.entry.item.subjectId).toBe("sub_2");
    expect(result.current.lastForgetEffect).toBeUndefined();
  });

  it.each(currentClientReplies)("applies the reply to a child mount effect's call: $name", async ({ make, call, check }) => {
    const { seen, Parent } = childCaller(() => true, call);
    renderComponent(createElement(Parent, { c: make() }));
    await waitFor(() => check(seen.current!));
  });

  it.each(currentClientReplies)("applies the reply to a child effect's call in the same commit as a client swap: $name", async ({ make, call, check }) => {
    const oldClient = client([entry()]);
    const replacement = make();
    const { seen, Parent } = childCaller((c) => c === replacement, call);
    const { rerender } = renderComponent(createElement(Parent, { c: oldClient }));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    rerender(createElement(Parent, { c: replacement }));
    await waitFor(() => check(seen.current!));
  });

  it.each([
    ["client", "correct"],
    ["client", "forget"],
    ["subject", "correct"],
    ["subject", "forget"],
  ] as const)("ignores the reply to an outdated callback called after a %s change (%s)", async (change, mutation) => {
    const held = deferredMutations();
    const readsSubject: HeldRecordClient = { ...held.c, read: async (subjectId) => [entry({ item: item({ subjectId }) })] };
    const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
    const first = change === "client" ? held.c : readsSubject;
    const { result, rerender } = renderHook(({ c, subjectId }) => useHeldRecord({ ...options(c), subjectId }), {
      initialProps: { c: first, subjectId: "sub_1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const outdated = result.current;
    if (change === "client") rerender({ c: replacement, subjectId: "sub_1" });
    else rerender({ c: readsSubject, subjectId: "sub_2" });
    await waitFor(() =>
      expect(result.current.rows[0]?.entry.item).toMatchObject(change === "client" ? { holdingClass: "new-client-notes" } : { subjectId: "sub_2" }),
    );
    const before = result.current.rows[0]?.entry.item;

    // Called AFTER the change, through a callback held from before it: the
    // call goes to the old client or subject, so its reply is not the current
    // read's to apply.
    let pending!: Promise<void>;
    act(() => {
      pending = mutation === "correct" ? outdated.correct(item({ holdingClass: "outdated-notes" })) : outdated.forget("item_1");
    });
    await act(async () => {
      if (mutation === "correct") held.corrections[0]!(item({ holdingClass: "outdated-notes" }));
      else held.erasures[0]!("erased");
      await pending;
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.entry.item).toEqual(before);
    expect(result.current.lastForgetEffect).toBeUndefined();
  });

  it.each(callTimeCases)(
    "leaves the current surface's state alone when an outdated $mutation is called after a $change change: $shown",
    async ({ change, mutation, show, error, effect }) => {
      const { result, outdated, first, current } = await afterChange(change);
      await act(async () => {
        await show(result.current, current);
      });
      expect(failure(result.current)).toBe(error);
      expect(result.current.lastForgetEffect).toBe(effect);
      const rows = result.current.rows;

      // Called through a callback kept from before the change. The call
      // still goes to the client and subject it was made with, but it is not
      // the current surface's call, so it clears nothing the person is shown.
      const calls: ReadonlyArray<{ subjectId: string }> = mutation === "correct" ? first.corrections : first.erasures;
      const made = calls.length;
      let pending!: Promise<void>;
      act(() => {
        pending = mutation === "correct" ? outdated.correct(item({ holdingClass: "outdated-notes" })) : outdated.forget("item_1");
      });
      expect(calls).toHaveLength(made + 1);
      expect(last(calls).subjectId).toBe("sub_1");
      expect(failure(result.current)).toBe(error);
      expect(result.current.lastForgetEffect).toBe(effect);

      await act(async () => {
        if (mutation === "correct") last(first.corrections).resolve(item({ holdingClass: "outdated-notes" }));
        else last(first.erasures).resolve("erased");
        await pending;
      });
      expect(failure(result.current)).toBe(error);
      expect(result.current.lastForgetEffect).toBe(effect);
      expect(result.current.rows).toEqual(rows);
    },
  );

  it.each(callTimeCases)(
    "clears the current surface's state when the current $mutation is called after a $change change: $shown",
    async ({ change, mutation, show, error, effect }) => {
      const { result, current } = await afterChange(change);
      await act(async () => {
        await show(result.current, current);
      });
      expect(failure(result.current)).toBe(error);
      expect(result.current.lastForgetEffect).toBe(effect);

      // A call through the current callback clears `error`, and a forget
      // also clears `lastForgetEffect`, as the call is made rather than when
      // its reply arrives.
      let pending!: Promise<void>;
      act(() => {
        pending = mutation === "correct" ? result.current.correct(item({ holdingClass: "corrected-notes" })) : result.current.forget("item_1");
      });
      expect(result.current.error).toBeUndefined();
      expect(result.current.lastForgetEffect).toBe(mutation === "forget" ? undefined : effect);

      await act(async () => {
        if (mutation === "correct") last(current.corrections).resolve(item({ holdingClass: "corrected-notes" }));
        else last(current.erasures).resolve("unknown");
        await pending;
      });
      expect(result.current.error).toBeUndefined();
      expect(result.current.lastForgetEffect).toBe(mutation === "forget" ? "unknown" : effect);
    },
  );

  it("clears the replaced client's erasure effect when a child requests an erasure from its own effect in the same commit as a client swap", async () => {
    const oldClient = client([entry()], "erased");
    const replacement = deferredMutations([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
    const { seen, Parent } = childCaller((c) => c === replacement.c, (record) => record.forget("item_1"));
    const { rerender } = renderComponent(createElement(Parent, { c: oldClient }));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    await act(async () => {
      await seen.current!.forget("item_1");
    });
    expect(seen.current?.lastForgetEffect).toBe("erased");

    rerender(createElement(Parent, { c: replacement.c }));
    await waitFor(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
    expect(replacement.erasures).toHaveLength(1);
    expect(seen.current?.lastForgetEffect).toBeUndefined();
    await act(async () => {
      replacement.erasures[0]!("unknown");
    });
    expect(seen.current?.lastForgetEffect).toBe("unknown");
  });

  it("ignores pending replies from every client replaced in rapid succession", async () => {
    const first = deferredMutations();
    const second = deferredMutations();
    const latest = client([entry({ item: item({ holdingClass: "latest-client-notes" }) })]);
    const { result, rerender } = renderHook(({ c }) => useHeldRecord(options(c)), { initialProps: { c: first.c } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let fromFirst!: Promise<void>;
    act(() => {
      fromFirst = result.current.forget("item_1");
    });
    rerender({ c: second.c });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let fromSecond!: Promise<void>;
    act(() => {
      fromSecond = result.current.correct(item({ holdingClass: "second-client-notes" }));
    });
    rerender({ c: latest });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.holdingClass).toBe("latest-client-notes"));

    await act(async () => {
      second.corrections[0]!(item({ holdingClass: "second-client-notes" }));
      first.erasures[0]!("erased");
      await Promise.all([fromFirst, fromSecond]);
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.entry.item.holdingClass).toBe("latest-client-notes");
    expect(result.current.lastForgetEffect).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("settles a pending reply after unmount without throwing or logging", async () => {
    const { c, erasures } = deferredMutations();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { result, unmount } = render(c);
      await waitFor(() => expect(result.current.loading).toBe(false));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.forget("item_1");
      });
      unmount();
      erasures[0]!("erased");
      await expect(pending).resolves.toBeUndefined();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it.each(pendingReplies)("applies the current client's reply that arrives while an Activity boundary hides the hook: $name", async ({ call, reply, check }) => {
    // `Activity` tears the hook's effects down while hidden and keeps its
    // state. The client has not changed, so the reply is still this
    // surface's to show.
    const store = heldStore();
    const { seen, tree } = inActivity();
    const { rerender } = renderComponent(tree(store.c, "visible"));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = call(seen.current!);
    });
    rerender(tree(store.c, "hidden"));
    await act(async () => {
      reply(store);
      await pending;
    });
    check(seen.current!);
  });

  it.each(currentClientReplies)("applies the current client's reply to a call made before the hook has ever been shown: $name", async ({ make, call, check }) => {
    // Rendered hidden from the start, the hook's effects have not run, but
    // the client it was rendered with is committed, so the reply is that
    // client's to show.
    const c = make();
    const { seen, tree } = inActivity();
    const { rerender } = renderComponent(tree(c, "hidden"));
    await waitFor(() => expect(seen.current).toBeDefined());
    await act(async () => {
      await call(seen.current!);
    });
    check(seen.current!);

    rerender(tree(c, "visible"));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    await act(async () => {
      await call(seen.current!);
    });
    check(seen.current!);
  });

  it.each(pendingReplies)("applies the reply to a call made before a client swap and back, once the original client is current again: $name", async ({ call, reply, check }) => {
    // The guard compares the client a call went to with the client that is
    // committed when the reply lands. After A, B and A again, A is the
    // current client, so its reply is shown, whatever kind of reply it is.
    const first = heldStore();
    const second = client([entry({ item: item({ holdingClass: "second-client-notes" }) })]);
    const { result, rerender } = renderHook(({ c }) => useHeldRecord(options(c)), { initialProps: { c: first.c } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = call(result.current);
    });
    rerender({ c: second });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.holdingClass).toBe("second-client-notes"));
    rerender({ c: first.c });
    await waitFor(() => expect(result.current.rows[0]?.entry.item.holdingClass).toBe("authored-notes"));
    await act(async () => {
      reply(first);
      await pending;
    });
    check(result.current);
  });

  it.each(pendingReplies)("applies the reply to a call made before a subject change and back, once the original subject is current again: $name", async ({ call, reply, check }) => {
    // The same comparison for the subject: after sub_1, sub_2 and sub_1
    // again, sub_1 is the current subject, so the reply to a call made for
    // it is shown. The store's items are all about sub_1, so the surface
    // shows no rows while sub_2 is the subject.
    const store = heldStore();
    const { result, rerender } = renderHook(({ subjectId }) => useHeldRecord({ ...options(store.c), subjectId }), {
      initialProps: { subjectId: "sub_1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = call(result.current);
    });
    rerender({ subjectId: "sub_2" });
    await waitFor(() => {
      expect(store.reads).toEqual(["sub_1", "sub_2"]);
      expect(result.current.loading).toBe(false);
      expect(result.current.rows).toHaveLength(0);
    });
    rerender({ subjectId: "sub_1" });
    await waitFor(() => {
      expect(store.reads).toEqual(["sub_1", "sub_2", "sub_1"]);
      expect(result.current.loading).toBe(false);
      expect(result.current.rows).toHaveLength(1);
    });
    await act(async () => {
      reply(store);
      await pending;
    });
    check(result.current);
  });

  it("removes the row on a confirmed erasure", async () => {
    const c = client([entry()], "erased");
    const { result } = render(c);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.forget("item_1");
    });
    expect(c.forget).toHaveBeenCalledWith("sub_1", "item_1");
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.lastForgetEffect).toBe("erased");
  });

  it("KEEPS the row when the host could not confirm the erasure, and reports what it observed", async () => {
    for (const effect of ["failed", "unknown"] as const) {
      const { result } = render(client([entry()], effect));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.forget("item_1");
      });
      expect(result.current.rows).toHaveLength(1);
      expect(result.current.lastForgetEffect).toBe(effect);
    }
  });

  it("clears the previous result state before each mutation, so nothing stale is shown", async () => {
    // `error` is documented as the most recent client call's failure and
    // `lastForgetEffect` as the most recent forget's observed effect. A stale
    // `"erased"` surviving a later failed attempt would tell somebody their
    // record is gone on the strength of a different call.
    let effect: DeletionEffect = "erased";
    const flaky: HeldRecordClient = {
      read: async () => [entry(), entry({ item: item({ itemId: "item_2" }) })],
      correct: async (_subjectId, next) => next,
      forget: async () => effect,
    };
    const { result } = render(flaky);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.forget("item_1");
    });
    expect(result.current.lastForgetEffect).toBe("erased");

    effect = "failed";
    await act(async () => {
      await result.current.forget("item_2");
    });
    expect(result.current.lastForgetEffect).toBe("failed");
    expect(result.current.rows.map((row) => row.entry.item.itemId)).toEqual(["item_2"]);
  });

  it("clears a previous error when a later call succeeds", async () => {
    let fail = true;
    const flaky: HeldRecordClient = {
      read: async () => [entry()],
      correct: async (_subjectId, next) => {
        if (fail) throw new Error("the store rejected the correction");
        return next;
      },
      forget: async () => "erased",
    };
    const { result } = render(flaky);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.correct(item({ holdingClass: "corrected-notes" }));
    });
    expect((result.current.error as Error).message).toBe("the store rejected the correction");

    fail = false;
    await act(async () => {
      await result.current.correct(item({ holdingClass: "corrected-notes" }));
    });
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces a client error rather than throwing out of the hook", async () => {
    const failing: HeldRecordClient = {
      read: async () => {
        throw new Error("the store was unreachable");
      },
      correct: async (_subjectId, next) => next,
      forget: async () => "unknown",
    };
    const { result } = render(failing);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.error as Error).message).toBe("the store was unreachable");
    expect(result.current.rows).toEqual([]);
  });

  it("judges against the supplied instant, so the surface renders the same answer on the server and the client", async () => {
    const old = entry({ item: item({ heldSince: "2025-01-01T00:00:00.000Z" }) });
    const { result } = render(client([old]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows[0]?.holding.kind).toBe("forgotten");
  });
});

describe("useHeldRecord outside act, where a reply can land between a commit and its passive effects", () => {
  it.each(["erased", "unknown", "failed"] as const)("applies the effect of an erasure a child requests from a layout effect on first mount (%s)", async (effect) => {
    await outsideAct(async (root) => {
      const { seen, Parent } = layoutCaller(() => true, (record) => record.forget("item_1"));
      root.render(createElement(Parent, { c: client([entry()], effect) }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      expect(seen.current?.lastForgetEffect).toBe(effect);
    });
  });

  it.each(swaps)("applies the erasure a child requests from a layout effect in the same commit as a client swap made by %s", async (_name, swap) => {
    await outsideAct(async (root) => {
      const oldClient = client([entry()]);
      const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })], "erased");
      const { seen, Parent } = layoutCaller((c) => c === replacement, (record) => record.forget("item_1"));
      root.render(createElement(Parent, { c: oldClient }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      swap(() => root.render(createElement(Parent, { c: replacement })));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      expect(replacement.forget).toHaveBeenCalledTimes(1);
      expect(oldClient.forget).not.toHaveBeenCalled();
      expect(seen.current?.lastForgetEffect).toBe("erased");
    });
  });

  it.each(swaps)("clears the replaced client's erasure effect when a child requests an erasure from a layout effect in the same commit as a client swap made by %s", async (_name, swap) => {
    await outsideAct(async (root) => {
      const oldClient = client([entry()], "erased");
      const replacement = deferredMutations([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
      const { seen, Parent } = layoutCaller((c) => c === replacement.c, (record) => record.forget("item_1"));
      root.render(createElement(Parent, { c: oldClient }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      await seen.current!.forget("item_1");
      await settle(() => expect(seen.current?.lastForgetEffect).toBe("erased"));

      swap(() => root.render(createElement(Parent, { c: replacement.c })));
      await settle(() => expect(replacement.erasures).toHaveLength(1));
      // Cleared by the call itself: the replacement has not replied yet.
      await settle(() => expect(seen.current?.lastForgetEffect).toBeUndefined());
      replacement.erasures[0]!("unknown");
      await settle(() => expect(seen.current?.lastForgetEffect).toBe("unknown"));
    });
  });

  it.each(swaps)("applies an erasure called through the fresh callback after a swap made by %s commits, before its passive effects", async (_name, swap) => {
    await outsideAct(async (root) => {
      const oldClient = client([entry()]);
      const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })], "erased");
      const { seen, Parent } = layoutCaller((c) => c === replacement, (record) => record.forget("item_1"), "after-commit");
      root.render(createElement(Parent, { c: oldClient }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      swap(() => root.render(createElement(Parent, { c: replacement })));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      expect(replacement.forget).toHaveBeenCalledTimes(1);
      expect(seen.current?.lastForgetEffect).toBe("erased");
    });
  });

  it.each(swaps)("ignores a replaced client's erasure that lands after a swap made by %s commits, before its passive effects", async (_name, swap) => {
    await outsideAct(async (root) => {
      const first = deferredMutations();
      const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
      // The replaced client answers from inside the swap's commit, so its
      // reply is judged after that commit and before its passive effects.
      const { seen, Parent } = layoutCaller(
        (c) => c === replacement,
        async () => first.erasures[0]!("erased"),
      );
      root.render(createElement(Parent, { c: first.c }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      const pending = seen.current!.forget("item_1");
      expect(first.erasures).toHaveLength(1);
      swap(() => root.render(createElement(Parent, { c: replacement })));
      await pending;
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      expect(seen.current?.lastForgetEffect).toBeUndefined();
      expect(seen.current?.rows).toHaveLength(1);
    });
  });

  it.each(currentClientReplies)("applies the reply to a layout-effect call from a child mounted after the read landed: $name", async ({ make, call, check }) => {
    await outsideAct(async (root) => {
      const c = make();
      const { seen, Parent } = layoutCaller(() => true, call);
      root.render(createElement(Parent, { c, showChild: false }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      root.render(createElement(Parent, { c, showChild: true }));
      await settle(() => check(seen.current!));
    });
  });

  it("applies a stored correction a child requests from a layout effect on first mount", async () => {
    await outsideAct(async (root) => {
      const store = heldStore();
      const { seen, Parent } = layoutCaller(() => true, (record) => record.correct(item({ holdingClass: "corrected-notes" })));
      root.render(createElement(Parent, { c: store.c }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      expect(store.corrections).toHaveLength(1);
      store.corrections[0]!.resolve(item({ holdingClass: "corrected-notes" }));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("corrected-notes"));
      expect(store.reads).toHaveLength(1);
    });
  });

  it.each(swaps)("applies a stored correction a child requests from a layout effect in the same commit as a client swap made by %s", async (_name, swap) => {
    await outsideAct(async (root) => {
      const oldClient = client([entry()]);
      const oldCorrect = vi.spyOn(oldClient, "correct");
      const replacement = heldStore([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
      const { seen, Parent } = layoutCaller((c) => c === replacement.c, (record) => record.correct(item({ holdingClass: "corrected-notes" })));
      root.render(createElement(Parent, { c: oldClient }));
      await settle(() => expect(seen.current?.loading).toBe(false));
      swap(() => root.render(createElement(Parent, { c: replacement.c })));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      expect(replacement.corrections).toHaveLength(1);
      expect(oldCorrect).not.toHaveBeenCalled();
      replacement.corrections[0]!.resolve(item({ holdingClass: "corrected-notes" }));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("corrected-notes"));
      expect(replacement.reads).toHaveLength(1);
    });
  });
});

describe("useHeldRecord outside act, while the hook is hidden or its content has re-suspended", () => {
  it.each(pendingReplies)("applies the current client's reply that lands while an Activity boundary hides the hook, and keeps it once shown again: $name", async ({ call, reply, check, failure }) => {
    await outsideAct(async (root, container) => {
      const store = heldStore();
      const { seen, tree } = inActivity();
      root.render(tree(store.c, "visible"));
      await settle(() => expect(seen.current?.loading).toBe(false));
      const pending = call(seen.current!);
      root.render(tree(store.c, "hidden"));
      await settle(() => expect(probe(container).style.display).toBe("none"));
      reply(store);
      await pending;
      // Applied while hidden: the hidden hook renders again with the reply.
      await settle(() => check(seen.current!));

      // Shown again, `Activity` runs the read effect again. The read is held
      // until the hook has started it, so the check below sees its result.
      const releaseRead = store.holdReads();
      root.render(tree(store.c, "visible"));
      await settle(() => expect(probe(container).style.display).toBe(""));
      await settle(() => expect(seen.current?.loading).toBe(true));
      expect(store.reads).toHaveLength(2);
      releaseRead();
      await settle(() => expect(seen.current?.loading).toBe(false));
      if (failure) {
        // The new read's start clears `error`, as every read does; the row
        // the failed call left in place is still shown.
        expect(seen.current?.rows).toHaveLength(1);
        expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("authored-notes");
      } else {
        check(seen.current!);
      }
    });
  });

  it.each(pendingReplies)("applies the current client's reply that lands while the hook's content has re-suspended, and keeps it once the content returns: $name", async ({ call, reply, check }) => {
    await outsideAct(async (root, container) => {
      const store = heldStore();
      const { seen, tree } = inSuspense();
      root.render(tree(store.c));
      await settle(() => expect(seen.current?.loading).toBe(false));
      const pending = call(seen.current!);
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      root.render(tree(store.c, wait));
      await settle(() => expect(container.querySelector("p")?.textContent).toBe("fallback"));
      reply(store);
      await pending;
      release();
      await settle(() => expect(container.querySelector("p")).toBeNull());
      await settle(() => check(seen.current!));
      // The read did not run again, so what is shown is the hook's own record
      // of the reply rather than a fresh read.
      expect(store.reads).toHaveLength(1);
    });
  });

  it.each(["correct", "forget"] as const)("ignores a replaced client's %s reply when the swap and the reply both happen while an Activity boundary hides the hook", async (mutation) => {
    await outsideAct(async (root, container) => {
      const first = heldStore();
      let releaseRead: (() => void) | undefined;
      const replacement: HeldRecordClient = {
        read: () =>
          new Promise((resolve) => {
            releaseRead = () => resolve([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
          }),
        correct: async (_subjectId, next) => next,
        forget: async () => "erased",
      };
      const { seen, tree } = inActivity();
      root.render(tree(first.c, "visible", "first"));
      await settle(() => expect(seen.current?.loading).toBe(false));
      const pending = mutation === "correct" ? seen.current!.correct(item({ holdingClass: "old-client-notes" })) : seen.current!.forget("item_1");
      root.render(tree(first.c, "hidden", "first"));
      await settle(() => expect(probe(container).style.display).toBe("none"));
      root.render(tree(replacement, "hidden", "replacement"));
      // The swap has committed inside the hidden boundary.
      await settle(() => expect(probe(container).dataset.client).toBe("replacement"));
      if (mutation === "correct") first.corrections[0]!.resolve(item({ holdingClass: "old-client-notes" }));
      else first.erasures[0]!.resolve("erased");
      await pending;

      root.render(tree(replacement, "visible", "replacement"));
      await settle(() => expect(probe(container).style.display).toBe(""));
      // Until the replacement's read lands the surface still shows what it
      // held before; the replaced client's reply has not changed it.
      expect(seen.current?.rows).toHaveLength(1);
      expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("authored-notes");
      expect(seen.current?.lastForgetEffect).toBeUndefined();
      await settle(() => expect(releaseRead).toBeDefined());
      releaseRead!();
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      expect(seen.current?.rows).toHaveLength(1);
      expect(seen.current?.lastForgetEffect).toBeUndefined();
      expect(seen.current?.error).toBeUndefined();
    });
  });

  it("under StrictMode, applies the current client's reply and ignores a replaced client's", async () => {
    await outsideAct(async (root) => {
      const first = heldStore();
      const replacement = client([entry({ item: item({ holdingClass: "new-client-notes" }) })]);
      const seen: { current: UseHeldRecordResult | undefined; tick: number } = { current: undefined, tick: -1 };
      function Probe({ c, tick }: { c: HeldRecordClient; tick: number }) {
        seen.current = useHeldRecord(options(c));
        seen.tick = tick;
        return null;
      }
      const tree = (c: HeldRecordClient, tick: number) => createElement(StrictMode, null, createElement(Probe, { c, tick }));
      root.render(tree(first.c, 0));
      await settle(() => expect(seen.current?.loading).toBe(false));
      const applied = seen.current!.forget("item_1");
      first.erasures[0]!.resolve("unknown");
      await applied;
      await settle(() => expect(seen.current?.lastForgetEffect).toBe("unknown"));

      const ignored = seen.current!.forget("item_1");
      root.render(tree(replacement, 1));
      await settle(() => expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("new-client-notes"));
      first.erasures[1]!.resolve("erased");
      await ignored;
      // A later render processes any update the reply scheduled.
      root.render(tree(replacement, 2));
      await settle(() => expect(seen.tick).toBe(2));
      expect(seen.current?.lastForgetEffect).toBeUndefined();
      expect(seen.current?.rows).toHaveLength(1);
    });
  });

  it("ignores the reply to a call made during a render that has not committed", async () => {
    // A hook rendered by a transition that is still suspended has no
    // committed client, so there is no surface for the reply to update yet.
    await outsideAct(async (root) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const c = client([entry()], "erased");
        const never = new Promise<void>(() => undefined);
        let pending: Promise<void> | undefined;
        function UncommittedCaller() {
          const record = useHeldRecord(options(c));
          if (!pending) pending = record.forget("item_1");
          use(never);
          return null;
        }
        function Shell({ show }: { show: boolean }) {
          return show ? createElement(UncommittedCaller) : null;
        }
        root.render(createElement(Shell, { show: false }));
        startTransition(() => root.render(createElement(Shell, { show: true })));
        await settle(() => expect(pending).toBeDefined());
        await pending;
        expect(c.forget).toHaveBeenCalledTimes(1);
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    });
  });
});
