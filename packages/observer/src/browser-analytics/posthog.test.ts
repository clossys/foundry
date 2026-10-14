import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POSTHOG_EVENT_FIELDS,
  POSTHOG_INSTANCE_PREFIX,
  POSTHOG_PROPERTY_ALLOWLIST,
  createPostHogProvider,
  type PostHogLike,
} from "./providers/posthog.js";
import { createAnalyticsTransport } from "./transport.js";
import type { AnalyticsProviderPort, AnalyticsScheduler } from "./types.js";

// ---------------------------------------------------------------- fixtures

interface CaptureResult {
  uuid: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  $set?: unknown;
  $set_once?: unknown;
}

type InitBehaviour = "instance" | "nothing" | "self" | "foreign";

/** Properties a real SDK adds by itself; several must never pass through. */
const SDK_AUTO_PROPERTIES: Readonly<Record<string, unknown>> = {
  token: "sdk-token",
  distinct_id: "anon-123",
  $lib: "web",
  $lib_version: "9.9.9",
  $insert_id: "insert-1",
  $time: 1700000000,
  $process_person_profile: false,
  $current_url: "https://example.test/sdk-own/path?utm_source=mail&email=a@b.test#frag",
  $pathname: "/sdk-own/path",
  $host: "sdk-own.test",
  $referrer: "$direct",
  $referring_domain: "$direct",
  $browser: "Browser",
  $device_id: "device-abc",
  $screen_height: 900,
  email: "person@example.test",
  $set: { email: "person@example.test" },
};

/**
 * A PostHogLike fake. It records the init configuration, runs the
 * configured before_send hook on every capture (as the SDK does), records
 * what would be sent, and returns an existing instance unchanged when a
 * name it has already loaded is initialized again.
 */
function fakeSdk(
  options: {
    initBehaviour?: InitBehaviour;
    sdkPropertiesWin?: boolean;
    auto?: Record<string, unknown>;
    deferHook?: boolean;
    extraTopLevel?: Record<string, unknown>;
  } = {},
) {
  const behaviour = options.initBehaviour ?? "instance";
  const auto = { ...SDK_AUTO_PROPERTIES, ...options.auto };
  const inits: Array<{ apiKey: string; config: Record<string, unknown>; name: string }> = [];
  const sent: CaptureResult[] = [];
  const dropped: string[] = [];
  const hostCalls: string[] = [];
  const instanceCalls: string[] = [];
  const loaded = new Map<string, PostHogLike>();

  function makeInstance(config: Record<string, unknown>): PostHogLike {
    const instance: PostHogLike = {
      config: { before_send: config.before_send },
      init() {
        throw new Error("instance.init is never called by the adapter");
      },
      capture(eventName, properties = {}) {
        instanceCalls.push(`capture:${eventName}`);
        const merged = options.sdkPropertiesWin ? { ...properties, ...auto } : { ...auto, ...properties };
        const result: CaptureResult = {
          uuid: "uuid-1",
          event: eventName,
          properties: merged,
          timestamp: "2026-01-01T00:00:00.000Z",
          $set: { email: "person@example.test" },
          $set_once: { first_seen: "2026-01-01" },
          ...options.extraTopLevel,
        };
        const runHook = () => {
          const hook = config.before_send;
          const out = typeof hook === "function" ? (hook as (r: CaptureResult) => CaptureResult | null)(result) : result;
          if (out) sent.push(out);
          else dropped.push(eventName);
        };
        // deferHook: an SDK that runs the hook after capture has returned.
        if (options.deferHook) queueMicrotask(runHook);
        else runHook();
      },
      opt_in_capturing() {
        instanceCalls.push("opt_in_capturing");
        // The real SDK may emit an opt-in marker event here.
        instance.capture("$opt_in");
      },
      opt_out_capturing() {
        instanceCalls.push("opt_out_capturing");
      },
    };
    return instance;
  }

  const foreign = makeInstance({ before_send: (r: CaptureResult) => r });

  const sdk: PostHogLike = {
    init(apiKey, config, name) {
      inits.push({ apiKey, config, name });
      if (behaviour === "nothing") return undefined;
      if (behaviour === "self") return sdk;
      if (behaviour === "foreign") return foreign;
      const existing = loaded.get(name);
      if (existing) return existing;
      const created = makeInstance(config);
      loaded.set(name, created);
      return created;
    },
    capture(eventName) {
      hostCalls.push(`capture:${eventName}`);
    },
    opt_in_capturing() {
      hostCalls.push("opt_in_capturing");
    },
    opt_out_capturing() {
      hostCalls.push("opt_out_capturing");
    },
  };
  return { sdk, inits, sent, dropped, hostCalls, instanceCalls, loaded, foreign };
}

