import { describe, expect, it } from "vitest";
import { createPostHogProvider } from "./providers/posthog.js";
import { CONTEXT, configFor, createFake, flush, setPage } from "./posthog-fake.test.js";
import {
  FLAGS_BLOCK,
  FLAG_CALLS,
  GOOD_FLAGS_PROBE,
  createHostReference,
  exposures,
  flagCalls,
  flagsEligible,
  flagsEvaluated,
  flagsInit,
  type PurposeStatus,
} from "./posthog-flags-host.test.js";

const REFUSALS: PurposeStatus[] = ["undecided", "notice", "refused", "expired", "unreadable", "simulated", "withdrawn"];

describe("P-46 posthog-flags-permission: flags need the instance, the open gate and the separate experiments grant (C-72)", () => {
  it("an experiments-only grant loads no SDK and makes no call, evaluation or exposure", async () => {
    const host = createHostReference();
    host.setExperiments("granted");
    await flush();
    expect(host.loads()).toBe(0);
    expect(host.fake.inits).toEqual([]);
    expect(host.fake.calls).toEqual([]);
    expect(host.render("client", "hero-copy", "control")).toBe("control");
    expect(host.fake.sent).toEqual([]);
  });

  it("an experiments grant on a handle whose instance was never initialized makes no call and looks up control", () => {
    setPage();
    const fake = createFake();
    const provider = createPostHogProvider(fake.sdk, configFor({ flags: FLAGS_BLOCK }));
    provider.flags.attest(() => ({ ...GOOD_FLAGS_PROBE }));
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(fake.inits).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("with the instance initialized but the gate closed, an experiments grant makes no flag call", () => {
    const { fake, provider } = flagsInit();
    provider.flags.setExperimentsPermission(true);
    expect(flagCalls(fake)).toEqual([]);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("with the gate open but no experiments grant, nothing is evaluated: experiments is never inferred from analytics", () => {
    const { fake, provider } = flagsInit();
    provider.optIn();
    expect(flagCalls(fake)).toEqual([]);
    fake.flagReply({ "hero-copy": "short" });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(exposures(fake)).toEqual([]);
  });

  it("evaluation starts once all three hold, in either order", () => {
    const grantFirst = flagsInit();
    grantFirst.provider.flags.setExperimentsPermission(true);
    expect(flagCalls(grantFirst.fake)).toEqual([]);
    grantFirst.provider.optIn();
    expect(flagCalls(grantFirst.fake)).toEqual(["onFeatureFlags", "set_config", "reloadFeatureFlags"]);

    const gateFirst = flagsInit();
    gateFirst.provider.optIn();
    expect(flagCalls(gateFirst.fake)).toEqual([]);
    gateFirst.provider.flags.setExperimentsPermission(true);
    expect(flagCalls(gateFirst.fake)).toEqual(["onFeatureFlags", "set_config", "reloadFeatureFlags"]);
  });

  it("every state other than an explicit experiments grant renders control, with analytics granted", async () => {
    for (const status of REFUSALS) {
      const host = createHostReference();
      host.setAnalytics("granted");
      host.setExperiments(status);
      await flush();
      expect(host.loads(), status).toBe(1);
      expect(flagCalls(host.fake), status).toEqual([]);
      host.fake.flagReply({ "hero-copy": "short" });
      expect(host.render("client", "hero-copy", "control"), status).toBe("control");
      expect(exposures(host.fake), status).toEqual([]);
    }
  });

  it("only a literal true grants; a truthy value does not", () => {
    const { fake, provider } = flagsInit();
    provider.optIn();
    for (const value of [1, "true", {}, []]) provider.flags.setExperimentsPermission(value as unknown as boolean);
    expect(flagCalls(fake)).toEqual([]);
  });

  it("a lookup made before the grant is never exposed after evaluation arrives", () => {
    const { fake, provider } = flagsInit();
    provider.optIn();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    fake.flagReply({ "hero-copy": "short", "new-nav": true });
    expect(exposures(fake)).toEqual([]);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
    expect(exposures(fake)).toHaveLength(1);
  });

  it("while evaluation is pending, and after a failed evaluation, lookups return control and send nothing", () => {
    const { fake, provider } = flagsEligible();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    fake.flagReply({ "hero-copy": "short" }, { errorsLoading: true });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(exposures(fake)).toEqual([]);
  });

  it("an analytics withdrawal stops flags synchronously, and no flags SDK call follows it", () => {
    const { fake, provider } = flagsEvaluated();
    expect(provider.flags.lookup("new-nav", false)).toBe(true);
    let notified = 0;
    provider.flags.subscribe(() => {
      notified += 1;
    });
    const before = fake.calls.length;
    provider.optOut();
    expect(provider.flags.lookup("new-nav", false)).toBe(false);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(notified).toBe(1);

    fake.flagReply({ "hero-copy": "short", "new-nav": true });
    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    const after = fake.calls.slice(before).map((call) => call.name);
    expect(after.filter((name) => FLAG_CALLS.includes(name))).toEqual([]);
    expect(exposures(fake)).toHaveLength(1);
  });
});
