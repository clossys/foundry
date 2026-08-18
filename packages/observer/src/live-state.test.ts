import { describe, expect, it } from "vitest";
import {
  OBSERVER_TELEMETRY_LOG_SURFACE,
  liveStateFindingKinds,
  validateLiveStateSurface,
  type LiveStateSurface,
} from "./live-state.js";

describe("validateLiveStateSurface", () => {
  const base: LiveStateSurface = {
    store: "an S3 bucket the platform team owns",
    readableByScript: true,
    readableBy: "aws s3 ls via the platform-readonly role",
    note: "A green offline check here is not evidence the bucket exists or is written to.",
  };

  it("accepts a well-formed, readable declaration", () => {
    expect(validateLiveStateSurface(base)).toEqual([]);
  });

  it("accepts a well-formed, unreadable declaration that names a reconciler instead", () => {
    const surface: LiveStateSurface = {
      store: "a private admin dashboard",
      readableByScript: false,
      reconciledBy: "a human checking the dashboard weekly",
      note: "A green offline check here is not evidence the dashboard reflects reality.",
    };
    expect(validateLiveStateSurface(surface)).toEqual([]);
  });

  it("requires readableBy when readableByScript is true", () => {
    const surface = { ...base, readableBy: undefined };
    const problems = validateLiveStateSurface(surface);
    expect(problems.some((p) => p.includes("readableBy"))).toBe(true);
  });

  it("requires reconciledBy when readableByScript is false", () => {
    const surface: LiveStateSurface = {
      store: "somewhere",
      readableByScript: false,
      note: "A green offline check is not evidence the work is live.",
    };
    const problems = validateLiveStateSurface(surface);
    expect(problems.some((p) => p.includes("reconciledBy"))).toBe(true);
  });

  it("requires an explicit boolean for readableByScript, never an implicit value", () => {
    const surface = { ...base, readableByScript: undefined as unknown as boolean };
    const problems = validateLiveStateSurface(surface);
    expect(problems.some((p) => p.includes("explicit boolean"))).toBe(true);
  });

  it("requires a non-empty note", () => {
    const surface = { ...base, note: "" };
    const problems = validateLiveStateSurface(surface);
    expect(problems.some((p) => p.includes("note is required"))).toBe(true);
  });

  it("requires a non-empty store", () => {
    const surface = { ...base, store: "  " };
    const problems = validateLiveStateSurface(surface);
    expect(problems.some((p) => p.includes("store"))).toBe(true);
  });
});

describe("liveStateFindingKinds", () => {
  it("includes declared-but-not-verifiable, the addition issue #255 says matters most", () => {
    expect(liveStateFindingKinds).toContain("declared-but-not-verifiable");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(liveStateFindingKinds)).toBe(true);
  });
});

describe("OBSERVER_TELEMETRY_LOG_SURFACE", () => {
  it("is itself a valid declaration", () => {
    expect(validateLiveStateSurface(OBSERVER_TELEMETRY_LOG_SURFACE)).toEqual([]);
  });

  it("declares readableByScript false and names a reconciler, honestly reflecting that this package owns no store", () => {
    expect(OBSERVER_TELEMETRY_LOG_SURFACE.readableByScript).toBe(false);
    expect(OBSERVER_TELEMETRY_LOG_SURFACE.reconciledBy).toBeDefined();
  });

  it("states the green-offline-check caveat in its own note", () => {
    expect(OBSERVER_TELEMETRY_LOG_SURFACE.note.toLowerCase()).toContain("green");
    expect(OBSERVER_TELEMETRY_LOG_SURFACE.note.toLowerCase()).toContain("not evidence");
  });
});
