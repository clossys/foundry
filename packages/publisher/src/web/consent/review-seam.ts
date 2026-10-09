import type {
  ConsentLifecycleInput,
  ConsentLifecyclePort,
  ConsentReviewValue,
  ConsentStoragePortView,
} from "./ports.js";

/** The default query parameter, and the session marker key, for the review seam. */
export const DEFAULT_REVIEW_PARAM = "consent-review";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REVIEW_VALUES: ReadonlySet<string> = new Set(["fresh", "granted", "refused", "gpc"]);

/** True only for exactly `localhost`, `127.0.0.1` or `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

function isReviewValue(value: unknown): value is ConsentReviewValue {
  return typeof value === "string" && REVIEW_VALUES.has(value);
}

function sessionArea(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads the active review-seam value after mount, or `null` when the seam is
 * not in force. Only a loopback host is considered. A value other than
 * `live` is kept for the tab in a session marker under the parameter name;
 * `live` clears that marker. When the marker cannot be written, the value
 * lasts for the page load. An unrecognised parameter value is treated as
 * absent, so the marker decides.
 */
export function readReviewSeamValue(param: string): ConsentReviewValue | null {
  const location = globalThis.location;
  if (location === undefined || !isLoopbackHost(location.hostname)) return null;
  let fromQuery: string | null = null;
  try {
    fromQuery = new URLSearchParams(location.search).get(param);
  } catch {
    fromQuery = null;
  }
  const area = sessionArea();
  if (fromQuery === "live") {
    try {
      area?.removeItem(param);
    } catch {
      // A marker that cannot be cleared is ignored for this page load, because `live` wins here.
    }
    return null;
  }
  if (isReviewValue(fromQuery)) {
    try {
      area?.setItem(param, fromQuery);
    } catch {
      // The value then lasts for this page load only.
    }
    return fromQuery;
  }
  let marker: string | null = null;
  try {
    marker = area?.getItem(param) ?? null;
  } catch {
    marker = null;
  }
  return isReviewValue(marker) ? marker : null;
}

/** An in-memory storage port that starts empty and records each read and each write. */
export interface RecordingStoragePort {
  port: ConsentStoragePortView;
  reads(): number;
  writes(): number;
  holdsValue(): boolean;
}

export function createRecordingStoragePort(): RecordingStoragePort {
  let value: { present: true; value: unknown } | { present: false } = { present: false };
  let readCount = 0;
  let writeCount = 0;
  const port: ConsentStoragePortView = {
    read() {
      readCount += 1;
      return value.present ? { kind: "value", value: value.value } : { kind: "empty" };
    },
    write(choice) {
      writeCount += 1;
      value = { present: true, value: choice };
      return { kind: "ok" };
    },
    remove() {
      writeCount += 1;
      value = { present: false };
      return { kind: "ok" };
    },
  };
  return {
    port,
    reads: () => readCount,
    writes: () => writeCount,
    holdsValue: () => value.present,
  };
}

export type SeamLifecycleResult =
  | { ok: true; lifecycle: ConsentLifecyclePort }
  | { ok: false; reason: string };

function disposeQuietly(lifecycle: ConsentLifecyclePort): void {
  try {
    lifecycle.dispose();
  } catch {
    // Disposal failure leaves nothing for the seam to do.
  }
}

/**
 * Builds the review-seam lifecycle and checks it before any seeding call:
 * the snapshot must report `simulated: true` and the in-memory port must
 * already hold the lifecycle's mount `read()`. Only then, for `granted` and
 * `refused`, it calls `grant()` or `refuse()` once, and the in-memory port
 * must hold the seeded write. Any failure disposes the lifecycle.
 */
export function buildSeamLifecycle(
  createLifecycle: (input: ConsentLifecycleInput) => ConsentLifecyclePort,
  value: ConsentReviewValue,
): SeamLifecycleResult {
  const recorder = createRecordingStoragePort();
  let lifecycle: ConsentLifecyclePort;
  try {
    lifecycle = createLifecycle({
      signals: { gpc: value === "gpc" },
      storage: recorder.port,
      evidence: false,
      simulated: true,
    });
  } catch {
    return { ok: false, reason: "the lifecycle factory threw" };
  }
  try {
    if (lifecycle.getSnapshot().simulated !== true) {
      disposeQuietly(lifecycle);
      return { ok: false, reason: "the lifecycle does not report simulated: true" };
    }
    if (recorder.reads() === 0) {
      disposeQuietly(lifecycle);
      return { ok: false, reason: "the lifecycle did not read the supplied in-memory storage at mount" };
    }
    if (value === "granted" || value === "refused") {
      const writesBefore = recorder.writes();
      if (value === "granted") lifecycle.grant();
      else lifecycle.refuse();
      if (recorder.writes() === writesBefore || !recorder.holdsValue()) {
        disposeQuietly(lifecycle);
        return { ok: false, reason: "the in-memory storage did not receive the seeded write" };
      }
    }
  } catch {
    disposeQuietly(lifecycle);
    return { ok: false, reason: "the lifecycle threw while it was checked" };
  }
  return { ok: true, lifecycle };
}
