// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PolicyVersion, StandingAction, StandingInstruction } from "../schema.js";
import { useStandingWants, type StandingWantsClient } from "./useStandingWants.js";

const v3: PolicyVersion = { policyId: "wants", version: "3" };
const currency = { days: 90 };

function storedGrant(overrides: Partial<StandingInstruction> = {}): StandingInstruction {
  return {
    instructionId: "ins_1",
    subjectId: "sub_1",
    topic: "email",
    state: { kind: "granted", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" },
    provenance: "stated",
    currency,
    ...overrides,
  };
}

function fakeClient(stored: readonly StandingInstruction[]): StandingWantsClient & { apply: ReturnType<typeof vi.fn> } {
  const apply = vi.fn(async (subjectId: string, action: StandingAction): Promise<StandingInstruction> => {
    if (action.kind === "withdraw") {
      return { instructionId: "ins_1", subjectId, topic: action.topic, state: { kind: "absent" }, provenance: "stated", currency: action.currency };
    }
    return {
      instructionId: "ins_1",
      subjectId,
      topic: action.topic,
      state: { kind: action.kind === "grant" ? "granted" : "denied", policyVersion: action.policyVersion, decidedAt: "2026-02-01T00:00:00.000Z" },
      provenance: "stated",
      currency: action.currency,
    };
  });
  return { read: async () => stored, apply };
}

function options(client: StandingWantsClient, now: string) {
  return { subjectId: "sub_1", topics: ["email"], policyVersion: v3, currency, evaluationPolicy: { invalidateDenialOnPolicyBump: true }, now, client };
}

describe("useStandingWants", () => {
  it("evaluates a stored grant that is still inside its window as granted", async () => {
    const client = fakeClient([storedGrant()]);
    const { result } = renderHook(() => useStandingWants(options(client, "2026-01-02T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.evaluations.email).toEqual({ status: "granted", policyVersion: v3 });
  });

  it("evaluates the same stored grant as stale once its declared window has run out", async () => {
    const client = fakeClient([storedGrant()]);
    const { result } = renderHook(() => useStandingWants(options(client, "2026-06-01T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.evaluations.email).toMatchObject({ status: "stale", reason: "window-elapsed" });
  });

  it("reports a topic with nothing stored as absent, never as a falsy value that could read either way", async () => {
    const client = fakeClient([]);
    const { result } = renderHook(() => useStandingWants(options(client, "2026-01-02T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.evaluations.email).toEqual({ status: "absent", reason: "no-record" });
  });

  it("offers withdraw through the same call shape as grant and deny", async () => {
    const client = fakeClient([]);
    const { result } = renderHook(() => useStandingWants(options(client, "2026-02-02T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const fn of [result.current.grant, result.current.deny, result.current.withdraw]) {
      expect(fn).toBeTypeOf("function");
      expect(fn.length).toBe(1);
    }
  });

  it("returns a withdrawal to absent rather than to a denial", async () => {
    const client = fakeClient([storedGrant()]);
    const { result } = renderHook(() => useStandingWants(options(client, "2026-02-02T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.withdraw("email");
    });
    expect(client.apply).toHaveBeenCalledWith("sub_1", { kind: "withdraw", topic: "email", policyVersion: v3, currency });
    expect(result.current.evaluations.email).toEqual({ status: "absent", reason: "no-record" });
  });

  it("surfaces a failed read as an error rather than as an empty, permissive state", async () => {
    const failing: StandingWantsClient = {
      read: async () => {
        throw new Error("store unreachable");
      },
      apply: async () => {
        throw new Error("unused");
      },
    };
    const { result } = renderHook(() => useStandingWants(options(failing, "2026-02-02T00:00:00.000Z")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.error as Error).message).toBe("store unreachable");
    // The evaluation is still `absent` — which is correct and is the point:
    // an unreadable store never becomes permission, it becomes "we do not
    // have a want here", alongside a visible error.
    expect(result.current.evaluations.email).toEqual({ status: "absent", reason: "no-record" });
  });
});
