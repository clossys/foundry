import { describe, expect, it, vi } from "vitest";
import { admitInboundEvent, decideInboundAdmission } from "./index.js";
import type { InboundAdmissionInput, InboundEventLedger } from "./index.js";

const valid: InboundAdmissionInput = {
  provider: "resend",
  eventId: "evt_123",
  occurredAt: "2026-08-13T12:00:00.000Z",
  signature: "verified",
};

function fakeLedger(dedupe: "new" | "duplicate"): InboundEventLedger & { readonly recordIfNew: ReturnType<typeof vi.fn> } {
  return { recordIfNew: vi.fn(async () => dedupe) };
}

describe("admitInboundEvent", () => {
  it("processes a verified, new event", async () => {
    const ledger = fakeLedger("new");
    await expect(admitInboundEvent(valid, ledger)).resolves.toEqual({ ack: true, action: "process" });
    expect(ledger.recordIfNew).toHaveBeenCalledWith({ provider: "resend", eventId: "evt_123" });
  });

  it("acks and ignores a verified duplicate instead of erroring", async () => {
    const ledger = fakeLedger("duplicate");
    await expect(admitInboundEvent(valid, ledger)).resolves.toEqual({
      ack: true,
      action: "ignore",
      reason: { kind: "duplicate" },
    });
  });

  it("rejects (no ack) on an invalid signature, without ever touching the ledger", async () => {
    const ledger = fakeLedger("new");
    await expect(
      admitInboundEvent({ ...valid, signature: "invalid" }, ledger),
    ).resolves.toEqual({ ack: false, reason: "signature-invalid" });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("fails closed on an unrecognized signature value, without touching the ledger", async () => {
    const ledger = fakeLedger("new");
    await expect(
      admitInboundEvent(
        { ...valid, signature: "not-a-real-value" as unknown as "verified" },
        ledger,
      ),
    ).resolves.toEqual({ ack: false, reason: "signature-invalid" });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("fails closed when signature is omitted entirely — there is no default", async () => {
    const ledger = fakeLedger("new");
    const { signature, ...withoutSignature } = valid;
    await expect(
      admitInboundEvent(withoutSignature as unknown as InboundAdmissionInput, ledger),
    ).resolves.toEqual({ ack: false, reason: "signature-invalid" });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("acks and ignores a missing/blank eventId instead of processing or erroring", async () => {
    const ledger = fakeLedger("new");
    await expect(admitInboundEvent({ ...valid, eventId: "" }, ledger)).resolves.toEqual({
      ack: true,
      action: "ignore",
      reason: { kind: "malformed", field: "eventId", message: "must be a non-empty string" },
    });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("acks and ignores a missing provider instead of processing or erroring", async () => {
    const ledger = fakeLedger("new");
    const { provider, ...withoutProvider } = valid;
    await expect(
      admitInboundEvent(withoutProvider as unknown as InboundAdmissionInput, ledger),
    ).resolves.toEqual({
      ack: true,
      action: "ignore",
      reason: { kind: "malformed", field: "provider", message: "must be a non-empty string" },
    });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("acks and ignores an unparseable timestamp instead of processing or erroring", async () => {
    const ledger = fakeLedger("new");
    await expect(
      admitInboundEvent({ ...valid, occurredAt: "not-a-date" }, ledger),
    ).resolves.toEqual({
      ack: true,
      action: "ignore",
      reason: { kind: "malformed", field: "occurredAt", message: "must be a parseable timestamp" },
    });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  it("checks signature before structural fields — an unverified, also-malformed event is rejected, not ignored", async () => {
    const ledger = fakeLedger("new");
    await expect(
      admitInboundEvent({ ...valid, signature: "invalid", eventId: "" }, ledger),
    ).resolves.toEqual({ ack: false, reason: "signature-invalid" });
    expect(ledger.recordIfNew).not.toHaveBeenCalled();
  });

  /**
   * The whole point of this module: exhaustively confirm no input
   * combination yields `{ ack: true, action: "process" }` unless the
   * signature was verified AND the ledger reported the event as new.
   */
  it("never processes unless verified AND new — exhaustive over signature x dedupe x malformed fields", async () => {
    const dedupeOutcomes = ["new", "duplicate"] as const;
    const signatureValues = ["verified", "invalid", "unknown-value", undefined] as const;
    const overrides: Array<Partial<InboundAdmissionInput>> = [
      {},
      { eventId: "" },
      { provider: "" },
      { occurredAt: "not-a-date" },
    ];

    for (const dedupe of dedupeOutcomes) {
      for (const signature of signatureValues) {
        for (const override of overrides) {
          const ledger = fakeLedger(dedupe);
          const input = {
            ...valid,
            ...override,
            signature: signature as InboundAdmissionInput["signature"],
          };
          const decision = await admitInboundEvent(input, ledger);

          const isFullyValid = signature === "verified" && Object.keys(override).length === 0;
          if (decision.ack && decision.action === "process") {
            expect(isFullyValid, JSON.stringify({ dedupe, signature, override })).toBe(true);
            expect(dedupe).toBe("new");
          }
        }
      }
    }
  });
});

describe("decideInboundAdmission (pure core)", () => {
  it("is synchronously testable against a plain dedupe value, no ledger required", () => {
    expect(decideInboundAdmission(valid, "new")).toEqual({ ack: true, action: "process" });
    expect(decideInboundAdmission(valid, "duplicate")).toEqual({
      ack: true,
      action: "ignore",
      reason: { kind: "duplicate" },
    });
  });

  it("ignores the dedupe value entirely once signature or structure already failed closed", () => {
    const invalidSignature = { ...valid, signature: "invalid" as const };
    expect(decideInboundAdmission(invalidSignature, "new")).toEqual({ ack: false, reason: "signature-invalid" });
    expect(decideInboundAdmission(invalidSignature, "duplicate")).toEqual({ ack: false, reason: "signature-invalid" });
  });
});

describe("admitInboundEvent — an unreachable ledger rejects rather than acking", () => {
  it("propagates a ledger failure instead of acking an event it could not dedupe", async () => {
    const failing: InboundEventLedger = {
      recordIfNew: () => Promise.reject(new Error("ledger unavailable")),
    };
    await expect(
      admitInboundEvent(
        { provider: "p", eventId: "e1", occurredAt: "2026-08-13T00:00:00Z", signature: "verified" },
        failing,
      ),
    ).rejects.toThrow("ledger unavailable");
  });

  it("does not consult the ledger at all when the signature is unverified", async () => {
    let called = false;
    const ledger: InboundEventLedger = {
      recordIfNew: async () => {
        called = true;
        return "new";
      },
    };
    const decision = await admitInboundEvent(
      { provider: "p", eventId: "e1", occurredAt: "2026-08-13T00:00:00Z", signature: "invalid" },
      ledger,
    );
    expect(decision).toEqual({ ack: false, reason: "signature-invalid" });
    expect(called).toBe(false);
  });
});
