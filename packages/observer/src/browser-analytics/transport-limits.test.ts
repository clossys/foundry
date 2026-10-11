import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTICS_RETRY_DELAY_MS, DEFAULT_MAX_QUEUED, createAnalyticsTransport } from "./transport.js";
import type { AnalyticsProviderPort, AnalyticsScheduler, SanitizedAnalyticsEvent } from "./types.js";

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function recordingProvider() {
  const captured: SanitizedAnalyticsEvent[] = [];
  const provider: AnalyticsProviderPort = {
    init() {},
    capture(event) {
      captured.push(event);
    },
    optIn() {},
    optOut() {},
  };
  return { provider, urls: () => captured.map((event) => event.url) };
}

function deferred() {
  let resolve!: (provider: AnalyticsProviderPort) => void;
  const promise = new Promise<AnalyticsProviderPort>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const at = (path: string) => ({ href: `https://example.test${path}` });

describe("P-27 transport-limits (C-43)", () => {
  it("schedules one retry after the fixed delay through the injected scheduler", async () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const scheduler: AnalyticsScheduler = {
      setTimeout(fn, ms) {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      clearTimeout() {},
    };
    let loads = 0;
    const transport = createAnalyticsTransport({
      loadProvider: () => {
        loads += 1;
        return Promise.reject(new Error("offline"));
      },
      allowedConversions: [],
      scheduler,
    });
    transport.setPermission(true);
    await flush();
    expect(ANALYTICS_RETRY_DELAY_MS).toBe(5000);
    expect(scheduled.map((task) => task.ms)).toEqual([5000]);
    expect(loads).toBe(1);
    scheduled[0]!.fn();
    await flush();
    expect(loads).toBe(2);
    expect(scheduled).toHaveLength(1);
  });

  describe("the default scheduler", () => {
    const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    afterEach(() => {
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
    });

    it("is resolved from globalThis when scheduling, not at module scope", async () => {
      // The transport module was imported above, before these replacements.
      const scheduled: number[] = [];
      const cleared: unknown[] = [];
      const fakeSetTimeout = (fn: () => void, ms?: number) => {
        if (ms !== ANALYTICS_RETRY_DELAY_MS) return original.setTimeout(fn, ms);
        scheduled.push(ms);
        return "retry-handle";
      };
      const fakeClearTimeout = (handle: unknown) => {
        if (handle === "retry-handle") cleared.push(handle);
        else original.clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
      };
      globalThis.setTimeout = fakeSetTimeout as unknown as typeof globalThis.setTimeout;
      globalThis.clearTimeout = fakeClearTimeout as unknown as typeof globalThis.clearTimeout;

      const transport = createAnalyticsTransport({
        loadProvider: () => Promise.reject(new Error("offline")),
        allowedConversions: [],
      });
      transport.setPermission(true);
      await flush();
      expect(scheduled).toEqual([5000]);
      transport.setPermission(false);
      expect(cleared).toEqual(["retry-handle"]);
    });
  });

  it("the queue's default bound is 50 and an overflow drops the oldest", async () => {
    const load = deferred();
    const fake = recordingProvider();
    const transport = createAnalyticsTransport({ loadProvider: () => load.promise, allowedConversions: [] });
    transport.setPermission(true);
    for (let i = 0; i <= DEFAULT_MAX_QUEUED; i += 1) transport.pageview(at(`/p${i}`));
    load.resolve(fake.provider);
    await flush();
    expect(DEFAULT_MAX_QUEUED).toBe(50);
    const urls = fake.urls();
    expect(urls).toHaveLength(50);
    expect(urls[0]).toBe("https://example.test/p1");
    expect(urls[49]).toBe("https://example.test/p50");
  });

  it("honours an explicit maxQueued, including zero", async () => {
    for (const [maxQueued, expected] of [
      [2, ["https://example.test/p2", "https://example.test/p3"]],
      [0, []],
    ] as const) {
      const load = deferred();
      const fake = recordingProvider();
      const transport = createAnalyticsTransport({ loadProvider: () => load.promise, allowedConversions: [], maxQueued });
      transport.setPermission(true);
      for (let i = 0; i < 4; i += 1) transport.pageview(at(`/p${i}`));
      load.resolve(fake.provider);
      await flush();
      expect(fake.urls()).toEqual(expected);
    }
  });

  it("the subtree compiles under Observer's own compiler settings, which include no DOM library", () => {
    const configPath = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
    const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
    expect(parsed.errors).toEqual([]);
    const libs = parsed.options.lib ?? [];
    expect(libs.length).toBeGreaterThan(0);
    expect(libs.filter((lib) => /dom/i.test(lib))).toEqual([]);
    expect(parsed.options.exactOptionalPropertyTypes).toBe(true);
    expect(parsed.options.moduleResolution).toBe(ts.ModuleResolutionKind.NodeNext);

    const files = parsed.fileNames.filter((file) => file.includes("/src/browser-analytics/") && !file.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });
});
