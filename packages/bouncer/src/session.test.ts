/**
 * `isAuthorized` — the runtime predicate, and the exact place the package's
 * central claim bites: a session that EXISTS is not a grant that is CURRENT.
 * Every case here is a session that is present and shaped correctly enough to
 * fool a presence check, and is still denied.
 */
import { describe, expect, it, vi } from "vitest";
import { isAuthorized } from "./index.js";

describe("isAuthorized", () => {
  it("fails closed before calling a predicate for missing, invalid, or expired sessions", async () => {
    const predicate = vi.fn(() => true);

    await expect(isAuthorized(predicate, null, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, { subjectId: "   " }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: new Date(Number.NaN),
    }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, { subjectId: undefined } as never, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: "2026-01-01T00:00:00.000Z",
    } as never, {})).resolves.toBe(false);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("denies predicate errors and accepts only an explicit successful decision", async () => {
    await expect(isAuthorized(() => {
      throw new Error("decision failed");
    }, { subjectId: "person" }, {})).resolves.toBe(false);
    await expect(isAuthorized(() => true, { subjectId: "person" }, {})).resolves.toBe(true);
    await expect(isAuthorized(() => false, { subjectId: "person" }, {})).resolves.toBe(false);
    await expect(isAuthorized((() => "allowed") as never, { subjectId: "person" }, {})).resolves.toBe(false);
  });
});
