import { describe, expect, it } from "vitest";
import { createAnalyticsTransport } from "./transport.js";
import type { AnalyticsProviderPort, AnalyticsScheduler, ProviderInitContext, SanitizedAnalyticsEvent } from "./types.js";

// ---------------------------------------------------------------- fixtures

type ProviderCall =
  | { method: "init"; context: ProviderInitContext }
  | { method: "capture"; event: SanitizedAnalyticsEvent }
  | { method: "optIn" }
  | { method: "optOut" };

/** A fake provider that records every call. */
function fakeProvider(options: { initThrows?: boolean } = {}) {
  const calls: ProviderCall[] = [];
  const provider: AnalyticsProviderPort = {
    init(context) {
      calls.push({ method: "init", context });
      if (options.initThrows) throw new Error("cannot set up safely");
    },
    capture(event) {
      calls.push({ method: "capture", event });
    },
    optIn() {
      calls.push({ method: "optIn" });
    },
    optOut() {
      calls.push({ method: "optOut" });
    },
  };
  const methods = () => calls.map((call) => call.method);
  const captured = () =>
    calls.flatMap((call) => (call.method === "capture" ? [call.event.kind === "pageview" ? call.event.url : call.event.name] : []));
  return { provider, calls, methods, captured };
}

/** A loader whose every call returns a promise the test settles on demand. */
function deferredLoader() {
  const pending: Array<{ resolve: (provider: AnalyticsProviderPort) => void; reject: (error: unknown) => void }> = [];
  const load = () =>
    new Promise<AnalyticsProviderPort>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return {
    load,
    get calls() {
      return pending.length;
    },
    resolve(index: number, provider: AnalyticsProviderPort) {
      pending[index]!.resolve(provider);
    },
    reject(index: number) {
      pending[index]!.reject(new Error("load failed"));
    },
  };
}