function manualScheduler() {
  const pending: number[] = [];
  const scheduler: AnalyticsScheduler = {
    setTimeout(_fn, ms) {
      pending.push(ms);
      return pending.length;
    },
    clearTimeout() {},
  };
  return { scheduler, pending };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const HOST_CONFIG = { key: "test-project-key", apiHost: "https://analytics.example.test" };

async function readyTransport(
  fake: ReturnType<typeof fakeSdk>,
  extra: { normalizePath?: (path: string) => string; allowedProperties?: Record<string, readonly string[]> } = {},
) {
  const clock = manualScheduler();
  let loads = 0;
  const transport = createAnalyticsTransport({
    loadProvider: async () => {
      loads += 1;
      return createPostHogProvider(fake.sdk, HOST_CONFIG);
    },
    allowedConversions: ["signup_started"],
    allowedProperties: extra.allowedProperties ?? { signup_started: ["plan", "step"] },
    scheduler: clock.scheduler,
    ...(extra.normalizePath ? { normalizePath: extra.normalizePath } : {}),
  });
  transport.setPermission(true);
  await flush();
  return { transport, clock, loads: () => loads };
}

/** The properties of the index-th sent event; asserts that it was sent. */
function sentProperties(fake: ReturnType<typeof fakeSdk>, index: number): Record<string, unknown> {
  expect(fake.sent.length).toBeGreaterThan(index);
  return fake.sent[index]!.properties;
}

// ------------------------------------------------------------------ P-11

describe("P-11 posthog: initialization and event names (C-18, C-44)", () => {
  it("initialization happens once, across captures and a withdrawal and re-grant", async () => {
    const fake = fakeSdk();
    const { transport, loads } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/a" });
    transport.pageview({ href: "https://example.test/b" });
    transport.conversion("signup_started", { href: "https://example.test/c" });
    transport.setPermission(false);
    transport.setPermission(true);
    transport.pageview({ href: "https://example.test/d" });
    await flush();
    expect(loads()).toBe(1);
    expect(fake.inits).toHaveLength(1);
    expect(fake.instanceCalls).toEqual([
      "opt_in_capturing",
      "capture:$opt_in",
      "capture:$pageview",
      "capture:$pageview",
      "capture:signup_started",
      "opt_out_capturing",
      "opt_in_capturing",
      "capture:$opt_in",
      "capture:$pageview",
    ]);
  });

  it("captures pageviews as $pageview and conversions under their own name", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/pricing?ref=x#plans", referrer: "https://search.test/q?w=1" });
    transport.conversion("signup_started", { href: "https://example.test/signup" }, { plan: "pro", step: 1, email: "a@b.test" });
    expect(fake.sent.map((r) => r.event)).toEqual(["$pageview", "signup_started"]);
    expect(sentProperties(fake, 0).$current_url).toBe("https://example.test/pricing");
    expect(sentProperties(fake, 0).$referrer).toBe("https://search.test");
    expect(sentProperties(fake, 1).$current_url).toBe("https://example.test/signup");
  });

  it("keeps only POSTHOG_PROPERTY_ALLOWLIST plus the transport's properties, and removes $set and $set_once", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake);
    transport.conversion("signup_started", { href: "https://example.test/signup" }, { plan: "pro", step: 1, email: "a@b.test" });
    expect(fake.sent).toHaveLength(1);
    const result = fake.sent[0]!;
    expect(result).not.toHaveProperty("$set");
    expect(result).not.toHaveProperty("$set_once");
    expect(Object.keys(result.properties).sort()).toEqual(
      [
        "token",
        "distinct_id",
        "$lib",
        "$lib_version",
        "$insert_id",
        "$time",
        "$process_person_profile",
        "$current_url",
        "$host",
        "$pathname",
        "plan",
        "step",
      ].sort(),
    );
    expect(result.properties).toMatchObject({ token: "sdk-token", distinct_id: "anon-123", plan: "pro", step: 1 });
    for (const key of ["$browser", "$device_id", "$screen_height", "email", "$set", "$set_once"]) {
      expect(result.properties).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result)).not.toContain("person@example.test");
    expect(result.uuid).toBe("uuid-1");
    expect(result.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rebuilds the event from POSTHOG_EVENT_FIELDS and the hook's properties, dropping every other top-level field", async () => {
    const fake = fakeSdk({ extraTopLevel: { $unset: ["email"], extra: { email: "person@example.test" } } });
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/a" });
    expect(POSTHOG_EVENT_FIELDS).toEqual(["uuid", "event", "timestamp"]);
    expect(fake.sent).toHaveLength(1);
    expect(Object.keys(fake.sent[0]!).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
    expect(fake.sent[0]).toMatchObject({ uuid: "uuid-1", event: "$pageview", timestamp: "2026-01-01T00:00:00.000Z" });
  });

  it("names exactly the delivery, profile-suppression and URL fields in the allowlist", () => {
    expect([...POSTHOG_PROPERTY_ALLOWLIST].sort()).toEqual(
      [
        "token",
        "distinct_id",
        "$lib",
        "$lib_version",
        "$insert_id",
        "$time",
        "$process_person_profile",
        "$current_url",
        "$host",
        "$pathname",
        "$referrer",
        "$referring_domain",
      ].sort(),
    );
    expect(Object.isFrozen(POSTHOG_PROPERTY_ALLOWLIST)).toBe(true);
  });

  it("never lets a transport property overwrite a delivery field", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake, { allowedProperties: { signup_started: ["distinct_id", "token", "plan"] } });
    transport.conversion("signup_started", { href: "https://example.test/" }, { distinct_id: "person@example.test", token: "t", plan: "a" });
    expect(sentProperties(fake, 0)).toMatchObject({ distinct_id: "anon-123", token: "sdk-token", plan: "a" });
  });

  it("drops events the transport did not send, including the opt-in marker and events the SDK emits by itself", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake);
    expect(fake.dropped).toEqual(["$opt_in"]);
    const instance = [...fake.loaded.values()][0]!;
    instance.capture("$autocapture", { $current_url: "https://example.test/" });
    instance.capture("$pageleave", { $current_url: "https://example.test/" });
    // An allowed name the SDK sends by itself, outside a transport capture, is dropped too.
    instance.capture("$pageview", { $current_url: "https://example.test/" });
    transport.pageview({ href: "https://example.test/real" });
    expect(fake.dropped).toEqual(["$opt_in", "$autocapture", "$pageleave", "$pageview"]);
    expect(fake.sent.map((r) => r.event)).toEqual(["$pageview"]);
  });

  it("an SDK that runs before_send after capture returns has every transport event dropped", async () => {
    const fake = fakeSdk({ deferHook: true });
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/a" });
    transport.conversion("signup_started", { href: "https://example.test/b" }, { plan: "pro" });
    await flush();
    expect(fake.instanceCalls).toEqual(expect.arrayContaining(["capture:$pageview", "capture:signup_started"]));
    expect(fake.sent).toEqual([]);
    expect(fake.dropped).toEqual(expect.arrayContaining(["$pageview", "signup_started"]));
  });

  it("drops an event whose name the init context does not list, even when captured through the adapter", () => {
    const fake = fakeSdk();
    const provider = createPostHogProvider(fake.sdk, HOST_CONFIG);
    provider.init({ sanitizeUrl: (href) => href, eventNames: ["$pageview", "signup_started"] });
    // The capture gate opens with the grant (C-67); the transport always opts in before it captures.
    provider.optIn();
    provider.capture({ kind: "conversion", name: "unlisted_event", url: "https://example.test/", properties: {} });
    provider.capture({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: {} });
    expect(fake.dropped).toEqual(["$opt_in", "unlisted_event"]);
    expect(fake.sent.map((r) => r.event)).toEqual(["signup_started"]);
  });
});

