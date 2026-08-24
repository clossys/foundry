import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { AudienceResponseEvent, ResponseYieldInput, ResponseYieldRecord } from "./types.js";

const dirs: string[] = [];

function responseEvent(id: string): AudienceResponseEvent {
  return {
    eventId: id,
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    actionKind: "qualified-reply",
    occurredAt: "2026-08-23T10:05:00.000Z",
  };
}

function responseYieldRecord(events: AudienceResponseEvent[] = [responseEvent("response-one")]): ResponseYieldRecord {
  return {
    intentId: "intent-one",
    subjectId: "product-one",
    actionKind: "publish",
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    channelId: "channel-one",
    authority: {
      id: "authority-one", intentId: "intent-one", subjectId: "product-one", actorId: "agent-one",
      humanOwnerId: "owner-one", allowedActions: ["publish"], channelIds: ["channel-one"],
      issuedAt: "2026-08-23T09:00:00.000Z", expiresAt: "2026-08-23T11:00:00.000Z", paidSpendCeiling: 0,
    },
    windowOpensAt: "2026-08-23T10:00:00.000Z",
    windowClosesAt: "2026-08-23T10:10:00.000Z",
    exposures: { state: "observed", evidenceSource: "channel-report", observedAt: "2026-08-23T10:11:00.000Z", count: 2_000 },
    responses: { state: "observed", evidenceSource: "response-report", observedAt: "2026-08-23T10:11:00.000Z", events },
  };
}

function responseYieldInput(records: ResponseYieldRecord[] = [responseYieldRecord()]): ResponseYieldInput {
  return {
    evaluatedAt: "2026-08-23T10:12:00.000Z",
    setpointPerThousand: 2,
    minimumExposureCount: 1_000,
    qualifiedActionKinds: ["qualified-reply"],
    records,
  };
}

function evidence(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "influencer-check-"));
  dirs.push(dir);
  const path = join(dir, "evidence.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("influencer-check response-yield", () => {
  it("returns 1 for a measured violation", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(["response-yield", evidence(responseYieldInput())])).toBe(1);
  });

  it("returns 0 for a satisfied metric", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const next = responseYieldRecord(Array.from({ length: 5 }, (_, index) => ({
      eventId: `response-${index}`,
      experimentId: "experiment-one",
      contentId: "content-one",
      publicationId: "publication-one",
      actionKind: "qualified-reply",
      occurredAt: "2026-08-23T10:05:00.000Z",
    })));
    expect(main(["response-yield", evidence(responseYieldInput([next]))])).toBe(0);
  });

  it("returns 2 for indeterminate or invalid evidence", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const next = responseYieldRecord();
    next.exposures = { state: "could-not-read", evidenceSource: "channel-report", note: "unreachable" };
    expect(main(["response-yield", evidence(responseYieldInput([next]))])).toBe(2);
    expect(main(["response-yield", evidence({ records: [] })])).toBe(2);
    expect(main([])).toBe(2);
  });
});
