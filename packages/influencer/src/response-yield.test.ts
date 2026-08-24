import { describe, expect, it } from "vitest";
import { checkResponseYield, validateResponseYieldInput } from "./response-yield.js";
import type { AudienceResponseEvent, ResponseYieldInput, ResponseYieldRecord } from "./types.js";

function event(id: string, actionKind = "qualified-reply"): AudienceResponseEvent {
  return {
    eventId: id,
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    actionKind,
    occurredAt: "2026-08-23T10:05:00.000Z",
  };
}

function record(events: AudienceResponseEvent[] = [event("response-one")]): ResponseYieldRecord {
  return {
    intentId: "intent-one",
    subjectId: "product-one",
    actionKind: "publish",
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    channelId: "channel-one",
    authority: {
      id: "authority-one",
      intentId: "intent-one",
      subjectId: "product-one",
      actorId: "agent-one",
      humanOwnerId: "owner-one",
      allowedActions: ["publish"],
      channelIds: ["channel-one"],
      issuedAt: "2026-08-23T09:00:00.000Z",
      expiresAt: "2026-08-23T11:00:00.000Z",
      paidSpendCeiling: 0,
    },
    windowOpensAt: "2026-08-23T10:00:00.000Z",
    windowClosesAt: "2026-08-23T10:10:00.000Z",
    exposures: {
      state: "observed",
      evidenceSource: "independent-channel-report",
      observedAt: "2026-08-23T10:11:00.000Z",
      count: 2_000,
    },
    responses: {
      state: "observed",
      evidenceSource: "independent-response-report",
      observedAt: "2026-08-23T10:11:00.000Z",
      events,
    },
  };
}

function input(records: ResponseYieldRecord[] = [record()]): ResponseYieldInput {
  return {
    evaluatedAt: "2026-08-23T10:12:00.000Z",
    setpointPerThousand: 2,
    minimumExposureCount: 1_000,
    qualifiedActionKinds: ["qualified-reply", "product-evaluation"],
    records,
  };
}

describe("qualified response yield", () => {
  it("violates at one qualified response per two thousand exposures", () => {
    expect(checkResponseYield(input())).toMatchObject({
      state: "violated",
      qualifiedResponseCount: 1,
      eligibleExposureCount: 2_000,
      valuePerThousand: 0.5,
    });
  });

  it("satisfies at five qualified responses per two thousand exposures", () => {
    const events = Array.from({ length: 5 }, (_, index) => event(`response-${index + 1}`));
    expect(checkResponseYield(input([record(events)]))).toMatchObject({
      state: "satisfied",
      qualifiedResponseCount: 5,
      eligibleExposureCount: 2_000,
      valuePerThousand: 2.5,
    });
  });

  it("treats an observed empty response set as a measured zero and violation", () => {
    expect(checkResponseYield(input([record([])]))).toMatchObject({
      state: "violated",
      qualifiedResponseCount: 0,
      eligibleExposureCount: 2_000,
      valuePerThousand: 0,
    });
  });

  it("treats an explicit unobserved response read as a measured zero", () => {
    const next = record();
    next.responses = {
      state: "unobserved",
      evidenceSource: "independent-response-report",
      observedAt: "2026-08-23T10:11:00.000Z",
    };
    expect(checkResponseYield(input([next]))).toMatchObject({ state: "violated", valuePerThousand: 0 });
  });

  it("is indeterminate when a due evidence source could not be read", () => {
    const next = record();
    next.responses = {
      state: "could-not-read",
      evidenceSource: "independent-response-report",
      note: "provider unavailable",
    };
    expect(checkResponseYield(input([next]))).toMatchObject({ state: "indeterminate", valuePerThousand: null });
  });

  it("is indeterminate when no window is due or exposure is below the floor", () => {
    const notDue = record();
    notDue.windowClosesAt = "2026-08-23T10:20:00.000Z";
    expect(checkResponseYield(input([notDue]))).toMatchObject({
      state: "indeterminate",
      recordsDue: 0,
    });
    const next = record();
    if (next.exposures.state === "observed") next.exposures.count = 999;
    expect(checkResponseYield(input([next]))).toMatchObject({ state: "indeterminate", eligibleExposureCount: 999 });
  });

  it("does not count an unqualified or out-of-window response", () => {
    const outside = event("response-outside");
    outside.occurredAt = "2026-08-23T10:10:01.000Z";
    const result = checkResponseYield(input([record([event("response-unqualified", "like"), outside])]));
    expect(result).toMatchObject({ state: "violated", qualifiedResponseCount: 0, unqualifiedResponseCount: 2 });
  });

  it("rejects mismatched join keys, duplicate events, and authority not bound to the intent", () => {
    const malformed = record([event("duplicate"), event("duplicate")]);
    if (malformed.responses.state === "observed") malformed.responses.events[0]!.publicationId = "other-publication";
    malformed.authority.intentId = "other-intent";
    const fields = validateResponseYieldInput(input([malformed])).map((finding) => finding.field);
    expect(fields).toEqual(expect.arrayContaining([
      "records[0].authority.intentId",
      "records[0].responses.events[0].publicationId",
      "records[0].responses.events[1].eventId",
    ]));
  });

  it("rejects positive paid spend in metric authority evidence", () => {
    const malformed = record();
    malformed.authority.paidSpendCeiling = 1;
    expect(validateResponseYieldInput(input([malformed]))).toContainEqual({
      field: "records[0].authority.paidSpendCeiling",
      message: "must be exactly zero in v1",
    });
  });
});
