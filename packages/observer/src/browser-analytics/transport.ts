/**
 * The consent-controlled analytics transport (C-17 to C-20, C-43).
 *
 * States, for one page load:
 *
 * - `off`: never initialized. `setPermission(true)` starts one load.
 * - `loading`: the host's loader is running. Captures go into a bounded
 *   memory queue. When the load resolves under the current generation the
 *   transport calls `init(context)` and then `optIn()`, and flushes the
 *   queue: `ready`. A load that fails schedules one retry
 *   (`retry-scheduled`); a second failure is `failed`. An `init` that throws
 *   is `failed` at once, with no retry.
 * - `ready`: captures go straight to the provider.
 * - `opted-out`: initialized, then withdrawn. `setPermission(true)` calls
 *   `optIn()` and never a second `init()`.
 * - `failed`: for the rest of the page load, permission is recorded,
 *   nothing loads and captures are dropped.
 *
 * `setPermission(false)` advances a generation counter, clears the queue,
 * cancels a scheduled retry and calls `optOut()` if the provider was
 * initialized. The loader takes no cancellation signal, so a load already in
 * flight keeps running; when it resolves under an older generation its
 * result is discarded and never initialized.
 *
 * A provider may call back into the transport from inside its own methods.
 * A withdrawal from inside `init` leaves the provider initialized and opted
 * out, never opted in; a withdrawal during the queue flush stops the flush.
 * An error thrown by a provider method or the scheduler never escapes the
 * transport: a throwing `capture` drops that event, a throwing `optIn`
 * leaves the provider opted out, a throwing `optOut` still leaves the
 * transport sending nothing, and a scheduler that cannot schedule the retry
 * is `failed`.
 *
 * The module touches no global at import. The default scheduler looks up
 * `globalThis.setTimeout` and `globalThis.clearTimeout` each time it is used.
 */

import { createUrlSanitizer, isSendableName, sanitizeAnalyticsEvent, type AnalyticsAllowlist } from "./sanitize.js";
import type {
  AnalyticsLocation,
  AnalyticsProviderPort,
  AnalyticsScheduler,
  AnalyticsTransport,
  NormalizePath,
  ProviderInitContext,
  SanitizedAnalyticsEvent,
} from "./types.js";

/** Delay before the single retry of a failed provider load. */
export const ANALYTICS_RETRY_DELAY_MS = 5000;

/** Default bound of the memory queue used while the provider loads. */
export const DEFAULT_MAX_QUEUED = 50;

/** Transport states, as documented above. */
export type AnalyticsTransportState = "off" | "loading" | "retry-scheduled" | "ready" | "opted-out" | "failed";

/** Options for `createAnalyticsTransport`. */
export interface AnalyticsTransportOptions {
  loadProvider: () => Promise<AnalyticsProviderPort>;
  allowedConversions: readonly string[];
  allowedProperties?: Readonly<Record<string, readonly string[]>>;
  /** The single source of path normalization. */
  normalizePath?: NormalizePath;
  /** Default: the global timers, looked up at call time. */
  scheduler?: AnalyticsScheduler;
  /** Default 50; an overflow drops the oldest event. */
  maxQueued?: number;
}

