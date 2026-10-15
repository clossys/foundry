/**
 * Shared fixtures for the PostHog autocapture and replay tests (unit F).
 *
 * The fake SDK records every call in order with the state of the capture
 * gate at that call, returns a named instance whose `config` echoes what it
 * received (and can be told to report altered masking keys), runs the
 * configured `before_send` hook for transport, autocapture and snapshot
 * events, and calls back into the adapter from inside any method. Nothing
 * here imports or installs the real SDK, and nothing reads the environment.
 *
 * This file is a test file (`*.test.ts`) so that it is neither compiled into
 * `dist` nor published; it carries a small self-test so the runner accepts it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostHogProvider, type PostHogLike, type PostHogProviderConfig } from "./providers/posthog.js";
import type { ReplayCapability } from "./providers/posthog-options.js";
import { createAnalyticsTransport } from "./transport.js";
import type { AnalyticsProviderPort, AnalyticsScheduler } from "./types.js";

// ------------------------------------------------------------------ page

export const PAGE = "https://example.test/pricing";

export interface PageOptions {
  /** `location.href`; `null` removes `location`. */
  href?: string | null;
  /** The navigation entry's name; `null` for no entry, `"throw"` for a throwing API. */
  load?: string | null | "throw";
  /** Queue of draws in [0, 1) for single-word requests; `"none"` removes the secure source. */
  draws?: readonly number[] | "none";
}

let drawQueue: number[] = [];

