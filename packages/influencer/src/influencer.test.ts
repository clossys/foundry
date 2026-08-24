import { describe, expect, it, vi } from "vitest";
import { InfluencerActionError } from "./errors.js";
import { createInfluencer } from "./influencer.js";
import type {
  CompletedPresenceActionResult,
  PresenceActionIntent,
  PresenceActionLedger,
} from "./types.js";

const publishIntent = {
  id: "intent-one",
  installationId: "presence-one",
  subjectId: "product-one",
  experimentId: "experiment-one",
  channelId: "channel-one",
  actionKind: "publish" as const,
  requestedAt: "2026-08-23T10:00:00.000Z",
  authority: {
    id: "authority-one",
    intentId: "intent-one",
    subjectId: "product-one",
    actorId: "agent-one",
    humanOwnerId: "owner-one",
    allowedActions: ["publish" as const],
    channelIds: ["channel-one"],
    issuedAt: "2026-08-23T09:00:00.000Z",
    expiresAt: "2026-08-23T11:00:00.000Z",
    paidSpendCeiling: 0 as const,
  },
  contentId: "content-one",
  publicationId: "publication-one",
};

function ledger(): PresenceActionLedger & {
  completed: Map<string, CompletedPresenceActionResult>;
  claims: number;
} {
  const inFlight = new Map<string, string>();
  const completed = new Map<string, CompletedPresenceActionResult>();
  let sequence = 0;
  return {
    completed,
    get claims() { return sequence; },
    async claim(intent) {
      if (inFlight.has(intent.id) || completed.has(intent.id)) return { state: "duplicate" };
      const leaseId = `lease-${++sequence}`;
      inFlight.set(intent.id, leaseId);
      return { state: "claimed", leaseId };
    },
    async complete(claim, result) {
      if (inFlight.get(result.intentId) !== claim.leaseId) throw new Error("stale lease");
      inFlight.delete(result.intentId);
      completed.set(result.intentId, result);
    },
  };
}

function intentFor(kind: PresenceActionIntent["actionKind"]): PresenceActionIntent {
  const base = {
    ...publishIntent,
    id: `intent-${kind}`,
    actionKind: kind,
    authority: {
      ...publishIntent.authority,
      intentId: `intent-${kind}`,
      allowedActions: [kind],
    },
  };
  if (kind === "configure-presence") return { ...base, actionKind: kind, presenceRevision: "presence-v2" };
  if (kind === "reply") {
    return {
      ...base,
      actionKind: kind,
      inReplyToId: "inbound-one",
      admissionEvidenceId: "admission-one",
    };
  }
  return { ...base, actionKind: kind };
}

describe("createInfluencer", () => {
  it("requires authority, actuator, and atomic durable ledger ports", () => {
    expect(() => createInfluencer({ authority: undefined, actuator: { execute: vi.fn() }, ledger: ledger() } as never))
      .toThrow("current authority policy");
    expect(() => createInfluencer({ authority: () => ({ state: "authorized" }), actuator: undefined, ledger: ledger() } as never))
      .toThrow("presence actuator");
    expect(() => createInfluencer({ authority: () => ({ state: "authorized" }), actuator: { execute: vi.fn() }, ledger: undefined } as never))
      .toThrow("durable action ledger");
  });

  it.each(["configure-presence", "publish", "reply"] as const)("executes and durably completes %s", async (kind) => {
    const durable = ledger();
    const execute = vi.fn(async () => ({
      provider: "injected-provider",
      remoteActionId: `remote-${kind}`,
      observedAt: "2026-08-23T10:00:01.000Z",
    }));
    const intent = intentFor(kind);
    const result = await createInfluencer({
      authority: () => ({ state: "authorized" }),
      actuator: { execute },
      ledger: durable,
    }).act(intent);
    expect(result).toMatchObject({ state: "applied", actionKind: kind });
    expect(execute).toHaveBeenCalledWith(intent);
    expect(durable.completed.get(intent.id)).toEqual(result);
  });

  it("durably completes a denial without invoking the actuator", async () => {
    const durable = ledger();
    const execute = vi.fn();
    const result = await createInfluencer({
      authority: () => ({ state: "denied", reason: "human-approval-required" }),
      actuator: { execute },
      ledger: durable,
    }).act(publishIntent);
    expect(result).toMatchObject({ state: "skipped", reason: "human-approval-required" });
    expect(durable.completed.get(publishIntent.id)).toEqual(result);
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves unverifiable authority uncompleted and reclaimable", async () => {
    const durable = ledger();
    const execute = vi.fn();
    const result = await createInfluencer({
      authority: () => ({ state: "unverifiable", reason: "authority-source-unreachable" }),
      actuator: { execute },
      ledger: durable,
    }).act(publishIntent);
    expect(result).toMatchObject({ state: "unverifiable" });
    expect(durable.claims).toBe(1);
    expect(durable.completed.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves thrown or malformed authority uncompleted rather than fabricating a decision", async () => {
    for (const authority of [
      () => { throw new Error("authority unavailable"); },
      () => ({ state: "denied", reason: "" } as const),
    ]) {
      const durable = ledger();
      await expect(createInfluencer({
        authority,
        actuator: { execute: vi.fn() },
        ledger: durable,
      }).act(publishIntent)).rejects.toThrow();
      expect(durable.completed.size).toBe(0);
    }
  });

  it("normalizes and durably records an actuator failure", async () => {
    const durable = ledger();
    const result = await createInfluencer({
      authority: () => ({ state: "authorized" }),
      actuator: {
        async execute() {
          throw new InfluencerActionError("rate-limited", "Provider rate limited the action", {
            retryable: true,
            provider: "injected-provider",
          });
        },
      },
      ledger: durable,
    }).act(publishIntent);
    expect(result).toMatchObject({ state: "failed", failure: { code: "rate-limited", retryable: true } });
    expect(durable.completed.get(publishIntent.id)).toEqual(result);
  });

  it("deduplicates a completed action before authority and actuation", async () => {
    const durable = ledger();
    const authority = vi.fn(() => ({ state: "authorized" as const }));
    const execute = vi.fn(async () => ({
      provider: "injected-provider",
      remoteActionId: "remote-one",
      observedAt: "2026-08-23T10:00:01.000Z",
    }));
    const influencer = createInfluencer({ authority, actuator: { execute }, ledger: durable });
    await influencer.act(publishIntent);
    await expect(influencer.act(publishIntent)).resolves.toMatchObject({ state: "duplicate" });
    expect(authority).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not report applied when durable completion fails", async () => {
    await expect(createInfluencer({
      authority: () => ({ state: "authorized" }),
      actuator: {
        async execute() {
          return { provider: "injected", remoteActionId: "remote", observedAt: "2026-08-23T10:00:01.000Z" };
        },
      },
      ledger: {
        async claim() { return { state: "claimed", leaseId: "lease-one" }; },
        async complete() { throw new Error("ledger unavailable"); },
      },
    }).act(publishIntent)).rejects.toThrow("ledger unavailable");
  });
});
