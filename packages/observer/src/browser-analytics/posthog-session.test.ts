import { describe, expect, it } from "vitest";
import {
  BOTH,
  initOnly,
  setPage,
  snapshotProperties,
  start,
  validSnapshot,
} from "./posthog-fake.test.js";

function resetsAndOptIns(names: string[]): string[] {
  return names.filter((name) => name === "reset" || name === "opt_in_capturing" || name === "opt_out_capturing");
}

describe("P-39 posthog-session: every grant starts a new session (C-69)", () => {
  it.each([
    ["autocapture", { autocapture: true }],
    ["replay", { replay: true }],
    ["both flags", BOTH],
  ])("a withdrawal calls reset() after opt_out_capturing() when a flag is on: %s", (_label, flags) => {
    setPage();
    const { fake, provider } = start(flags);
    const before = fake.calls.length;
    provider.optOut();
    const names = fake.calls.slice(before).map((call) => call.name);
    expect(names.indexOf("reset")).toBeGreaterThan(names.indexOf("opt_out_capturing"));
    expect(names.filter((name) => name === "reset")).toHaveLength(1);
  });

  it("with both flags off, no reset() is ever called, on a withdrawal or a re-grant", () => {
    setPage();
    for (const flags of [{}, { autocapture: false, replay: false }]) {
      const { fake, provider } = start(flags);
      provider.optOut();
      provider.optIn();
      provider.optOut();
      expect(fake.names()).not.toContain("reset");
    }
  });

  it("the first grant makes no reset() call; a re-grant calls reset() before opt_in_capturing()", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    expect(resetsAndOptIns(fake.names())).toEqual(["opt_in_capturing"]);
    provider.optOut();
    const before = fake.calls.length;
    provider.optIn();
    expect(resetsAndOptIns(fake.calls.slice(before).map((call) => call.name))).toEqual(["reset", "opt_in_capturing"]);
  });

  it("a repeated optOut() repeats the stop steps, and the re-grant after it still resets before opting in", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    provider.optIn();
    provider.optOut();
    provider.optOut();
    provider.optIn();
    expect(resetsAndOptIns(fake.names())).toEqual(["opt_in_capturing", "opt_out_capturing", "reset", "opt_out_capturing", "reset", "reset", "opt_in_capturing"]);
  });

  it("a re-grant starts replay on the new session id and records it", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const first = fake.session.id as string;
    provider.optOut();
    provider.optIn();
    const second = fake.session.id as string;
    expect(second).not.toBe(first);
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(2);
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), second))).not.toBeNull();
    expect((fake.sent.at(-1) as { properties: Record<string, unknown> }).properties.$session_id).toBe(second);
  });

  it("a session id equal to an earlier one leaves replay off for that grant", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    fake.session.rotateOnReset = false;
    provider.optOut();
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), fake.session.id as string))).toBeNull();
    // Nothing else about the grant changes: the gate is open.
    expect(fake.calls.filter((call) => call.name === "opt_in_capturing").at(-1)?.name).toBe("opt_in_capturing");
  });

  it("a session id equal to any earlier one, not only the latest, leaves replay off", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const first = fake.session.id;
    provider.optOut();
    provider.optIn();
    expect(fake.session.id).not.toBe(first);
    provider.optOut();
    fake.session.rotateOnReset = false;
    fake.session.id = first;
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(2);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a number", 7],
    ["an object", { id: "x" }],
  ])("a session id that is %s leaves replay off for that grant", (_label, id) => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    fake.session.rotateOnReset = false;
    fake.session.id = id;
    provider.optIn();
    expect(fake.names()).toContain("get_session_id");
    expect(fake.names()).not.toContain("startSessionRecording");
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), id as string))).toBeNull();
  });

  it("an unusable session id at a grant leaves replay off and a later usable one starts it", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    fake.session.id = "";
    fake.session.rotateOnReset = false;
    provider.optIn();
    expect(fake.names()).not.toContain("startSessionRecording");
    provider.optOut();
    fake.session.id = "fresh-session";
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), "fresh-session"))).not.toBeNull();
  });

  it("a get_session_id that throws leaves replay off for that grant without failing it", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH, { throwIn: ["get_session_id"] });
    expect(() => provider.optIn()).not.toThrow();
    expect(fake.names()).not.toContain("startSessionRecording");
  });

  it("a $snapshot carrying an earlier session id is dropped", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const first = fake.session.id as string;
    provider.optOut();
    provider.optIn();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), first))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), fake.session.id as string))).not.toBeNull();
  });

  it("a $snapshot with a missing or non-string session id, or an id the adapter did not record, is dropped", () => {
    setPage();
    const { fake } = start(BOTH);
    for (const id of [undefined, null, 1, "", "other-session"]) {
      const properties = snapshotProperties(validSnapshot());
      properties.$session_id = id;
      expect(fake.emit("$snapshot", properties)).toBeNull();
    }
    const missing = snapshotProperties(validSnapshot());
    delete missing.$session_id;
    expect(fake.emit("$snapshot", missing)).toBeNull();
  });

  it("a session id the SDK rotates during a grant drops every later snapshot of that grant and replay is not restarted", () => {
    setPage();
    const { fake } = start(BOTH);
    const recorded = fake.session.id as string;
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), recorded))).not.toBeNull();
    fake.session.id = "rotated-by-sdk";
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), "rotated-by-sdk"))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), "rotated-again"))).toBeNull();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
  });

  it("a snapshot flushed after the stop is dropped, whatever its session id", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const recorded = fake.session.id as string;
    provider.optOut();
    const before = fake.sent.length;
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), recorded))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), fake.session.id as string))).toBeNull();
    expect(fake.sent).toHaveLength(before);
  });

  it("a snapshot flushed between a withdrawal and the next grant, with the old id, is dropped after the grant too", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const old = fake.session.id as string;
    provider.optOut();
    provider.optIn();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), old))).toBeNull();
  });

  it("a withdrawal during the grant, before replay started, leaves the recorded id unset so no snapshot passes", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    fake.inside.get_session_id = () => {
      fake.inside.get_session_id = undefined;
      provider.optOut();
    };
    provider.optIn();
    expect(fake.names()).not.toContain("startSessionRecording");
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), "session-1"))).toBeNull();
  });
});