/** Stubs the page globals the adapter reads at call time. Undone by `afterEach` below. */
export function setPage(options: PageOptions = {}): void {
  const href = options.href === undefined ? PAGE : options.href;
  vi.stubGlobal("location", href === null ? undefined : { href });
  const load = options.load === undefined ? PAGE : options.load;
  vi.stubGlobal(
    "performance",
    load === "throw"
      ? {
          getEntriesByType() {
            throw new Error("navigation timing unavailable");
          },
        }
      : { getEntriesByType: (type: string) => (type === "navigation" && load !== null ? [{ name: load }] : []) },
  );
  if (options.draws === "none") {
    vi.stubGlobal("crypto", undefined);
  } else {
    drawQueue = [...(options.draws ?? [0])];
    vi.stubGlobal("crypto", {
      getRandomValues(array: Uint32Array) {
        // One word is a replay draw; the instance suffix asks for two.
        if (array.length === 1) {
          const next = drawQueue.length > 0 ? drawQueue.shift()! : 0;
          array[0] = Math.floor(next * 0x100000000);
        } else {
          for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(Math.random() * 0x100000000);
        }
        return array;
      },
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  drawQueue = [];
});

// ------------------------------------------------------------------- fake

export interface RecordedCall {
  name: string;
  /** Whether the hook accepted a valid autocapture event at this call; `null` when autocapture is off. */
  gate: boolean | null;
}

export interface FakeOptions {
  /** What `init` returns: the named instance (default), nothing or the host object. */
  initBehaviour?: "instance" | "nothing";
  /** Method names left off the instance. */
  omit?: readonly string[];
  /** Method names that record the call and then throw. */
  throwIn?: readonly string[];
  /** Properties the fake SDK adds to every captured event. */
  autoProperties?: Record<string, unknown>;
  /** When true, the SDK's own properties win over the ones the adapter passes to `capture`. */
  sdkWins?: boolean;
}

const AUTO_PROPERTIES: Readonly<Record<string, unknown>> = {
  token: "sdk-token",
  distinct_id: "anon-123",
  $lib: "web",
  $lib_version: "9.9.9",
  $insert_id: "insert-1",
  $time: 1700000000,
  $process_person_profile: false,
  $browser: "Browser",
  $device_id: "device-abc",
  email: "person@example.test",
};

const GATE_PROBE_PROPERTIES = {
  $current_url: PAGE,
  $event_type: "click",
  $elements_chain: 'button:attr__data-analytics-id="gate-probe"',
};

export interface Fake {
  sdk: PostHogLike;
  /** Every call made on the returned instance, in order. */
  calls: RecordedCall[];
  /** The `(apiKey, config, name)` of every `init`. */
  inits: Array<{ apiKey: string; config: Record<string, unknown>; name: string }>;
  /** Events the hook let through, as the SDK would send them. */
  sent: Array<Record<string, unknown>>;
  /** Names of events the hook dropped. */
  dropped: string[];
  /** Calls made on the host-supplied object. */
  hostCalls: string[];
  /** Runs the hook for an SDK event; returns what the hook returned. */
  emit(event: string, properties?: Record<string, unknown>, extra?: Record<string, unknown>): unknown;
  /** Runs the hook on a bare value, as a hostile SDK might. */
  emitRaw(value: unknown): unknown;
  /** The recording options the instance reports; assign a function to alter them. */
  reportedRecording: ((configured: unknown) => unknown) | null;
  reportedConsoleLog: ((configured: unknown) => unknown) | null;
  /** Callbacks run inside a method, after the call is recorded and before it throws. */
  inside: Record<string, (() => void) | undefined>;
  /** The session id `get_session_id` returns; `reset` rotates it when `rotateOnReset`. */
  session: { id: unknown; rotateOnReset: boolean; counter: number };
  /** The hook the adapter installed. */
  hook(): ((result: unknown) => unknown) | undefined;
  names(): string[];
  instance(): PostHogLike | undefined;
}

export function createFake(options: FakeOptions = {}): Fake {
  const calls: RecordedCall[] = [];
  const inits: Fake["inits"] = [];
  const sent: Array<Record<string, unknown>> = [];
  const dropped: string[] = [];
  const hostCalls: string[] = [];
  let created: PostHogLike | undefined;
  let storedConfig: Record<string, unknown> = {};
  const omit = new Set(options.omit ?? []);
  const throwIn = new Set(options.throwIn ?? []);
  const auto = { ...AUTO_PROPERTIES, ...options.autoProperties };

  const fake = {
    calls,
    inits,
    sent,
    dropped,
    hostCalls,
    reportedRecording: null,
    reportedConsoleLog: null,
    inside: {},
    session: { id: "session-1", rotateOnReset: true, counter: 1 },
  } as unknown as Fake;

  const hook = () => storedConfig.before_send as ((result: unknown) => unknown) | undefined;

  function run(result: unknown, label: string): unknown {
    const callable = hook();
    const out = typeof callable === "function" ? callable(result) : result;
    if (out !== null && out !== undefined) sent.push(out as Record<string, unknown>);
    else dropped.push(label);
    return out;
  }

  function gateState(): boolean | null {
    const autocapture = storedConfig.autocapture;
    if (autocapture === false || autocapture === undefined) return null;
    const callable = hook();
    if (typeof callable !== "function") return null;
    try {
      return callable({ uuid: "probe", event: "$autocapture", timestamp: "t", properties: { ...auto, ...GATE_PROBE_PROPERTIES } }) !== null;
    } catch {
      return null;
    }
  }

  function record(name: string): void {
    calls.push({ name, gate: gateState() });
    fake.inside[name]?.();
    if (throwIn.has(name)) throw new Error(`${name} failed`);
  }

  function emit(event: string, properties: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): unknown {
    return run(
      {
        uuid: "uuid-1",
        event,
        timestamp: "2026-01-01T00:00:00.000Z",
        properties: { ...auto, $current_url: PAGE, ...properties },
        $set: { email: "person@example.test" },
        $set_once: { first_seen: "2026-01-01" },
        ...extra,
      },
      event,
    );
  }

  const methods: Record<string, unknown> = {
    init() {
      throw new Error("instance.init is not called by the adapter");
    },
    capture(eventName: string, properties: Record<string, unknown> = {}) {
      record(`capture:${eventName}`);
      emit(eventName, options.sdkWins ? { ...properties, ...auto } : properties);
    },
    opt_in_capturing() {
      record("opt_in_capturing");
      emit("$opt_in");
    },
    opt_out_capturing() {
      record("opt_out_capturing");
    },
    startSessionRecording() {
      record("startSessionRecording");
    },
    stopSessionRecording() {
      record("stopSessionRecording");
    },
    reset() {
      record("reset");
      if (fake.session.rotateOnReset) {
        fake.session.counter += 1;
        fake.session.id = `session-${fake.session.counter}`;
      }
    },
    get_session_id() {
      record("get_session_id");
      return fake.session.id;
    },
  };

  function makeInstance(): PostHogLike {
    const instance: Record<string, unknown> = {
      get config() {
        const recording = storedConfig.session_recording;
        return {
          before_send: storedConfig.before_send,
          session_recording: fake.reportedRecording ? fake.reportedRecording(recording) : recording,
          enable_recording_console_log: fake.reportedConsoleLog
            ? fake.reportedConsoleLog(storedConfig.enable_recording_console_log)
            : storedConfig.enable_recording_console_log,
        };
      },
    };
    for (const [name, method] of Object.entries(methods)) {
      if (!omit.has(name)) instance[name] = method;
    }
    return instance as unknown as PostHogLike;
  }

  const sdk: PostHogLike = {
    init(apiKey, config, name) {
      inits.push({ apiKey, config, name });
      storedConfig = config;
      if (options.initBehaviour === "nothing") return undefined;
      created = makeInstance();
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

  Object.assign(fake, {
    sdk,
    emit,
    emitRaw: (value: unknown) => run(value, "raw"),
    hook,
    names: () => calls.map((call) => call.name),
    instance: () => created,
  });
  return fake;
}

// -------------------------------------------------------------- providers

export const HOST = { key: "test-project-key", apiHost: "https://analytics.example.test" };

export const GOOD_PROBE: ReplayCapability = {
  masksAllText: true,
  masksAllInputs: true,
  honoursBlockSelector: true,
  recordsNoNetworkPayloads: true,
  recordsNoConsole: true,
  recordsNoCanvas: true,
  recordsNavigationAddress: true,
  snapshotsPassBeforeSend: true,
};

export interface FlagOptions {
  autocapture?: boolean;
  replay?: boolean;
  sampleRate?: number;
  blockSelectors?: readonly string[];
  probe?: () => unknown;
}

/** A provider configuration for a flag combination; replay defaults to sampleRate 1 and a passing probe. */
export function configFor(flags: FlagOptions = {}): PostHogProviderConfig {
  const config: Record<string, unknown> = { ...HOST };
  if (flags.autocapture !== undefined) config.autocapture = { enabled: flags.autocapture };
  if (flags.replay !== undefined) {
    config.replay = {
      enabled: flags.replay,
      sampleRate: flags.sampleRate ?? 1,
      probe: flags.probe ?? (() => ({ ...GOOD_PROBE })),
      ...(flags.blockSelectors ? { blockSelectors: flags.blockSelectors } : {}),
    };
  }
  return config as unknown as PostHogProviderConfig;
}

export const identityUrl = (href: string): string | null => {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

export const CONTEXT = { sanitizeUrl: identityUrl, eventNames: ["$pageview", "signup_started"] };

export interface Started {
  fake: Fake;
  provider: AnalyticsProviderPort;
}

/** Creates the adapter, initializes it and opts in, as the transport does for a grant. */
export function start(flags: FlagOptions = {}, fakeOptions: FakeOptions = {}): Started {
  const fake = createFake(fakeOptions);
  const provider = createPostHogProvider(fake.sdk, configFor(flags));
  provider.init(CONTEXT);
  provider.optIn();
  return { fake, provider };
}

/** Creates and initializes the adapter without opting in. */
export function initOnly(flags: FlagOptions = {}, fakeOptions: FakeOptions = {}): Started {
  const fake = createFake(fakeOptions);
  const provider = createPostHogProvider(fake.sdk, configFor(flags));
  provider.init(CONTEXT);
  return { fake, provider };
}

export const BOTH: FlagOptions = { autocapture: true, replay: true };

// ----------------------------------------------------------- transport

export function manualScheduler() {
  const queue: Array<() => void> = [];
  const scheduler: AnalyticsScheduler = {
    setTimeout(fn) {
      queue.push(fn);
      return queue.length;
    },
    clearTimeout() {},
  };
  return {
    scheduler,
    queue,
    fire() {
      const next = queue.shift();
      next?.();
    },
  };
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

export function transportFor(load: () => AnalyticsProviderPort | Promise<AnalyticsProviderPort>) {
  const clock = manualScheduler();
  const transport = createAnalyticsTransport({
    loadProvider: async () => load(),
    allowedConversions: ["signup_started"],
    allowedProperties: { signup_started: ["plan"] },
    scheduler: clock.scheduler,
  });
  return { transport, clock };
}

// ----------------------------------------------------- autocapture corpus

export const CHAIN_PARTS = {
  target: 'button.btn.primary:attr__data-analytics-id="cta-main"attr__href="/buy?token=abc123"attr__class="btn primary"nth-child="1"nth-of-type="1"text="Buy now secret-text"',
  div: 'div:attr__class="card"attr__id="card-1"nth-child="2"nth-of-type="1"',
  body: 'body:nth-child="1"nth-of-type="1"',
};

export function chain(...parts: string[]): string {
  return parts.join(";");
}

export function clickProperties(elementsChain: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $event_type: "click",
    $elements_chain: elementsChain,
    $el_text: "Buy now secret-text",
    $elements: [{ tag_name: "button", $el_text: "Buy now secret-text", attr__href: "/buy?token=abc123" }],
    $external_click_url: "https://other.test/leak?token=abc123",
    attr__href: "/buy?token=abc123",
    $current_url: PAGE + "?token=abc123#frag",
    ...extra,
  };
}

// ------------------------------------------------------- snapshot corpus

export const MASK = "****";

let nodeId = 0;
const id = () => (nodeId += 1);

export const node = {
  text(textContent: string, extra: Record<string, unknown> = {}) {
    return { type: 3, textContent, id: id(), ...extra };
  },
  comment(textContent: string) {
    return { type: 5, textContent, id: id() };
  },
  cdata(textContent: string) {
    return { type: 4, textContent, id: id() };
  },
  element(tagName: string, attributes: Record<string, unknown> = {}, childNodes: unknown[] = []) {
    return { type: 2, tagName, attributes, childNodes, id: id() };
  },
  document(childNodes: unknown[]) {
    return { type: 0, childNodes, id: id() };
  },
};

export const rec = {
  fullSnapshot(children: unknown[]) {
    const html = node.element("html", {}, [node.element("body", {}, children)]);
    return { type: 2, data: { node: node.document([{ type: 1, name: "html", id: id() }, html]), initialOffset: { top: 0, left: 0 } }, timestamp: 1 };
  },
  meta(href: string) {
    return { type: 4, data: { href, width: 800, height: 600 }, timestamp: 1 };
  },
  custom(data: Record<string, unknown>) {
    return { type: 5, data: { tag: "annotation", payload: data }, timestamp: 1 };
  },
  mutation(parts: { texts?: unknown; attributes?: unknown; removes?: unknown; adds?: unknown }) {
    return { type: 3, data: { source: 0, texts: [], attributes: [], removes: [], adds: [], ...parts }, timestamp: 1 };
  },
  input(text: unknown) {
    return { type: 3, data: { source: 5, text, isChecked: false, id: 1 }, timestamp: 1 };
  },
  incremental(source: number, extra: Record<string, unknown> = {}) {
    return { type: 3, data: { source, ...extra }, timestamp: 1 };
  },
  plugin(plugin: string, payload: Record<string, unknown> = {}) {
    return { type: 6, data: { plugin, payload }, timestamp: 1 };
  },
};

/** A payload that passes: masked text, a style element's text, a value attribute in masked form, a clean address. */
export function validSnapshot(): unknown[] {
  return [
    rec.meta(PAGE),
    rec.fullSnapshot([
      node.element("style", {}, [node.text("body { color: red }", { isStyle: true })]),
      node.element("p", { class: "card" }, [node.text(MASK)]),
      node.element("input", { type: "text", value: MASK }),
    ]),
    rec.mutation({
      texts: [{ id: 1, value: MASK }],
      attributes: [{ id: 2, attributes: { value: MASK, title: "kept" } }],
      adds: [{ parentId: 1, nextId: null, node: node.element("span", {}, [node.text("  **  ")]) }],
    }),
    rec.input(MASK),
    rec.incremental(3, { id: 1, x: 0, y: 10 }),
    rec.custom({ href: PAGE }),
  ];
}

export function snapshotProperties(data: unknown, session = "session-1"): Record<string, unknown> {
  return { $snapshot_data: data, $session_id: session, $window_id: "window-1", $snapshot_bytes: 99, $snapshot_source: "web" };
}

// ------------------------------------------------------------- self-test

describe("posthog fake SDK fixture", () => {
  it("records calls with the gate state, echoes the configuration and runs the hook", () => {
    setPage();
    const { fake, provider } = start({ autocapture: true });
    expect(fake.names()).toEqual(["opt_in_capturing"]);
    expect(fake.calls[0]).toEqual({ name: "opt_in_capturing", gate: false });
    provider.capture({ kind: "pageview", url: PAGE, properties: {} });
    expect(fake.sent.map((event) => event.event)).toEqual(["$pageview"]);
    expect(fake.instance()?.config?.before_send).toBe(fake.hook());
    expect(fake.hostCalls).toEqual([]);
  });

  it("reports altered recording options and rotates the session on reset", () => {
    setPage();
    const { fake } = start(BOTH);
    fake.reportedRecording = (configured) => ({ ...(configured as object), maskAllInputs: false });
    expect((fake.instance()?.config?.session_recording as { maskAllInputs: boolean }).maskAllInputs).toBe(false);
    const before = fake.session.id;
    fake.instance()?.reset?.();
    expect(fake.session.id).not.toBe(before);
  });
});
