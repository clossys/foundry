import { describe, expect, it } from "vitest";
import {
  BOTH,
  CHAIN_PARTS,
  chain,
  clickProperties,
  initOnly,
  setPage,
  snapshotProperties,
  start,
  validSnapshot,
} from "./posthog-fake.test.js";

const RAW_URL = "https://example.test/pricing/plans?token=abc123&email=a@b.test#frag";
const SAFE_URL = "https://example.test/pricing/plans";
const DELIVERY = ["token", "distinct_id", "$lib", "$lib_version", "$insert_id", "$time", "$process_person_profile"];
const URLS = ["$current_url", "$pathname", "$host"];

function keys(event: unknown): string[] {
  return Object.keys((event as { properties: object }).properties).sort();
}

function startBoth() {
  setPage();
  return start(BOTH, { autoProperties: { $current_url: RAW_URL, $set: { email: "p@example.test" } }, sdkWins: true });
}

describe("P-35 posthog-gate: every event class takes the same final steps (C-65)", () => {
  it("a pageview, a conversion, an autocapture and a snapshot leave with only their class's properties and rebuilt URL fields", () => {
    const { fake, provider } = startBoth();
    expect(fake.names()).toContain("startSessionRecording");

    provider.capture({ kind: "pageview", url: SAFE_URL, properties: {} });
    provider.capture({ kind: "conversion", name: "signup_started", url: SAFE_URL, properties: { plan: "pro" } });
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target, CHAIN_PARTS.div), { $current_url: RAW_URL }), { $set_once: { x: 1 } });
    fake.emit("$snapshot", { ...snapshotProperties(validSnapshot()), $current_url: RAW_URL });

    expect(fake.sent.map((event) => event.event)).toEqual(["$pageview", "signup_started", "$autocapture", "$snapshot"]);
    expect(keys(fake.sent[0])).toEqual([...DELIVERY, ...URLS].sort());
    expect(keys(fake.sent[1])).toEqual([...DELIVERY, ...URLS, "plan"].sort());
    expect(keys(fake.sent[2])).toEqual([...DELIVERY, ...URLS, "$event_type", "$elements_chain"].sort());
    expect(keys(fake.sent[3])).toEqual([...DELIVERY, ...URLS, "$snapshot_data", "$session_id", "$window_id"].sort());

    for (const event of fake.sent) {
      expect(Object.keys(event).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
      const properties = (event as { properties: Record<string, unknown> }).properties;
      expect(properties.$current_url).toBe(SAFE_URL);
      expect(properties.$pathname).toBe("/pricing/plans");
      expect(properties.$host).toBe("example.test");
      expect(JSON.stringify(event)).not.toMatch(/token=|email|person@|p@example|first_seen|\$set/);
    }
  });

  it("a $set, $set_once or $unset on any class never passes, and an unlisted property is dropped", () => {
    const { fake } = startBoth();
    fake.emit("$autocapture", { ...clickProperties(chain(CHAIN_PARTS.target)), $set: { a: 1 }, $unset: ["a"], unlisted: "x" }, { $unset: ["a"] });
    fake.emit("$snapshot", { ...snapshotProperties(validSnapshot()), $set: { a: 1 }, unlisted: "x" });
    expect(fake.sent).toHaveLength(2);
    for (const event of fake.sent) {
      const text = JSON.stringify(event);
      expect(text).not.toContain("unlisted");
      expect(text).not.toContain('"$set"');
      expect(text).not.toContain('"$unset"');
      expect(Object.keys(event)).not.toContain("$set");
    }
  });

  it("a sanitizer that returns null drops an SDK-originated class, as it drops a transport event", () => {
    setPage();
    const { fake } = start(BOTH, { autoProperties: { $current_url: "not a url" }, sdkWins: true });
    fake.emit("$autocapture", { ...clickProperties(chain(CHAIN_PARTS.target)), $current_url: "not a url" });
    fake.emit("$snapshot", { ...snapshotProperties(validSnapshot()), $current_url: "not a url" });
    expect(fake.sent).toEqual([]);
    expect(fake.dropped.slice(-2)).toEqual(["$autocapture", "$snapshot"]);
  });

  it("an autocapture with the flag off, and a snapshot with replay off, are dropped", () => {
    setPage();
    const replayOnly = start({ replay: true });
    replayOnly.fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(replayOnly.fake.sent).toEqual([]);

    const autocaptureOnly = start({ autocapture: true });
    autocaptureOnly.fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    expect(autocaptureOnly.fake.sent).toEqual([]);

    const neither = start({});
    neither.fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    neither.fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    expect(neither.fake.sent).toEqual([]);
  });

  it("a snapshot before replay started is dropped, as is one when the sample draw did not select the grant", () => {
    setPage({ draws: [0.9] });
    const { fake } = start({ replay: true, sampleRate: 0.5 });
    expect(fake.names()).not.toContain("startSessionRecording");
    fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    for (const session of [null, undefined, ""]) {
      const properties = snapshotProperties(validSnapshot());
      properties.$session_id = session;
      fake.emit("$snapshot", properties);
    }
    expect(fake.sent).toEqual([]);
  });

  it("any SDK-originated event while the gate is closed is dropped: before the grant and after a withdrawal", () => {
    setPage();
    const before = initOnly(BOTH);
    before.fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    before.fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    before.fake.emit("$pageview");
    expect(before.fake.sent).toEqual([]);

    const { fake, provider } = start(BOTH);
    provider.optOut();
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    fake.emit("$pageview");
    expect(fake.sent).toEqual([]);
  });

  it("a flag-called event, an exception, a heatmap, a survey and an identify event are dropped under every flag", () => {
    setPage();
    const { fake } = startBoth();
    for (const name of ["$feature_flag_called", "$exception", "$$heatmap", "survey sent", "$identify", "$groupidentify", "$pageleave", "$rageclick", "$dead_click", "$web_vitals", "$opt_in"]) {
      fake.emit(name);
    }
    expect(fake.sent).toEqual([]);
  });

  it("a transport event outside the adapter's own capture call is dropped even under an allowed name", () => {
    const { fake } = startBoth();
    fake.emit("$pageview");
    fake.emit("signup_started");
    expect(fake.sent).toEqual([]);
  });

  it("a hostile hook argument is dropped without throwing", () => {
    const { fake } = startBoth();
    for (const value of [null, undefined, "x", 1, [], { event: 1 }, { event: "$autocapture" }, { event: "$snapshot", properties: null }]) {
      expect(() => fake.emitRaw(value)).not.toThrow();
    }
    expect(fake.sent).toEqual([]);
  });
});
