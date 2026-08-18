import { describe, expect, it } from "vitest";
import { isCouldNotRead, isObserved, isUnobserved, type Observation } from "./observation.js";

type Payload = { readonly count: number };

describe("Observation", () => {
  it("narrows to the observed branch and exposes the payload", () => {
    const observation: Observation<Payload> = { state: "observed", count: 3 };
    expect(isObserved(observation)).toBe(true);
    if (isObserved(observation)) {
      expect(observation.count).toBe(3);
    }
    expect(isCouldNotRead(observation)).toBe(false);
    expect(isUnobserved(observation)).toBe(false);
  });

  it("narrows to the unobserved branch and carries no payload", () => {
    const observation: Observation<Payload> = { state: "unobserved", source: "fixture" };
    expect(isUnobserved(observation)).toBe(true);
    expect(isObserved(observation)).toBe(false);
    expect(isCouldNotRead(observation)).toBe(false);
  });

  it("narrows to the could-not-read branch and requires a note", () => {
    const observation: Observation<Payload> = {
      state: "could-not-read",
      note: "no credential for this run history source",
    };
    expect(isCouldNotRead(observation)).toBe(true);
    if (isCouldNotRead(observation)) {
      expect(observation.note.length).toBeGreaterThan(0);
    }
    expect(isObserved(observation)).toBe(false);
    expect(isUnobserved(observation)).toBe(false);
  });

  it("keeps could-not-read distinct from a pass — it is never treated as observed-with-zero-payload", () => {
    // A regression here would mean some code path treats "could not read"
    // the same as "read, and found nothing" — exactly the collapse this
    // package exists to refuse.
    const couldNotRead: Observation<Payload> = { state: "could-not-read", note: "unreadable" };
    const unobserved: Observation<Payload> = { state: "unobserved" };
    expect(couldNotRead.state).not.toBe(unobserved.state);
    expect(isObserved(couldNotRead)).toBe(false);
  });
});
