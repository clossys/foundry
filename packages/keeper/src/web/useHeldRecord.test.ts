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
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeletionEffect, HeldItem } from "../schema.js";
import { useHeldRecord, type HeldRecordClient, type HeldRecordEntry } from "./useHeldRecord.js";

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
