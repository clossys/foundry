import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

const dirs: string[] = [];

function evidence(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "messenger-check-"));
  dirs.push(dir);
  const path = join(dir, "evidence.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function record(windowClosesAt: string, deliveredAt?: string) {
  return {
    intentId: "intent-1",
    authorization: {
      id: "authorization-1",
      intentId: "intent-1",
      policy: "transactional-v1",
      authorizedAt: "2026-08-23T09:59:00.000Z",
    },
    windowOpensAt: "2026-08-23T10:00:00.000Z",
    windowClosesAt,
    ...(deliveredAt === undefined ? {} : {
      observation: {
        eventId: "event-1",
        evidenceSource: "signed-provider-webhook",
        outcome: "delivered",
        observedAt: "2026-08-23T10:09:00.000Z",
        deliveredAt,
      },
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("messenger-check delivery-closure", () => {
  it("returns 0 for a satisfied observed metric", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z", "2026-08-23T10:04:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(0);
  });

  it("returns 1 for a measured violation", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(1);
  });

  it("returns 2 when no intent is due", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:01:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(2);
  });

  it("returns 2 for unreadable, malformed, or schema-invalid evidence", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main(["delivery-closure", "/not/a/real/evidence-file.json"])).toBe(2);
    expect(main(["delivery-closure", evidence({ records: [] })])).toBe(2);
    expect(main([])).toBe(2);
  });
});