describe("P-11 posthog: URL fields are overwritten from the sanitized URL (C-44)", () => {
  it("$current_url is the sanitized full URL; $pathname and $host come from it even when the SDK set others", async () => {
    // Here the SDK's own values win the merge, so the hook sees the SDK's raw $current_url.
    const fake = fakeSdk({
      sdkPropertiesWin: true,
      auto: { $current_url: "https://example.test:8443/orders/991/view?email=a@b.test#x", $pathname: "/sdk/path", $host: "sdk.test" },
    });
    const { transport } = await readyTransport(fake, { normalizePath: (path) => path.replace(/\/\d+/g, "/:id") });
    transport.pageview({ href: "https://example.test:8443/orders/991/view" });
    const props = sentProperties(fake, 0);
    expect(props.$current_url).toBe("https://example.test:8443/orders/:id/view");
    expect(props.$pathname).toBe("/orders/:id/view");
    expect(props.$host).toBe("example.test:8443");
  });

  it("for a transport event, $current_url stays the transport's sanitized url and the SDK's $pathname and $host are replaced", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/docs/a?x=1" });
    const props = sentProperties(fake, 0);
    expect(props.$current_url).toBe("https://example.test/docs/a");
    expect(props.$pathname).toBe("/docs/a");
    expect(props.$host).toBe("example.test");
  });

  it("$referrer is the transport's referrer origin and $referring_domain its host", async () => {
    const fake = fakeSdk({ sdkPropertiesWin: true, auto: { $current_url: "https://example.test/x" } });
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/x", referrer: "https://news.example.org:444/story?id=1" });
    const props = sentProperties(fake, 0);
    expect(props.$referrer).toBe("https://news.example.org:444");
    expect(props.$referring_domain).toBe("news.example.org:444");
  });

  it("an SDK referrer with no transport referrer origin removes both referrer fields", async () => {
    for (const sdkReferrer of ["$direct", "https://search.test/results?q=private"]) {
      const fake = fakeSdk({ sdkPropertiesWin: true, auto: { $current_url: "https://example.test/x", $referrer: sdkReferrer, $referring_domain: "search.test" } });
      const { transport } = await readyTransport(fake);
      transport.pageview({ href: "https://example.test/x" });
      const props = sentProperties(fake, 0);
      expect(props).not.toHaveProperty("$referrer");
      expect(props).not.toHaveProperty("$referring_domain");
    }
  });

  it("drops an event whose $current_url the sanitizer rejects", async () => {
    for (const current of ["not a url", "/relative/only", 42, undefined]) {
      const fake = fakeSdk({ sdkPropertiesWin: true, auto: { $current_url: current } });
      const { transport } = await readyTransport(fake);
      transport.pageview({ href: "https://example.test/x" });
      expect(fake.sent).toEqual([]);
      expect(fake.dropped).toContain("$pageview");
    }
    const rejecting = fakeSdk({ sdkPropertiesWin: true, auto: { $current_url: "https://example.test/private/area" } });
    const { transport } = await readyTransport(rejecting, { normalizePath: (path) => (path.startsWith("/private") ? "private" : path) });
    transport.pageview({ href: "https://example.test/public" });
    expect(rejecting.sent).toEqual([]);
  });
});

