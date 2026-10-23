import { describe, expect, it } from "vitest";
import { flush } from "./posthog-fake.test.js";
import { createHostReference, exposures, flagCalls, type PurposeStatus } from "./posthog-flags-host.test.js";

const STORED: Array<{ analytics?: PurposeStatus; experiments?: PurposeStatus }> = [
  {},
  { analytics: "granted" },
  { experiments: "granted" },
  { analytics: "granted", experiments: "granted" },
  { analytics: "refused", experiments: "granted" },
];

describe("P-53 posthog-flags-rendering: the server and hydration render control; only a validated client evaluation renders a variant (C-79)", () => {
  it("server and hydration render control whatever the stored choice, and make no flag request", async () => {
    for (const stored of STORED) {
      const host = createHostReference({ stored });
      const label = JSON.stringify(stored);
      expect(host.render("server", "hero-copy", "control"), label).toBe("control");
      expect(host.render("hydration", "hero-copy", "control"), label).toBe("control");
      expect(host.fake.calls, label).toEqual([]);
      await flush();
      host.fake.flagReply({ "hero-copy": "short" });
      const requests = host.fake.flagState.requests.length;
      expect(host.render("server", "hero-copy", "control"), label).toBe("control");
      expect(host.render("hydration", "hero-copy", "control"), label).toBe("control");
      expect(host.fake.flagState.requests, label).toHaveLength(requests);
      expect(exposures(host.fake), label).toEqual([]);
    }
  });

  it("after mount, a variant renders only with both grants and a validated evaluation", async () => {
    const host = createHostReference();
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.setAnalytics("granted");
    await flush();
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.setExperiments("granted");
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.fake.flagReply({ "hero-copy": "unlisted" });
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.setExperiments("withdrawn");
    host.setExperiments("granted");
    host.fake.flagReply({ "hero-copy": "short" });
    expect(host.render("client", "hero-copy", "control")).toBe("short");
    expect(exposures(host.fake)).toHaveLength(1);
  });

  it("loading and failure stay at control, and nothing asks the SDK to rewrite markup", async () => {
    const host = createHostReference({ stored: { analytics: "granted", experiments: "granted" } });
    await flush();
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    host.fake.flagReply({ "hero-copy": "short" }, { errorsLoading: true });
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    expect(host.fake.inits[0]!.config.disable_web_experiments).toBe(true);
    for (const update of host.fake.flagState.configUpdates) expect(update).not.toHaveProperty("disable_web_experiments");
    expect(flagCalls(host.fake)).toEqual(["onFeatureFlags", "set_config", "reloadFeatureFlags"]);
  });
});
