/**
 * Shared fixtures for the unit H flag tests: a valid flags block, a passing
 * evidence probe, helpers that bring an adapter to each eligibility state,
 * and a host reference that binds the analytics and experiments purposes to
 * two separate lifecycles, as H-12 requires.
 *
 * The host reference is the binding the specification describes, kept as
 * small as possible: analytics permission drives the transport, the separate
 * experiments permission drives `provider.flags`, and the server and
 * hydration render control without touching the handle (C-79). No real SDK
 * is installed or imported and no network is used.
 *
 * This file is a test file (`*.test.ts`) so it is neither compiled into
 * `dist` nor published; it carries a small self-test so the runner accepts it.
 */

import { describe, expect, it } from "vitest";
import { createPostHogProvider, type PostHogFlagValue, type PostHogFlagsCapability, type PostHogProvider } from "./providers/posthog.js";
import { CONTEXT, configFor, createFake, flush, setPage, transportFor, type Fake, type FakeOptions, type FlagOptions } from "./posthog-fake.test.js";

export const FLAGS_BLOCK = Object.freeze({
  enabled: true,
  purpose: "experiments",
  definitions: {
    "hero-copy": { control: "control", variants: ["control", "short"] },
    "new-nav": { control: false, variants: [false, true] },
  },
});

export const GOOD_FLAGS_PROBE: PostHogFlagsCapability = Object.freeze({
  holdsRequestsWhileDisabled: true,
  retainedOptionsStartNoRequest: true,
  requestCarriesNoPersonData: true,
  evaluatesOnReload: true,
  clearsFlagCache: true,
  resetCancelsPendingRequests: true,
});

export const FLAG_CALLS = ["onFeatureFlags", "set_config", "reloadFeatureFlags", "offFeatureFlags", "featureFlags.reset", "setPersonPropertiesForFlags", "group"];

/** The flag-related SDK calls, in order. */
export function flagCalls(fake: Fake): string[] {
  return fake.names().filter((name) => FLAG_CALLS.includes(name));
}

export interface FlagsSetup {
  /** The flags block; defaults to `FLAGS_BLOCK`. `null` omits it. */
  flags?: unknown;
  /** The evidence probe; `null` skips `attest`. */
  probe?: (() => unknown) | null;
  analytics?: FlagOptions;
  fakeOptions?: FakeOptions;
}

export interface FlagsStarted {
  fake: Fake;
  provider: PostHogProvider;
}

/** Creates and attests the adapter, then `init`s it; nothing is granted yet. */
export function flagsInit(setup: FlagsSetup = {}): FlagsStarted {
  setPage();
  const fake = createFake(setup.fakeOptions);
  const flags = setup.flags === undefined ? FLAGS_BLOCK : setup.flags === null ? undefined : setup.flags;
  const provider = createPostHogProvider(fake.sdk, configFor({ ...setup.analytics, ...(flags === undefined ? {} : { flags }) })) as PostHogProvider;
  const probe = setup.probe === undefined ? () => ({ ...GOOD_FLAGS_PROBE }) : setup.probe;
  if (probe !== null) provider.flags.attest(probe as () => PostHogFlagsCapability);
  provider.init(CONTEXT);
  return { fake, provider };
}

/** All three conditions of C-72, plus the attested evidence: evaluation has been requested. */
export function flagsEligible(setup: FlagsSetup = {}): FlagsStarted {
  const started = flagsInit(setup);
  started.provider.optIn();
  started.provider.flags.setExperimentsPermission(true);
  return started;
}

/** Eligible, with one evaluation reply delivered. */
export function flagsEvaluated(
  variants: Record<string, unknown> = { "hero-copy": "short", "new-nav": true },
  setup: FlagsSetup = {},
): FlagsStarted {
  const started = flagsEligible(setup);
  started.fake.flagReply(variants);
  return started;
}

/** The exposures the hook let through. */
export function exposures(fake: Fake): Array<Record<string, unknown>> {
  return fake.sent.filter((event) => event.event === "$feature_flag_called");
}

// --------------------------------------------------------- host reference

export type PurposeStatus = "undecided" | "notice" | "granted" | "refused" | "expired" | "unreadable" | "simulated" | "withdrawn";

interface Lifecycle {
  status: PurposeStatus;
  listeners: Array<(allowed: boolean) => void>;
}

/** Only an explicit grant allows a purpose; every other state is a refusal. */
const allows = (status: PurposeStatus): boolean => status === "granted";

export interface HostReference {
  fake: Fake;
  loads(): number;
  provider(): PostHogProvider | null;
  setAnalytics(status: PurposeStatus): void;
  setExperiments(status: PurposeStatus): void;
  /** What the host renders for one flag in each phase (C-79). */
  render(phase: "server" | "hydration" | "client", key: string, control: PostHogFlagValue): PostHogFlagValue;
}

/**
 * The host binding of H-12: the analytics lifecycle drives the transport and
 * the experiments lifecycle, a separate one, drives the flags handle.
 */
export function createHostReference(options: { stored?: { analytics?: PurposeStatus; experiments?: PurposeStatus } } = {}): HostReference {
  setPage();
  const fake = createFake();
  const analytics: Lifecycle = { status: options.stored?.analytics ?? "undecided", listeners: [] };
  const experiments: Lifecycle = { status: options.stored?.experiments ?? "undecided", listeners: [] };
  let loaded: PostHogProvider | null = null;
  let loads = 0;

  const { transport } = transportFor(() => {
    loads += 1;
    const provider = createPostHogProvider(fake.sdk, configFor({ flags: FLAGS_BLOCK }));
    provider.flags.attest(() => ({ ...GOOD_FLAGS_PROBE }));
    provider.flags.setExperimentsPermission(allows(experiments.status));
    loaded = provider;
    return provider;
  });

  analytics.listeners.push((allowed) => transport.setPermission(allowed));
  experiments.listeners.push((allowed) => loaded?.flags.setExperimentsPermission(allowed));
  // A stored analytics grant starts the transport at mount; a stored experiments grant is read by the loader.
  if (allows(analytics.status)) transport.setPermission(true);

  function set(lifecycle: Lifecycle, status: PurposeStatus): void {
    lifecycle.status = status;
    for (const listener of lifecycle.listeners) listener(allows(status));
  }

  return {
    fake,
    loads: () => loads,
    provider: () => loaded,
    setAnalytics: (status) => set(analytics, status),
    setExperiments: (status) => set(experiments, status),
    render(phase, key, control) {
      // The server and hydration never read a stored choice or the handle.
      if (phase !== "client" || loaded === null) return control;
      return loaded.flags.lookup(key, control);
    },
  };
}

// ------------------------------------------------------------- self-test

describe("posthog flags fixtures", () => {
  it("an evaluated adapter resolves a declared variant; the host reference evaluates only after both grants", async () => {
    const { provider } = flagsEvaluated();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");

    const host = createHostReference();
    host.setAnalytics("granted");
    await flush();
    expect(host.loads()).toBe(1);
    expect(flagCalls(host.fake)).toEqual([]);
    host.setExperiments("granted");
    expect(flagCalls(host.fake)).toEqual(["onFeatureFlags", "set_config", "reloadFeatureFlags"]);
  });
});
