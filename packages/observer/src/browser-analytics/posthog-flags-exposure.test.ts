import { describe, expect, it } from "vitest";
import { POSTHOG_FLAG_EXPOSURE_PROPERTIES } from "./providers/posthog.js";
import { exposures, flagsEligible, flagsEvaluated, flagsInit } from "./posthog-flags-host.test.js";

const RAW_URL = "https://example.test/pricing/plans?token=abc123&email=a@b.test#frag";
const SAFE_URL = "https://example.test/pricing/plans";
const DELIVERY = ["token", "distinct_id", "$lib", "$lib_version", "$insert_id", "$time", "$process_person_profile"];
const URLS = ["$current_url", "$pathname", "$host"];

/** An SDK that adds person data, a raw URL and its own flag values, and lets them win over the adapter's. */
const HOSTILE_SDK = {
  autoProperties: {
    $current_url: RAW_URL,
    $referrer: "https://elsewhere.test/?q=1",
    $set: { email: "p@example.test" },
    $feature_flag: "new-nav",
    $feature_flag_response: "sdk-value",
    $feature_flag_payload: { secret: 1 },
    $active_feature_flags: ["hero-copy"],
    unlisted: "x",
  },
  sdkWins: true,
};

describe("P-49 posthog-flags-exposure: one validated exposure per key and variant per eligible grant (C-75)", () => {
  it("sends one exposure per key and variant per grant, however often it is looked up", () => {
    const { fake, provider } = flagsEvaluated();
    for (let i = 0; i < 3; i += 1) {
      provider.flags.lookup("hero-copy", "control");
      provider.flags.lookup("new-nav", false);
    }
    expect(exposures(fake).map((event) => (event.properties as Record<string, unknown>).$feature_flag)).toEqual(["hero-copy", "new-nav"]);
  });

  it("a later eligible grant exposes again; within the grant, the deduplication holds", () => {
    const { fake, provider } = flagsEvaluated();
    provider.flags.lookup("hero-copy", "control");
    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    fake.flagReply({ "hero-copy": "short" });
    provider.flags.lookup("hero-copy", "control");
    provider.flags.lookup("hero-copy", "control");
    expect(exposures(fake)).toHaveLength(2);
  });

  it("no exposure for a pending, failed, unassigned or refused lookup: control is never exposed as a fallback", () => {
    const pending = flagsEligible();
    pending.provider.flags.lookup("hero-copy", "control");
    pending.fake.flagReply({ "hero-copy": "short" }, { errorsLoading: true });
    pending.provider.flags.lookup("hero-copy", "control");
    expect(exposures(pending.fake)).toEqual([]);

    const partial = flagsEvaluated({ "new-nav": true });
    expect(partial.provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(partial.provider.flags.lookup("hero-copy", "short")).toBe("control");
    expect(exposures(partial.fake)).toEqual([]);
  });

  it("an exposure the adapter did not send is dropped, in every state", () => {
    const eligible = flagsEvaluated();
    eligible.fake.emit("$feature_flag_called", { $feature_flag: "hero-copy", $feature_flag_response: "short" });
    const before = flagsInit();
    before.fake.emit("$feature_flag_called", { $feature_flag: "hero-copy", $feature_flag_response: "short" });
    expect(exposures(eligible.fake)).toEqual([]);
    expect(exposures(before.fake)).toEqual([]);
    expect(eligible.fake.dropped).toContain("$feature_flag_called");
  });

  it("keeps only the validated key and variant, the delivery fields and the rebuilt URL fields", () => {
    const { fake, provider } = flagsEvaluated(undefined, { fakeOptions: HOSTILE_SDK });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
    const [event] = exposures(fake);
    expect(Object.keys(event!).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
    const properties = event!.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...DELIVERY, ...URLS, ...POSTHOG_FLAG_EXPOSURE_PROPERTIES].sort());
    expect(properties.$feature_flag).toBe("hero-copy");
    expect(properties.$feature_flag_response).toBe("short");
    expect(properties.$current_url).toBe(SAFE_URL);
    expect(properties.$pathname).toBe("/pricing/plans");
    expect(properties.$host).toBe("example.test");
    expect(JSON.stringify(event)).not.toMatch(/token=|email|p@example|elsewhere|sdk-value|secret|unlisted|\$set/);
  });

  it("an experiments withdrawal before the hook runs drops the pending exposure, and the lookup returns control", () => {
    const { fake, provider } = flagsEvaluated();
    fake.inside["capture:$feature_flag_called"] = () => provider.flags.setExperimentsPermission(false);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(exposures(fake)).toEqual([]);
    expect(fake.dropped).toContain("$feature_flag_called");
  });

  it("an analytics withdrawal before the hook runs drops the pending exposure, and the lookup returns control", () => {
    const { fake, provider } = flagsEvaluated();
    fake.inside["capture:$feature_flag_called"] = () => provider.optOut();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(exposures(fake)).toEqual([]);
  });

  it("an analytics re-grant inside the send leaves the exposure of the earlier grant dropped", () => {
    const { fake, provider } = flagsEvaluated();
    fake.inside["capture:$feature_flag_called"] = () => {
      fake.inside["capture:$feature_flag_called"] = undefined;
      provider.optOut();
      provider.optIn();
    };
    provider.flags.lookup("hero-copy", "control");
    expect(exposures(fake)).toEqual([]);
  });

  it("an exposure the hook already passed stays sent: a withdrawal does not claim to retract it", () => {
    const { fake, provider } = flagsEvaluated();
    provider.flags.lookup("hero-copy", "control");
    provider.flags.setExperimentsPermission(false);
    provider.optOut();
    expect(exposures(fake)).toHaveLength(1);
  });

  it("a throwing capture leaves the lookup at its value and the adapter usable", () => {
    const { fake, provider } = flagsEvaluated(undefined, { fakeOptions: { throwIn: ["capture:$feature_flag_called"] } });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
    fake.emit("$feature_flag_called", { $feature_flag: "hero-copy", $feature_flag_response: "short" });
    expect(exposures(fake)).toEqual([]);
  });
});