/** A scheduler that runs nothing until the test says so. */
function manualScheduler() {
  let next = 1;
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  const cleared: unknown[] = [];
  const scheduler: AnalyticsScheduler = {
    setTimeout(fn, ms) {
      const handle = next++;
      tasks.set(handle, { fn, ms });
      return handle;
    },
    clearTimeout(handle) {
      cleared.push(handle);
      tasks.delete(handle as number);
    },
  };
  return {
    scheduler,
    cleared,
    get pending() {
      return [...tasks.values()].map((task) => task.ms);
    },
    runAll() {
      const due = [...tasks.entries()];
      tasks.clear();
      for (const [, task] of due) task.fn();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const page = (path: string) => ({ href: `https://example.test${path}?q=1#f` });

function setup(extra: { normalizePath?: (path: string) => string; maxQueued?: number } = {}) {
  const loader = deferredLoader();
  const clock = manualScheduler();
  const transport = createAnalyticsTransport({
    loadProvider: loader.load,
    allowedConversions: ["signup_started", "$identify"],
    allowedProperties: { signup_started: ["plan"] },
    scheduler: clock.scheduler,
    ...extra,
  });
  return { loader, clock, transport };
}

// ------------------------------------------------------------------ P-9

describe("P-9 transport: off by default (C-17)", () => {
  it("unknown consent never loads or captures", async () => {
    const { loader, clock, transport } = setup();
    const fake = fakeProvider();
    transport.pageview(page("/a"));
    transport.conversion("signup_started", page("/a"), { plan: "x" });
    await flush();
    expect(loader.calls).toBe(0);
    expect(clock.pending).toEqual([]);

    transport.setPermission(false);
    transport.pageview(page("/b"));
    await flush();
    expect(loader.calls).toBe(0);

    // Captures made before permission are dropped, not queued.
    transport.setPermission(true);
    expect(loader.calls).toBe(1);
    loader.resolve(0, fake.provider);
    await flush();
    expect(fake.methods()).toEqual(["init", "optIn"]);
    expect(fake.captured()).toEqual([]);
  });
});

// ------------------------------------------------------------------ P-10

describe("P-10 transport: withdrawal stops everything the transport controls (C-19)", () => {
  it("withdrawal during loading leaves the provider uninitialized when the deferred load later resolves, with no capture through it", async () => {
    const { loader, transport } = setup();
    const late = fakeProvider();
    transport.setPermission(true);
    transport.pageview(page("/queued"));
    transport.setPermission(false);
    loader.resolve(0, late.provider);
    await flush();
    expect(late.calls).toEqual([]);

    // A later grant starts a fresh load; the event queued before the
    // withdrawal is gone and never reaches the new provider either.
    const fresh = fakeProvider();
    transport.setPermission(true);
    expect(loader.calls).toBe(2);
    transport.pageview(page("/after"));
    loader.resolve(1, fresh.provider);
    await flush();
    expect(late.calls).toEqual([]);
    expect(fresh.methods()).toEqual(["init", "optIn", "capture"]);
    expect(fresh.captured()).toEqual(["https://example.test/after"]);
  });

  it("a load from before a withdrawal that resolves after a re-grant is discarded", async () => {
    const { loader, transport } = setup();
    const stale = fakeProvider();
    const fresh = fakeProvider();
    transport.setPermission(true);
    transport.setPermission(false);
    transport.setPermission(true);
    expect(loader.calls).toBe(2);
    loader.resolve(0, stale.provider);
    await flush();
    expect(stale.calls).toEqual([]);
    loader.resolve(1, fresh.provider);
    await flush();
    expect(fresh.methods()).toEqual(["init", "optIn"]);
  });

  it("withdrawal cancels a pending retry", async () => {
    const { loader, clock, transport } = setup();
    transport.setPermission(true);
    loader.reject(0);
    await flush();
    expect(clock.pending).toEqual([5000]);
    transport.setPermission(false);
    expect(clock.pending).toEqual([]);
    expect(clock.cleared).toHaveLength(1);
    clock.runAll();
    await flush();
    expect(loader.calls).toBe(1);
  });

  it("after a cancelled retry, a later grant starts a new load with a new single retry", async () => {
    const { loader, clock, transport } = setup();
    transport.setPermission(true);
    loader.reject(0);
    await flush();
    transport.setPermission(false);
    transport.setPermission(true);
    expect(loader.calls).toBe(2);
    loader.reject(1);
    await flush();
    expect(clock.pending).toEqual([5000]);
    clock.runAll();
    expect(loader.calls).toBe(3);
    loader.reject(2);
    await flush();
    expect(clock.pending).toEqual([]);
    // failed: nothing loads any more
    transport.setPermission(false);
    transport.setPermission(true);
    expect(loader.calls).toBe(3);
  });

  it("withdrawal after ready calls optOut, and captures while opted out are dropped", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    transport.setPermission(true);
    loader.resolve(0, fake.provider);
    await flush();
    transport.setPermission(false);
    transport.pageview(page("/while-off"));
    transport.conversion("signup_started", page("/while-off"));
    await flush();
    expect(fake.methods()).toEqual(["init", "optIn", "optOut"]);
  });
});

// ------------------------------------------------------- state machine

describe("transport state machine (C-18, C-43)", () => {
  it("off -> loading -> ready calls init then optIn, then flushes the queue in order", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    transport.setPermission(true);
    transport.setPermission(true);
    expect(loader.calls).toBe(1);
    transport.pageview(page("/one"));
    transport.conversion("signup_started", page("/two"), { plan: "pro", secret: "x" });
    expect(fake.calls).toEqual([]);
    loader.resolve(0, fake.provider);
    await flush();
    expect(fake.methods()).toEqual(["init", "optIn", "capture", "capture"]);
    expect(fake.calls[2]).toEqual({ method: "capture", event: { kind: "pageview", url: "https://example.test/one", properties: {} } });
    expect(fake.calls[3]).toEqual({
      method: "capture",
      event: { kind: "conversion", name: "signup_started", url: "https://example.test/two", properties: { plan: "pro" } },
    });
    transport.pageview(page("/three"));
    expect(fake.captured()).toEqual(["https://example.test/one", "signup_started", "https://example.test/three"]);
  });

  it("hands the provider the transport's URL sanitizer and event names, without $-prefixed conversions", async () => {
    const { loader, transport } = setup({ normalizePath: (path) => path.replace(/\d+/g, ":n") });
    const fake = fakeProvider();
    transport.setPermission(true);
    loader.resolve(0, fake.provider);
    await flush();
    const init = fake.calls[0];
    if (init?.method !== "init") throw new Error("expected init first");
    expect(init.context.eventNames).toEqual(["$pageview", "signup_started"]);
    expect(Object.isFrozen(init.context.eventNames)).toBe(true);
    expect(init.context.sanitizeUrl("https://example.test/u/42?x=1#y")).toBe("https://example.test/u/:n");
    expect(init.context.sanitizeUrl("/u/42")).toBeNull();
  });

  it("initializes the provider once: a grant after a withdrawal calls optIn, never a second init", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    transport.setPermission(true);
    loader.resolve(0, fake.provider);
    await flush();
    transport.pageview(page("/a"));
    transport.pageview(page("/b"));
    transport.setPermission(false);
    transport.setPermission(true);
    transport.pageview(page("/c"));
    transport.setPermission(false);
    transport.setPermission(true);
    await flush();
    expect(loader.calls).toBe(1);
    expect(fake.methods()).toEqual(["init", "optIn", "capture", "capture", "optOut", "optIn", "capture", "optOut", "optIn"]);
  });

  it("a failed load retries once after 5000 ms and can then become ready", async () => {
    const { loader, clock, transport } = setup();
    const fake = fakeProvider();
    transport.setPermission(true);
    transport.pageview(page("/queued"));
    loader.reject(0);
    await flush();
    expect(clock.pending).toEqual([5000]);
    transport.pageview(page("/queued-during-retry"));
    clock.runAll();
    expect(loader.calls).toBe(2);
    loader.resolve(1, fake.provider);
    await flush();
    expect(fake.captured()).toEqual(["https://example.test/queued", "https://example.test/queued-during-retry"]);
  });

  it("a second load failure is failed for the page load: permission recorded, nothing loads, captures dropped", async () => {
    const { loader, clock, transport } = setup();
    transport.setPermission(true);
    transport.pageview(page("/queued"));
    loader.reject(0);
    await flush();
    clock.runAll();
    loader.reject(1);
    await flush();
    expect(clock.pending).toEqual([]);
    transport.pageview(page("/dropped"));
    transport.setPermission(false);
    transport.setPermission(true);
    transport.pageview(page("/dropped"));
    await flush();
    expect(loader.calls).toBe(2);
    expect(clock.pending).toEqual([]);
  });

  it("an init that throws is failed at once, with no retry and no optIn or capture", async () => {
    const { loader, clock, transport } = setup();
    const broken = fakeProvider({ initThrows: true });
    transport.setPermission(true);
    transport.pageview(page("/queued"));
    loader.resolve(0, broken.provider);
    await flush();
    expect(broken.methods()).toEqual(["init"]);
    expect(clock.pending).toEqual([]);
    transport.pageview(page("/after"));
    transport.setPermission(false);
    transport.setPermission(true);
    await flush();
    expect(loader.calls).toBe(1);
    expect(broken.methods()).toEqual(["init"]);
  });

  it("a loader that throws synchronously counts as a failed load", async () => {
    const clock = manualScheduler();
    let calls = 0;
    const transport = createAnalyticsTransport({
      loadProvider: () => {
        calls += 1;
        throw new Error("no loader");
      },
      allowedConversions: [],
      scheduler: clock.scheduler,
    });
    transport.setPermission(true);
    await flush();
    expect(clock.pending).toEqual([5000]);
    clock.runAll();
    await flush();
    expect(calls).toBe(2);
    expect(clock.pending).toEqual([]);
  });

  it("drops an event whose normalized path is invalid, and still sends valid ones", async () => {
    const { loader, transport } = setup({ normalizePath: (path) => (path === "/bad" ? "bad" : path) });
    const fake = fakeProvider();
    transport.setPermission(true);
    loader.resolve(0, fake.provider);
    await flush();
    transport.pageview(page("/bad"));
    transport.pageview(page("/good"));
    transport.conversion("not_allowed", page("/good"));
    transport.conversion("$identify", page("/good"));
    expect(fake.captured()).toEqual(["https://example.test/good"]);
  });

  it("dispose withdraws, opts out and ignores every later call", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    transport.setPermission(true);
    loader.resolve(0, fake.provider);
    await flush();
    transport.dispose();
    transport.setPermission(true);
    transport.pageview(page("/after"));
    await flush();
    expect(fake.methods()).toEqual(["init", "optIn", "optOut"]);
    expect(loader.calls).toBe(1);
  });

  it("dispose during loading discards the late load", async () => {
    const { loader, transport } = setup();
    const late = fakeProvider();
    transport.setPermission(true);
    transport.dispose();
    loader.resolve(0, late.provider);
    await flush();
    expect(late.calls).toEqual([]);
  });

  it("rejects an invalid maxQueued", () => {
    for (const maxQueued of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createAnalyticsTransport({ loadProvider: () => Promise.reject(new Error("unused")), allowedConversions: [], maxQueued }),
      ).toThrow(RangeError);
    }
  });
});