// ------------------------------------------------------------------ P-12

const FORCED_CONFIG = {
  api_host: HOST_CONFIG.apiHost,
  autocapture: false,
  rageclick: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  enable_heatmaps: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_web_experiments: true,
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
  person_profiles: "identified_only",
  persistence: "memory",
  opt_out_capturing_by_default: true,
};

const context = { sanitizeUrl: (href: string) => href, eventNames: ["$pageview"] as const };

describe("P-12 posthog: forced configuration and owned instance (C-3, C-43, C-44)", () => {
  it("the init configuration holds every forced key with its value, and no host value except key and host", () => {
    const fake = fakeSdk();
    const hostConfig = { ...HOST_CONFIG, session_recording: { maskAllInputs: false }, persistence: "localStorage", loaded: () => {} };
    createPostHogProvider(fake.sdk, hostConfig as typeof HOST_CONFIG).init(context);
    expect(fake.inits).toHaveLength(1);
    const { apiKey, config } = fake.inits[0]!;
    expect(apiKey).toBe(HOST_CONFIG.key);
    const { before_send: beforeSend, ...rest } = config;
    expect(typeof beforeSend).toBe("function");
    expect(rest).toEqual(FORCED_CONFIG);
    expect(Object.keys(config).sort()).toEqual([...Object.keys(FORCED_CONFIG), "before_send"].sort());
  });

  it("the adapter imports no SDK and nothing outside its own subtree", () => {
    const source = readFileSync(new URL("./providers/posthog.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/^\.\.?\//);
    expect(source).not.toMatch(/posthog-js/);
  });

  it("init passes a name with the fixed prefix that differs between two adapters in one page", () => {
    const fake = fakeSdk();
    // The fake, like the SDK, returns an already-loaded name's instance unchanged,
    // so a shared name would make the second adapter refuse its instance.
    expect(() => createPostHogProvider(fake.sdk, HOST_CONFIG).init(context)).not.toThrow();
    expect(() => createPostHogProvider(fake.sdk, HOST_CONFIG).init(context)).not.toThrow();
    const [first, second] = fake.inits.map((call) => call.name);
    expect(first?.startsWith(POSTHOG_INSTANCE_PREFIX)).toBe(true);
    expect(second?.startsWith(POSTHOG_INSTANCE_PREFIX)).toBe(true);
    expect(first!.length).toBeGreaterThan(POSTHOG_INSTANCE_PREFIX.length);
    expect(first).not.toBe(second);
    expect(fake.loaded.size).toBe(2);
  });

  it("every later call goes to the returned instance, never to the host-supplied object", async () => {
    const fake = fakeSdk();
    const { transport } = await readyTransport(fake);
    transport.pageview({ href: "https://example.test/a" });
    transport.setPermission(false);
    transport.setPermission(true);
    expect(fake.hostCalls).toEqual([]);
    expect(fake.instanceCalls).toEqual([
      "opt_in_capturing",
      "capture:$opt_in",
      "capture:$pageview",
      "opt_out_capturing",
      "opt_in_capturing",
      "capture:$opt_in",
    ]);
  });

  it("init throws when the SDK returns nothing, the host object itself, or an instance without this adapter's own hook", () => {
    for (const initBehaviour of ["nothing", "self", "foreign"] as const) {
      const fake = fakeSdk({ initBehaviour });
      expect(() => createPostHogProvider(fake.sdk, HOST_CONFIG).init(context)).toThrow(/PostHog/);
    }
  });

  it("an already-loaded instance whose before_send is equal but not identical is refused", () => {
    const fake = fakeSdk();
    const provider = createPostHogProvider(fake.sdk, HOST_CONFIG);
    const original = fake.sdk.init.bind(fake.sdk);
    fake.sdk.init = (apiKey, config, name) => {
      const returned = original(apiKey, config, name) as PostHogLike;
      const hook = config.before_send as (r: unknown) => unknown;
      return { ...returned, config: { before_send: (r: unknown) => hook(r) } };
    };
    expect(() => provider.init(context)).toThrow(/PostHog/);
  });

  it("through the transport, a refused instance is failed with no retry and neither object receives a capture", async () => {
    for (const initBehaviour of ["nothing", "self", "foreign"] as const) {
      const fake = fakeSdk({ initBehaviour });
      const { transport, clock, loads } = await readyTransport(fake);
      transport.pageview({ href: "https://example.test/a" });
      transport.setPermission(false);
      transport.setPermission(true);
      transport.pageview({ href: "https://example.test/b" });
      await flush();
      expect(loads()).toBe(1);
      expect(clock.pending).toEqual([]);
      expect(fake.hostCalls).toEqual([]);
      expect(fake.instanceCalls).toEqual([]);
      expect(fake.sent).toEqual([]);
    }
  });

  it("reads the key and host once each and initializes with the values it validated", () => {
    const fake = fakeSdk();
    const reads = { key: 0, apiHost: 0 };
    const config = {
      get key() {
        reads.key += 1;
        return reads.key === 1 ? HOST_CONFIG.key : "other-project-key";
      },
      get apiHost() {
        reads.apiHost += 1;
        return reads.apiHost === 1 ? HOST_CONFIG.apiHost : "https://other.example.test";
      },
    };
    createPostHogProvider(fake.sdk, config).init({ sanitizeUrl: (href) => href, eventNames: ["$pageview"] });
    expect(reads).toEqual({ key: 1, apiHost: 1 });
    expect(fake.inits[0]?.apiKey).toBe(HOST_CONFIG.key);
    expect(fake.inits[0]?.config.api_host).toBe(HOST_CONFIG.apiHost);
  });

  it("refuses a missing key or host at construction, before any SDK call", () => {
    const fake = fakeSdk();
    for (const bad of [{ key: "", apiHost: "https://a.test" }, { key: "k", apiHost: "" }, { key: 1, apiHost: "https://a.test" }]) {
      expect(() => createPostHogProvider(fake.sdk, bad as unknown as typeof HOST_CONFIG)).toThrow(TypeError);
    }
    expect(fake.inits).toEqual([]);
  });

  it("calls nothing on the SDK before init, and refuses a second init", () => {
    const fake = fakeSdk();
    const provider: AnalyticsProviderPort = createPostHogProvider(fake.sdk, HOST_CONFIG);
    provider.optIn();
    provider.optOut();
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.inits).toEqual([]);
    expect(fake.hostCalls).toEqual([]);
    provider.init(context);
    expect(() => provider.init(context)).toThrow(/once/);
    expect(fake.inits).toHaveLength(1);
  });
});
