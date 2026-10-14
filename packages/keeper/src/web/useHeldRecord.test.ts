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
import { Activity, createElement, useEffect } from "react";
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

/** The hook inside an `Activity` boundary, whose effects are torn down while hidden but whose state is kept. */
function inActivity() {
  const seen: { current: UseHeldRecordResult | undefined } = { current: undefined };
  function Probe({ c }: { c: HeldRecordClient }) {
    seen.current = useHeldRecord(options(c));
    return null;
  }
  const tree = (c: HeldRecordClient, mode: "visible" | "hidden") => createElement(Activity, { mode, children: createElement(Probe, { c }) });
  return { seen, tree };
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

  it.each(["correct", "forget"] as const)("calls the current client for a %s from a child mount effect", async (mutation) => {
    const currentClient = client([entry()]);
    const correct = vi.spyOn(currentClient, "correct");
    function Child({ record }: { record: UseHeldRecordResult }) {
      useEffect(() => {
        void (mutation === "correct" ? record.correct(item()) : record.forget("item_1"));
      }, []);
      return null;
    }
    function Parent() {
      return createElement(Child, { record: useHeldRecord(options(currentClient)) });
    }
    renderComponent(createElement(Parent));
    await waitFor(() => expect(mutation === "correct" ? correct : currentClient.forget).toHaveBeenCalledTimes(1));
  });

  it.each(["correct", "forget"] as const)("calls the replacement client for a %s from a child effect after a client swap", async (mutation) => {
    const oldClient = client([entry()]);
    const replacement = client([entry()]);
    const oldCorrect = vi.spyOn(oldClient, "correct");
    const replacementCorrect = vi.spyOn(replacement, "correct");
    function Child({ record, c }: { record: UseHeldRecordResult; c: HeldRecordClient }) {
      useEffect(() => {
        if (c === replacement) void (mutation === "correct" ? record.correct(item()) : record.forget("item_1"));
      }, [c]);
      return null;
    }
    function Parent({ c }: { c: HeldRecordClient }) {
      return createElement(Child, { record: useHeldRecord(options(c)), c });
    }
    const { rerender } = renderComponent(createElement(Parent, { c: oldClient }));
    rerender(createElement(Parent, { c: replacement }));
    await waitFor(() => expect(mutation === "correct" ? replacementCorrect : replacement.forget).toHaveBeenCalledTimes(1));
    expect(mutation === "correct" ? oldCorrect : oldClient.forget).not.toHaveBeenCalled();
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

  it("settles a pending reply after unmount without updating or logging", async () => {
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
      expect(result.current.lastForgetEffect).toBeUndefined();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it.each(["correct", "forget"] as const)("ignores a %s reply that arrives while hidden, after the read was cancelled", async (mutation) => {
    // `Activity` tears the read effect down while hidden and keeps the
    // hook's state, so a reply applied to a cancelled read would show.
    const { c, corrections, erasures } = deferredMutations();
    const { seen, tree } = inActivity();
    const { rerender } = renderComponent(tree(c, "visible"));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = mutation === "correct" ? seen.current!.correct(item({ holdingClass: "hidden-reply-notes" })) : seen.current!.forget("item_1");
    });
    rerender(tree(c, "hidden"));
    await act(async () => {
      if (mutation === "correct") corrections[0]!(item({ holdingClass: "hidden-reply-notes" }));
      else erasures[0]!("erased");
      await pending;
    });
    expect(seen.current?.rows).toHaveLength(1);
    expect(seen.current?.rows[0]?.entry.item.holdingClass).toBe("authored-notes");
    expect(seen.current?.lastForgetEffect).toBeUndefined();
  });

  it.each(currentClientReplies)("ignores a reply that arrives before the read has ever started, then applies one after: $name", async ({ make, call, check }) => {
    // Rendered hidden from the start, the hook's read effect has not run, so
    // there is no live read for the reply to belong to.
    const c = make();
    const { seen, tree } = inActivity();
    const { rerender } = renderComponent(tree(c, "hidden"));
    await waitFor(() => expect(seen.current).toBeDefined());
    await act(async () => {
      await call(seen.current!);
    });
    expect(seen.current?.lastForgetEffect).toBeUndefined();
    expect(seen.current?.error).toBeUndefined();

    rerender(tree(c, "visible"));
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    await act(async () => {
      await call(seen.current!);
    });
    check(seen.current!);
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