interface GlobalTimers {
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** Resolves the global timers when it schedules, never at module scope. */
const globalScheduler: AnalyticsScheduler = {
  setTimeout(fn, ms) {
    const timers = globalThis as unknown as GlobalTimers;
    if (typeof timers.setTimeout !== "function") throw new TypeError("No setTimeout is available to schedule a retry.");
    return timers.setTimeout(fn, ms);
  },
  clearTimeout(handle) {
    const timers = globalThis as unknown as GlobalTimers;
    if (typeof timers.clearTimeout === "function") timers.clearTimeout(handle);
  },
};

/** Creates a transport. Constructing it performs no I/O; permission starts `false`. */
export function createAnalyticsTransport(options: AnalyticsTransportOptions): AnalyticsTransport {
  const maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
  if (!Number.isInteger(maxQueued) || maxQueued < 0) {
    throw new RangeError("maxQueued must be a whole number of at least 0.");
  }
  const scheduler = options.scheduler ?? globalScheduler;
  const allowlist: AnalyticsAllowlist = {
    conversions: [...options.allowedConversions],
    ...(options.allowedProperties ? { properties: options.allowedProperties } : {}),
    ...(options.normalizePath ? { normalizePath: options.normalizePath } : {}),
  };
  const context: ProviderInitContext = Object.freeze({
    sanitizeUrl: createUrlSanitizer(options.normalizePath),
    eventNames: Object.freeze(["$pageview", ...new Set(options.allowedConversions.filter(isSendableName))]),
  });

  let state: AnalyticsTransportState = "off";
  let permission = false;
  let disposed = false;
  let generation = 0;
  let provider: AnalyticsProviderPort | null = null;
  let queue: SanitizedAnalyticsEvent[] = [];
  let retryHandle: { value: unknown } | null = null;

  function cancelRetry(): void {
    if (retryHandle) {
      const handle = retryHandle.value;
      retryHandle = null;
      try {
        scheduler.clearTimeout(handle);
      } catch {
        // The retry callback checks its own handle, so a failed clear is harmless.
      }
    }
  }

  /** Calls `optOut()`, swallowing its error: the transport's own state already stops sending. */
  function optOutQuietly(target: AnalyticsProviderPort): void {
    try {
      target.optOut();
    } catch {
      // Nothing further is sent: the state is already opted-out or disposed.
    }
  }

  /** Calls `optIn()`; when it throws, the provider is left opted out instead. */
  function optInOrOptOut(target: AnalyticsProviderPort): boolean {
    try {
      target.optIn();
      return true;
    } catch {
      state = "opted-out";
      queue = [];
      optOutQuietly(target);
      return false;
    }
  }

  function captureQuietly(target: AnalyticsProviderPort, event: SanitizedAnalyticsEvent): void {
    try {
      target.capture(event);
    } catch {
      // The event is dropped.
    }
  }

  function fail(): void {
    state = "failed";
    queue = [];
    cancelRetry();
  }

  function attemptLoad(forGeneration: number, isRetry: boolean): void {
    state = "loading";
    let pending: Promise<AnalyticsProviderPort>;
    try {
      pending = Promise.resolve(options.loadProvider());
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (loaded) => onLoaded(forGeneration, loaded),
      () => onLoadFailed(forGeneration, isRetry),
    );
  }

  function onLoaded(forGeneration: number, loaded: AnalyticsProviderPort): void {
    // A load that resolves after a withdrawal is discarded, never initialized.
    if (disposed || forGeneration !== generation || state !== "loading") return;
    try {
      loaded.init(context);
    } catch {
      fail();
      return;
    }
    provider = loaded;
    if (disposed || !permission) {
      // Withdrawn from inside init: initialized, but never opted in.
      state = "opted-out";
      queue = [];
      optOutQuietly(loaded);
      return;
    }
    // A withdrawal and a re-grant from inside init leave permission granted:
    // this provider serves the current generation, and the load the re-grant
    // started is discarded when it resolves, because the state is no longer
    // loading.
    const current = generation;
    state = "ready";
    if (!optInOrOptOut(loaded)) return;
    const queued = queue;
    queue = [];
    for (const event of queued) {
      // A withdrawal from inside optIn or a capture stops the flush.
      if (disposed || current !== generation || state !== "ready" || provider !== loaded) return;
      captureQuietly(loaded, event);
    }
  }

  function onLoadFailed(forGeneration: number, isRetry: boolean): void {
    if (disposed || forGeneration !== generation || state !== "loading") return;
    if (isRetry) {
      fail();
      return;
    }
    state = "retry-scheduled";
    const handle = { value: undefined as unknown };
    retryHandle = handle;
    try {
      handle.value = scheduler.setTimeout(() => {
        if (retryHandle !== handle) return;
        retryHandle = null;
        if (disposed || forGeneration !== generation || state !== "retry-scheduled") return;
        attemptLoad(forGeneration, true);
      }, ANALYTICS_RETRY_DELAY_MS);
    } catch {
      // No retry can be scheduled.
      retryHandle = null;
      fail();
    }
  }

  function withdraw(): void {
    generation += 1;
    queue = [];
    cancelRetry();
    if (provider) {
      state = "opted-out";
      optOutQuietly(provider);
    } else {
      state = "off";
    }
  }

  function deliver(event: SanitizedAnalyticsEvent | null): void {
    if (event === null) return;
    if (state === "ready" && provider) {
      captureQuietly(provider, event);
      return;
    }
    if (state === "loading" || state === "retry-scheduled") {
      if (maxQueued === 0) return;
      queue.push(event);
      while (queue.length > maxQueued) queue.shift();
    }
  }

  function accepting(): boolean {
    return !disposed && permission && state !== "failed";
  }

  return {
    setPermission(allowed: boolean): void {
      if (disposed) return;
      const next = allowed === true;
      if (state === "failed") {
        permission = next;
        return;
      }
      if (next === permission) return;
      permission = next;
      if (!next) {
        withdraw();
        return;
      }
      if (provider) {
        state = "ready";
        optInOrOptOut(provider);
        return;
      }
      attemptLoad(generation, false);
    },

    pageview(location: AnalyticsLocation): void {
      if (!accepting()) return;
      deliver(sanitizeAnalyticsEvent({ kind: "pageview", location }, allowlist));
    },

    conversion(name: string, location: AnalyticsLocation, properties?: Record<string, unknown>): void {
      if (!accepting()) return;
      deliver(
        sanitizeAnalyticsEvent(
          properties === undefined ? { kind: "conversion", name, location } : { kind: "conversion", name, location, properties },
          allowlist,
        ),
      );
    },

    dispose(): void {
      if (disposed) return;
      const active = permission && state !== "failed";
      // Set first, so a provider that calls back into the transport from
      // inside optOut finds it already disposed.
      disposed = true;
      permission = false;
      if (active) {
        withdraw();
      } else {
        generation += 1;
        queue = [];
        cancelRetry();
      }
    },
  };
}
