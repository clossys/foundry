import { describe, expect, it } from "vitest";
import { createPostHogProvider, type PostHogProviderConfig } from "./providers/posthog.js";
import { CONTEXT, HOST, createFake, flush, setPage } from "./posthog-fake.test.js";
import { FLAGS_BLOCK, createHostReference, exposures, flagCalls, flagsEligible } from "./posthog-flags-host.test.js";

const SERVER = { "hero-copy": "short", "new-nav": true };

describe("P-52 posthog-flags-bootstrap: server assignments are never accepted (C-78)", () => {
  it("a bootstrap key in the flags block is refused before initialization", () => {
    const fake = createFake();
    expect(() =>
      createPostHogProvider(fake.sdk, { ...HOST, flags: { ...FLAGS_BLOCK, bootstrap: SERVER } } as unknown as PostHogProviderConfig),
    ).toThrow(TypeError);
    expect(fake.inits).toEqual([]);
  });

  it("a top-level bootstrap never reaches init and is never evaluated or exposed", () => {
    setPage();
    const fake = createFake();
    const provider = createPostHogProvider(fake.sdk, {
      ...HOST,
      flags: FLAGS_BLOCK,
      bootstrap: { featureFlags: SERVER },
    } as unknown as PostHogProviderConfig);
    provider.init(CONTEXT);
    expect(fake.inits[0]!.config).not.toHaveProperty("bootstrap");
    expect(JSON.stringify(fake.inits[0]!.config)).not.toContain("short");
    provider.optIn();
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(JSON.stringify(fake.flagState.configUpdates)).not.toMatch(/bootstrap|short/);
    expect(exposures(fake)).toEqual([]);
  });

  it("assignments the SDK held before the request (as a bootstrap would leave them) are refused in every grant", () => {
    const { fake, provider } = flagsEligible();
    // Bootstrap-like state is already in the SDK when the subscription replays it.
    for (let round = 0; round < 3; round += 1) {
      expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
      fake.flagReply({ "new-nav": false });
      expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
      provider.flags.setExperimentsPermission(false);
      fake.flagState.loaded = SERVER;
      provider.flags.setExperimentsPermission(true);
    }
    expect(exposures(fake).map((event) => (event.properties as Record<string, unknown>).$feature_flag)).toEqual([]);
  });

  it("an already-granted host and a re-granted host render control from server assignments before their own evaluation", async () => {
    const host = createHostReference({ stored: { analytics: "granted", experiments: "granted" } });
    await flush();
    expect(host.loads()).toBe(1);
    expect(host.render("server", "hero-copy", "control")).toBe("control");
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.setAnalytics("withdrawn");
    host.fake.flagState.loaded = SERVER;
    host.setAnalytics("granted");
    await flush();
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    expect(flagCalls(host.fake).filter((name) => name === "reloadFeatureFlags")).toHaveLength(2);
  });
});