// ------------------------------------------------- re-entrancy and errors

/** The provider calls as short labels: a capture shows its path or name. */
function trace(fake: ReturnType<typeof fakeProvider>): string[] {
  return fake.calls.map((call) =>
    call.method === "capture"
      ? `capture:${call.event.kind === "pageview" ? new URL(call.event.url).pathname : call.event.name}`
      : call.method,
  );
}

/** Records unhandled promise rejections until `stop()`; waits one macrotask so pending ones surface. */
function watchRejections() {
  const seen: unknown[] = [];
  const listener = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", listener);
  return {
    async stop() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.off("unhandledRejection", listener);
      return seen;
    },
  };
}

describe("transport re-entrancy (C-19)", () => {
  it("a withdrawal from inside a flushed capture stops the flush; nothing reaches the provider after optOut", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      capture(event) {
        fake.provider.capture(event);
        if (event.kind === "pageview" && event.url.endsWith("/a")) transport.setPermission(false);
      },
    };
    transport.setPermission(true);
    transport.pageview(page("/a"));
    transport.pageview(page("/b"));
    transport.pageview(page("/c"));
    loader.resolve(0, port);
    await flush();
    expect(trace(fake)).toEqual(["init", "optIn", "capture:/a", "optOut"]);
  });

  it("a withdrawal from inside init leaves the provider opted out, never opted in, and a later grant opts in without a second init", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      init(context) {
        fake.provider.init(context);
        transport.setPermission(false);
      },
    };
    transport.setPermission(true);
    transport.pageview(page("/a"));
    loader.resolve(0, port);
    await flush();
    expect(trace(fake)).toEqual(["init", "optOut"]);
    transport.pageview(page("/b"));
    transport.setPermission(false);
    transport.setPermission(true);
    transport.pageview(page("/c"));
    transport.setPermission(false);
    await flush();
    expect(trace(fake)).toEqual(["init", "optOut", "optIn", "capture:/c", "optOut"]);
    expect(loader.calls).toBe(1);
  });

  it("a withdrawal and a re-grant from inside init opt the provider in for the re-grant, and the second load is discarded", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      init(context) {
        fake.provider.init(context);
        transport.setPermission(false);
        transport.setPermission(true);
        transport.pageview(page("/after-regrant"));
      },
    };
    transport.setPermission(true);
    transport.pageview(page("/before-withdrawal"));
    loader.resolve(0, port);
    await flush();
    expect(trace(fake)).toEqual(["init", "optIn", "capture:/after-regrant"]);
    expect(loader.calls).toBe(2);
    const late = fakeProvider();
    loader.resolve(1, late.provider);
    await flush();
    expect(late.calls).toEqual([]);
    transport.pageview(page("/d"));
    expect(trace(fake)).toEqual(["init", "optIn", "capture:/after-regrant", "capture:/d"]);
  });

  it("a provider that calls back into the transport from inside optOut during dispose cannot opt it in again", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    let reentered = false;
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      optOut() {
        fake.provider.optOut();
        if (reentered) return;
        reentered = true;
        transport.setPermission(false);
        transport.setPermission(true);
      },
    };
    transport.setPermission(true);
    loader.resolve(0, port);
    await flush();
    transport.dispose();
    transport.pageview(page("/after"));
    expect(trace(fake)).toEqual(["init", "optIn", "optOut"]);
  });
});

