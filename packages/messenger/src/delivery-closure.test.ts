import { describe, expect, it } from "vitest";
import { checkDeliveryClosure, validateDeliveryClosureInput } from "./delivery-closure.js";
import type { AuthorizationEvidence, DeliveryClosureInput, DeliveryClosureRecord } from "./types.js";

function authorization(intentId: string): AuthorizationEvidence {
  return {
    id: `authorization-${intentId}`,
    intentId,
    policy: "transactional-v1",
    authorizedAt: "2026-08-23T09:59:00.000Z",
  };
}

const due: DeliveryClosureRecord = {
  intentId: "intent-1",
  authorization: authorization("intent-1"),
  windowOpensAt: "2026-08-23T10:00:00.000Z",
  windowClosesAt: "2026-08-23T10:05:00.000Z",
  observation: {
    eventId: "event-1",
    evidenceSource: "signed-provider-webhook",
    outcome: "delivered",
    observedAt: "2026-08-23T10:04:01.000Z",
    deliveredAt: "2026-08-23T10:04:00.000Z",
  },
};

function input(records: DeliveryClosureRecord[], setpoint = 1): DeliveryClosureInput {
  return { evaluatedAt: "2026-08-23T10:10:00.000Z", setpoint, records };
}

describe("delivery closure metric", () => {
  it("uses timely independently observed deliveries as numerator and due authorized intents as denominator", () => {
    const result = checkDeliveryClosure(input([
      due,
      { ...due, intentId: "intent-2", authorization: authorization("intent-2"), observation: undefined },
    ], 0.5));
    expect(result).toMatchObject({ state: "satisfied", numerator: 1, denominator: 2, value: 0.5 });
    expect(result.missingIntentIds).toEqual(["intent-2"]);
  });

  it("violates when the observed rate is below setpoint", () => {
    const result = checkDeliveryClosure(input([
      due,
      {
        ...due,
        intentId: "intent-2",
        authorization: authorization("intent-2"),
        observation: {
          ...due.observation!,
          eventId: "event-2",
          observedAt: "2026-08-23T10:07:00.000Z",
          deliveredAt: "2026-08-23T10:06:00.000Z",
        },
      },
      {
        ...due,
        intentId: "intent-3",
        authorization: authorization("intent-3"),
        observation: { ...due.observation!, eventId: "event-3", outcome: "failed", deliveredAt: undefined },
      },
    ], 0.9));
    expect(result).toMatchObject({ state: "violated", numerator: 1, denominator: 3, value: 1 / 3 });
    expect(result.lateIntentIds).toEqual(["intent-2"]);
    expect(result.failedIntentIds).toEqual(["intent-3"]);
  });

  it("is indeterminate, never perfect, when no delivery window is due", () => {
    const result = checkDeliveryClosure({
      evaluatedAt: "2026-08-23T10:01:00.000Z",
      setpoint: 1,
      records: [{ ...due, observation: undefined }],
    });
    expect(result).toMatchObject({ state: "indeterminate", numerator: 0, denominator: 0, value: null });
  });

  it("does not count delivery before the declared window", () => {
    const result = checkDeliveryClosure(input([{
      ...due,
      observation: { ...due.observation!, deliveredAt: "2026-08-23T09:59:59.000Z" },
    }]));
    expect(result).toMatchObject({ state: "violated", numerator: 0, denominator: 1 });
    expect(result.lateIntentIds).toEqual(["intent-1"]);
  });

  it("rejects structurally incomplete or temporally impossible evidence", () => {
    const findings = validateDeliveryClosureInput(input([{
      ...due,
      authorization: { ...authorization("intent-1"), id: "", policy: "" },
      observation: { ...due.observation!, observedAt: "2026-08-23T10:03:00.000Z", deliveredAt: "2026-08-23T10:04:00.000Z" },
    }], 0));
    expect(findings.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      "setpoint",
      "records[0].authorization.id",
      "records[0].authorization.policy",
      "records[0].observation.deliveredAt",
    ]));
  });

  it("requires a non-empty record set so an empty scan cannot pass", () => {
    expect(validateDeliveryClosureInput(input([]))).toContainEqual({
      field: "records",
      message: "must be a non-empty array",
    });
  });

  it("rejects authorization evidence bound to a different intent", () => {
    const findings = validateDeliveryClosureInput(input([{
      ...due,
      authorization: { ...due.authorization, intentId: "different-intent" },
    }]));
    expect(findings).toContainEqual({
      field: "records[0].authorization.intentId",
      message: "must equal intentId",
    });
  });

  it("rejects future authorization evidence", () => {
    const findings = validateDeliveryClosureInput(input([{
      ...due,
      authorization: { ...due.authorization, authorizedAt: "2026-08-23T10:11:00.000Z" },
    }]));
    expect(findings).toContainEqual({
      field: "records[0].authorization.authorizedAt",
      message: "must not follow evaluatedAt",
    });
  });

  it("rejects a free authorization id where structured binding is required", () => {
    const malformed = {
      ...input([due]),
      records: [{ ...due, authorization: "authorization-1" }],
    };
    expect(validateDeliveryClosureInput(malformed)).toContainEqual({
      field: "records[0].authorization",
      message: "must be an evidence object",
    });
  });
});
