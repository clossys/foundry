import { describe, expect, it } from "vitest";
import { createPostHogProvider } from "./providers/posthog.js";
import {
  BOTH,
  CHAIN_PARTS,
  chain,
  clickProperties,
  configFor,
  createFake,
  flush,
  initOnly,
  setPage,
  start,
  transportFor,
  type FlagOptions,
} from "./posthog-fake.test.js";

const COMBINATIONS: ReadonlyArray<[string, FlagOptions]> = [
  ["both flags off", {}],
  ["autocapture", { autocapture: true }],
  ["replay", { replay: true }],
  ["both flags", BOTH],
];

describe("P-37 posthog-lifecycle: the capture gate and withdrawal ordering (C-67)", () => {
  it.each(COMBINATIONS)("zero SDK calls before any grant and after the stop steps return: %s", async (_label, flags) => {
    setPage();
    const fake = createFake();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let evaluated = 0;
    const { transport } = transportFor(async () => {
      evaluated += 1;
      await gate;
      return createPostHogProvider(fake.sdk, configFor(flags));
    });
    transport.pageview({ href: "https://example.test/a" });
    transport.conversion("signup_started", { href: "https://example.test/a" });
    await flush();
    expect(evaluated).toBe(0);
    expect(fake.inits).toEqual([]);
    expect(fake.calls).toEqual([]);

    transport.setPermission(true);
    release?.();
    await flush();
    expect(fake.inits).toHaveLength(1);
    transport.pageview({ href: "https://example.test/a" });
    transport.setPermission(false);
    const after = fake.calls.length;
    const initsAfter = fake.inits.length;

    transport.pageview({ href: "https://example.test/b" });
    transport.conversion("signup_started", { href: "https://example.test/b" });
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    fake.emit("$snapshot", { $snapshot_data: [], $session_id: "session-1" });
    await flush();
    expect(fake.calls).toHaveLength(after);
    expect(fake.inits).toHaveLength(initsAfter);
    expect(fake.hostCalls).toEqual([]);
    expect(fake.sent.filter((event) => ["$autocapture", "$snapshot"].includes(String(event.event)))).toEqual([]);
  });

  it("a load resolving after a withdrawal makes no init, opt_in_capturing or startSessionRecording call", async () => {
    setPage();
    const fake = createFake();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { transport } = transportFor(async () => {
      await gate;
      return createPostHogProvider(fake.sdk, configFor(BOTH));
    });
    transport.setPermission(true);
    await flush();
    transport.setPermission(false);
    release?.();
    await flush();
    transport.pageview({ href: "https://example.test/a" });
    await flush();
    expect(fake.inits).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(fake.hostCalls).toEqual([]);
    expect(fake.sent).toEqual([]);
  });

  it("the gate is closed at every SDK call optOut() makes, and open at the call that starts recording", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    const startCall = fake.calls.find((call) => call.name === "startSessionRecording");
    expect(startCall?.gate).toBe(true);
    const before = fake.calls.length;
    provider.optOut();
    const stops = fake.calls.slice(before);
    expect(stops.map((call) => call.name)).toEqual(["stopSessionRecording", "opt_out_capturing", "reset"]);
    for (const call of stops) expect(call.gate).toBe(false);
  });

  it("with replay off, a withdrawal runs opt_out_capturing then reset, with the gate closed", () => {
    setPage();
    const { fake, provider } = start({ autocapture: true });
    const before = fake.calls.length;
    provider.optOut();
    expect(fake.calls.slice(before)).toEqual([
      { name: "opt_out_capturing", gate: false },
      { name: "reset", gate: false },
    ]);
  });

  it.each(["stopSessionRecording", "opt_out_capturing", "reset"])("a throwing %s leaves the gate closed and the later steps still run", (method) => {
    setPage();
    const { fake, provider } = start(BOTH, { throwIn: [method] });
    const before = fake.calls.length;
    expect(() => provider.optOut()).not.toThrow();
    expect(fake.calls.slice(before).map((call) => call.name)).toEqual(["stopSessionRecording", "opt_out_capturing", "reset"]);
    for (const call of fake.calls.slice(before)) expect(call.gate).toBe(false);
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.sent.filter((event) => event.event !== "$opt_in")).toEqual([]);
  });

  it("an optIn() re-entered during the stop steps runs only after them, as a re-grant with a new session", () => {
    for (const during of ["stopSessionRecording", "opt_out_capturing", "reset"]) {
      setPage();
      const { fake, provider } = start(BOTH);
      const firstSession = fake.session.id;
      fake.inside[during] = () => {
        fake.inside[during] = undefined;
        provider.optIn();
      };
      const before = fake.calls.length;
      provider.optOut();
      expect(fake.calls.slice(before).map((call) => call.name)).toEqual([
        "stopSessionRecording",
        "opt_out_capturing",
        "reset",
        "reset",
        "opt_in_capturing",
        "get_session_id",
        "startSessionRecording",
      ]);
      // The stop steps ran with the gate closed; the grant that follows opens it.
      expect(fake.calls.slice(before, before + 3).every((call) => call.gate === false)).toBe(true);
      expect(fake.calls.at(-1)?.gate).toBe(true);
      expect(fake.session.id).not.toBe(firstSession);
    }
  });

  it("an optOut() during the stop steps does nothing", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    fake.inside.opt_out_capturing = () => provider.optOut();
    const before = fake.calls.length;
    provider.optOut();
    expect(fake.calls.slice(before).map((call) => call.name)).toEqual(["stopSessionRecording", "opt_out_capturing", "reset"]);
  });

  it("an optOut() during optIn() closes the gate at once and stops the grant before replay starts", () => {
    for (const during of ["reset", "opt_in_capturing", "get_session_id"]) {
      setPage();
      const { fake, provider } = initOnly(BOTH);
      provider.optIn(); // first grant, no hook
      provider.optOut();
      fake.calls.length = 0;
      fake.inside[during] = () => {
        fake.inside[during] = undefined;
        provider.optOut();
      };
      provider.optIn();
      expect(fake.names()).not.toContain("startSessionRecording");
      // The withdrawal ran its own full stop steps, with the gate closed.
      const last = fake.calls.slice(-2);
      expect(last.map((call) => call.name)).toEqual(["opt_out_capturing", "reset"]);
      expect(last.every((call) => call.gate === false)).toBe(true);
      fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
      expect(fake.sent.filter((event) => event.event === "$autocapture")).toEqual([]);
    }
  });

  it("an optIn() during optIn() changes nothing", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    fake.inside.opt_in_capturing = () => provider.optIn();
    provider.optIn();
    expect(fake.names().filter((name) => name === "opt_in_capturing")).toHaveLength(1);
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
  });

  it("capture() makes no SDK call before the first grant, after a withdrawal and while the gate is closed", () => {
    setPage();
    const before = initOnly(BOTH);
    before.provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(before.fake.calls).toEqual([]);

    const { fake, provider } = start(BOTH);
    provider.optOut();
    const after = fake.calls.length;
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    provider.capture({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: {} });
    expect(fake.calls).toHaveLength(after);
  });

  it("an SDK callback that withdraws inside capture() leaves the gate closed", () => {
    setPage();
    const { fake, provider } = start(BOTH);
    fake.inside["capture:$pageview"] = () => provider.optOut();
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(fake.sent.filter((event) => event.event === "$autocapture")).toEqual([]);
  });

  it("through the transport, a subscriber that re-grants inside the stop steps is applied after them", async () => {
    setPage();
    const fake = createFake();
    const { transport } = transportFor(() => createPostHogProvider(fake.sdk, configFor(BOTH)));
    transport.setPermission(true);
    await flush();
    fake.inside.opt_out_capturing = () => {
      fake.inside.opt_out_capturing = undefined;
      transport.setPermission(true);
    };
    const before = fake.calls.length;
    transport.setPermission(false);
    const names = fake.calls.slice(before).map((call) => call.name);
    expect(names.slice(0, 3)).toEqual(["stopSessionRecording", "opt_out_capturing", "reset"]);
    expect(fake.calls.slice(before, before + 3).every((call) => call.gate === false)).toBe(true);
    // Whatever the transport does with the re-entrant grant, no SDK call runs inside the stop steps.
    expect(names.indexOf("opt_in_capturing") === -1 || names.indexOf("opt_in_capturing") >= 3).toBe(true);
  });

  it("a throwing opt_in_capturing leaves the gate closed so the transport's opt-out finds nothing open", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH, { throwIn: ["opt_in_capturing"] });
    expect(() => provider.optIn()).toThrow();
    expect(fake.names()).not.toContain("startSessionRecording");
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(fake.sent).toEqual([]);
  });
});
