import { describe, expect, it, vi } from "vitest";
import { FLAGS_DISABLE_OPTIONS } from "./providers/posthog-flags.js";
import { FLAG_CALLS, exposures, flagCalls, flagsEligible, flagsEvaluated } from "./posthog-flags-host.test.js";

function callsAfter(fake: { calls: Array<{ name: string }> }, from: number): string[] {
  return fake.calls.slice(from).map((call) => call.name);
}

function storageSpy() {
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) => {
      writes.push(`get:${key}`);
      return null;
    },
    setItem: (key: string) => writes.push(`set:${key}`),
    removeItem: (key: string) => writes.push(`remove:${key}`),
    clear: () => writes.push("clear"),
    key: () => null,
    length: 0,
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("document", {
    get cookie() {
      writes.push("cookie:get");
      return "";
    },
    set cookie(_value: string) {
      writes.push("cookie:set");
    },
  });
  return writes;
}

describe("P-51 posthog-flags-withdrawal: either withdrawal clears local flag state at once (C-77)", () => {
  it("an experiments withdrawal clears assignments synchronously and notifies", () => {
    const { provider } = flagsEvaluated();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
    let notified = 0;
    provider.flags.subscribe(() => {
      notified += 1;
    });
    provider.flags.setExperimentsPermission(false);
    expect(notified).toBe(1);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(provider.flags.lookup("new-nav", false)).toBe(false);
  });

  it("an experiments withdrawal with analytics open clears SDK flag state and restores both disables, without a session reset", () => {
    const { fake, provider } = flagsEvaluated(undefined, { analytics: { autocapture: true, replay: true } });
    const from = fake.calls.length;
    const session = fake.session.id;
    provider.flags.setExperimentsPermission(false);
    expect(callsAfter(fake, from)).toEqual(["offFeatureFlags", "featureFlags.reset", "set_config"]);
    expect(fake.flagState.configUpdates.at(-1)).toEqual({ ...FLAGS_DISABLE_OPTIONS });
    expect(fake.flagState.loaded).toBeNull();
    expect(fake.session.id).toBe(session);
    expect(callsAfter(fake, from)).not.toContain("reset");
    expect(callsAfter(fake, from)).not.toContain("opt_out_capturing");
  });

  it("an analytics withdrawal makes no flags SDK call at all, and clears local state at once", () => {
    const { fake, provider } = flagsEvaluated();
    provider.flags.lookup("hero-copy", "control");
    const from = fake.calls.length;
    provider.optOut();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    provider.flags.setExperimentsPermission(false);
    expect(callsAfter(fake, from).filter((name) => FLAG_CALLS.includes(name))).toEqual([]);
    expect(fake.flagState.configUpdates).toHaveLength(1);
  });

  it("after an analytics withdrawal, SDK flag state is untrusted: the next eligible grant clears it before anything else", () => {
    const { fake, provider } = flagsEvaluated();
    provider.optOut();
    const from = fake.calls.length;
    provider.optIn();
    expect(callsAfter(fake, from).filter((name) => FLAG_CALLS.includes(name))).toEqual([
      "featureFlags.reset",
      "onFeatureFlags",
      "set_config",
      "reloadFeatureFlags",
    ]);
    // The SDK's cache was cleared, so the subscription replays nothing old.
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("a re-grant never reuses an old assignment or the old exposure set", () => {
    const { fake, provider } = flagsEvaluated();
    provider.flags.lookup("hero-copy", "control");
    expect(exposures(fake)).toHaveLength(1);

    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    fake.flagReply({ "hero-copy": "short" });
    provider.flags.lookup("hero-copy", "control");
    expect(exposures(fake)).toHaveLength(2);

    provider.optOut();
    provider.optIn();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    fake.flagReply({ "hero-copy": "short" });
    provider.flags.lookup("hero-copy", "control");
    expect(exposures(fake)).toHaveLength(3);
  });

  it("a missing SDK cache clear keeps control at the next grant, with no evaluation request", () => {
    const { fake, provider } = flagsEvaluated(undefined, { fakeOptions: { omit: ["featureFlags"] } });
    provider.flags.setExperimentsPermission(false);
    const requests = fake.flagState.requests.length;
    provider.flags.setExperimentsPermission(true);
    expect(fake.flagState.requests).toHaveLength(requests);
    fake.flagReply({ "hero-copy": "short" });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");

    provider.optOut();
    provider.optIn();
    expect(fake.flagState.requests).toHaveLength(requests);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("a throwing cache clear keeps control until a later grant whose clear succeeds", () => {
    const { fake, provider } = flagsEvaluated();
    let failures = 2;
    fake.inside["featureFlags.reset"] = () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("clear failed");
      }
    };
    provider.flags.setExperimentsPermission(false);
    const requests = fake.flagState.requests.length;
    provider.flags.setExperimentsPermission(true);
    expect(fake.flagState.requests).toHaveLength(requests);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");

    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    expect(fake.flagState.requests).toHaveLength(requests + 1);
    fake.flagReply({ "hero-copy": "short" });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
  });

  it("a failed restore of the disables leaves the SDK untrusted: the next grant clears it first", () => {
    const { fake, provider } = flagsEvaluated();
    let calls = 0;
    fake.inside.set_config = () => {
      calls += 1;
      if (calls === 1) throw new Error("restore failed");
    };
    provider.flags.setExperimentsPermission(false);
    const from = fake.calls.length;
    provider.flags.setExperimentsPermission(true);
    expect(callsAfter(fake, from).filter((name) => FLAG_CALLS.includes(name))[0]).toBe("featureFlags.reset");
  });

  it("an analytics withdrawal during an experiments cleanup still ends with flags closed", () => {
    const { fake, provider } = flagsEvaluated();
    let from = -1;
    fake.inside["featureFlags.reset"] = () => {
      fake.inside["featureFlags.reset"] = undefined;
      provider.optOut();
      from = fake.calls.length;
    };
    provider.flags.setExperimentsPermission(false);
    expect(callsAfter(fake, from).filter((name) => FLAG_CALLS.includes(name))).toEqual([]);
    provider.flags.setExperimentsPermission(true);
    fake.flagReply({ "hero-copy": "short" });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("an experiments grant made during the cleanup starts only after it", () => {
    const { fake, provider } = flagsEvaluated();
    fake.inside["featureFlags.reset"] = () => {
      fake.inside["featureFlags.reset"] = undefined;
      provider.flags.setExperimentsPermission(true);
    };
    const from = fake.calls.length;
    provider.flags.setExperimentsPermission(false);
    expect(callsAfter(fake, from).filter((name) => FLAG_CALLS.includes(name))).toEqual([
      "offFeatureFlags",
      "featureFlags.reset",
      "set_config",
      "onFeatureFlags",
      "set_config",
      "reloadFeatureFlags",
    ]);
  });

  it("flag work reads and writes no browser storage or cookie", () => {
    const touched = storageSpy();
    const { fake, provider } = flagsEvaluated();
    provider.flags.lookup("hero-copy", "control");
    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    fake.flagReply({ "new-nav": true });
    provider.flags.lookup("new-nav", false);
    provider.optOut();
    provider.optIn();
    expect(touched).toEqual([]);
    expect(flagCalls(fake).length).toBeGreaterThan(0);
  });

  it("a new page load starts with no assignment, even when the SDK object still holds one", () => {
    const first = flagsEvaluated();
    first.provider.flags.lookup("hero-copy", "control");
    const second = flagsEligible();
    second.fake.flagState.loaded = { "hero-copy": "short" };
    expect(second.provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(exposures(second.fake)).toEqual([]);
  });
});
