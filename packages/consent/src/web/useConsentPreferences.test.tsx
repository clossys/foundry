// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConsentPreferences, type ConsentPreferencesClient } from "./useConsentPreferences.js";
import type { ConsentRecord } from "../types.js";

const V1 = { policyId: "cookie-policy", version: "1" };
const PRESERVE = { invalidateDenialOnPolicyBump: false };

function makeClient(initial: readonly ConsentRecord[]): ConsentPreferencesClient {
  let stored = [...initial];
  return {
    read: vi.fn(async () => stored),
    apply: vi.fn(async (subjectId, action) => {
      const record: ConsentRecord =
        action.kind === "withdraw"
          ? { subjectId, category: action.category, state: { kind: "absent" } }
          : { subjectId, category: action.category, state: { kind: action.kind === "grant" ? "granted" : "denied", policyVersion: action.policyVersion, decidedAt: "2026-08-13T00:00:00.000Z" } };
      stored = [...stored.filter((r) => r.category !== action.category), record];
      return record;
    }),
  };
}

describe("useConsentPreferences", () => {
  it("starts loading and resolves to absent evaluations when the client has nothing stored", async () => {
    const client = makeClient([]);
    const { result } = renderHook(() => useConsentPreferences({ subjectId: "sub-1", categories: ["marketing"], policyVersion: V1, evaluationPolicy: PRESERVE, client }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.evaluations.marketing).toEqual({ status: "absent" });
    expect(result.current.error).toBeUndefined();
  });

  it("evaluates an already-stored record on load", async () => {
    const client = makeClient([{ subjectId: "sub-1", category: "marketing", state: { kind: "granted", policyVersion: V1, decidedAt: "2026-01-01T00:00:00.000Z" } }]);
    const { result } = renderHook(() => useConsentPreferences({ subjectId: "sub-1", categories: ["marketing"], policyVersion: V1, evaluationPolicy: PRESERVE, client }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.evaluations.marketing).toEqual({ status: "granted", policyVersion: V1 });
  });

  it("grant/deny/withdraw share the same call shape and each round-trips through client.apply", async () => {
    const client = makeClient([]);
    const { result } = renderHook(() => useConsentPreferences({ subjectId: "sub-1", categories: ["marketing"], policyVersion: V1, evaluationPolicy: PRESERVE, client }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.grant("marketing"));
    expect(result.current.evaluations.marketing).toEqual({ status: "granted", policyVersion: V1 });

    await act(async () => result.current.deny("marketing"));
    expect(result.current.evaluations.marketing).toEqual({ status: "denied", policyVersion: V1 });

    await act(async () => result.current.withdraw("marketing"));
    expect(result.current.evaluations.marketing).toEqual({ status: "absent" });

    expect(client.apply).toHaveBeenCalledTimes(3);
  });

  it("surfaces a client.read failure on error without throwing", async () => {
    const client: ConsentPreferencesClient = {
      read: vi.fn(async () => {
        throw new Error("read failed");
      }),
      apply: vi.fn(),
    };
    const { result } = renderHook(() => useConsentPreferences({ subjectId: "sub-1", categories: ["marketing"], policyVersion: V1, evaluationPolicy: PRESERVE, client }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