describe("provider and scheduler errors never escape the transport (C-19, C-43)", () => {
  it("dispose with a throwing optOut does not throw, and nothing is sent or loaded afterwards", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      optOut() {
        fake.provider.optOut();
        throw new Error("opt-out failed");
      },
    };
    transport.setPermission(true);
    loader.resolve(0, port);
    await flush();
    expect(() => transport.dispose()).not.toThrow();
    transport.setPermission(true);
    transport.pageview(page("/after"));
    await flush();
    expect(trace(fake)).toEqual(["init", "optIn", "optOut"]);
    expect(loader.calls).toBe(1);
  });

  it("a withdrawal with a throwing optOut does not throw, and later captures are dropped", async () => {
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      optOut() {
        fake.provider.optOut();
        throw new Error("opt-out failed");
      },
    };
    transport.setPermission(true);
    loader.resolve(0, port);
    await flush();
    expect(() => transport.setPermission(false)).not.toThrow();
    transport.pageview(page("/after"));
    expect(trace(fake)).toEqual(["init", "optIn", "optOut"]);
  });

  it("a throwing capture drops that event only, in the flush and directly, with no unhandled rejection", async () => {
    const rejections = watchRejections();
    const { loader, transport } = setup();
    const fake = fakeProvider();
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      capture(event) {
        fake.provider.capture(event);
        if (event.kind === "pageview" && (event.url.endsWith("/a") || event.url.endsWith("/c"))) throw new Error("capture failed");
      },
    };
    transport.setPermission(true);
    transport.pageview(page("/a"));
    transport.pageview(page("/b"));
    loader.resolve(0, port);
    await flush();
    expect(() => transport.pageview(page("/c"))).not.toThrow();
    transport.pageview(page("/d"));
    expect(await rejections.stop()).toEqual([]);
    expect(trace(fake)).toEqual(["init", "optIn", "capture:/a", "capture:/b", "capture:/c", "capture:/d"]);
  });

  it("a throwing optIn leaves the provider opted out with the queue dropped, and a later grant opts in again", async () => {
    const rejections = watchRejections();
    const { loader, transport } = setup();
    const fake = fakeProvider();
    let optInFails = true;
    const port: AnalyticsProviderPort = {
      ...fake.provider,
      optIn() {
        fake.provider.optIn();
        if (optInFails) throw new Error("opt-in failed");
      },
    };
    transport.setPermission(true);
    transport.pageview(page("/queued"));
    loader.resolve(0, port);
    await flush();
    transport.pageview(page("/dropped"));
    expect(await rejections.stop()).toEqual([]);
    expect(trace(fake)).toEqual(["init", "optIn", "optOut"]);
    optInFails = false;
    transport.setPermission(false);
    transport.setPermission(true);
    transport.pageview(page("/sent"));
    expect(trace(fake)).toEqual(["init", "optIn", "optOut", "optOut", "optIn", "capture:/sent"]);
  });

  it("a scheduler that cannot schedule the retry is failed for the page load, with no unhandled rejection", async () => {
    const rejections = watchRejections();
    const loader = deferredLoader();
    const transport = createAnalyticsTransport({
      loadProvider: loader.load,
      allowedConversions: [],
      scheduler: {
        setTimeout() {
          throw new Error("no timers");
        },
        clearTimeout() {},
      },
    });
    transport.setPermission(true);
    loader.reject(0);
    await flush();
    transport.setPermission(false);
    transport.setPermission(true);
    await flush();
    expect(await rejections.stop()).toEqual([]);
    expect(loader.calls).toBe(1);
  });
});
