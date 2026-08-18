import { describe, expect, it } from "vitest";
import { defineRevocationPath, isRevoked, latestRevocation, recordRevocation } from "./index.js";

describe("defineRevocationPath", () => {
  it("records where revocation authority lives without performing revocation", () => {
    const path = defineRevocationPath({
      key: "APP_SIGNING_KEY",
      authority: "infisical-project:prod",
      procedure: "runbook: rotate-signing-key",
    });

    expect(path.authority).toBe("infisical-project:prod");
    expect(path.procedure).toBe("runbook: rotate-signing-key");
    expect(Object.isFrozen(path)).toBe(true);
  });

  it("omits procedure entirely when not supplied", () => {
    const path = defineRevocationPath({ key: "K", authority: "issuer" });
    expect(Object.hasOwn(path, "procedure")).toBe(false);
  });
});

describe("recordRevocation", () => {
  it("builds a frozen, value-free record", () => {
    const record = recordRevocation({
      key: "APP_SIGNING_KEY",
      revokedAt: "2026-08-01T00:00:00.000Z",
      revokedBy: "team-platform",
      reason: "suspected exposure",
    });

    expect(record.key).toBe("APP_SIGNING_KEY");
    expect(record.revokedBy).toBe("team-platform");
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("rejects an unparsable revocation date rather than storing it", () => {
    expect(() =>
      recordRevocation({ key: "K", revokedAt: "not-a-date", revokedBy: null }),
    ).toThrow(RangeError);
  });
});

describe("isRevoked / latestRevocation", () => {
  it("finds whether a key was revoked and, if so, its most recent record", () => {
    const records = [
      recordRevocation({ key: "K", revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "a" }),
      recordRevocation({ key: "K", revokedAt: "2026-06-01T00:00:00.000Z", revokedBy: "b" }),
      recordRevocation({ key: "OTHER", revokedAt: "2026-03-01T00:00:00.000Z", revokedBy: "c" }),
    ];

    expect(isRevoked(records, "K")).toBe(true);
    expect(isRevoked(records, "NEVER_REVOKED")).toBe(false);
    expect(latestRevocation(records, "K")?.revokedBy).toBe("b");
    expect(latestRevocation(records, "NEVER_REVOKED")).toBeUndefined();
  });
});
