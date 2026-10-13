import { NO_DECISION_VIEW } from "../ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "../ports.js";

/** The fifteen fixed preview states. */
export type ConsentPreviewState =
  | "fresh-prompt"
  | "fresh-notice"
  | "remembered-granted"
  | "remembered-refused"
  | "withdrawn"
  | "expired"
  | "gpc"
  | "not-required"
  | "pending-grant"
  | "simulated-saved"
  | "conflict"
  | "unavailable"
  | "pending-withdrawal"
  | "withdrawal-failed"
  | "reopen-unreadable";

/** The outcomes an explicit `settle()` can apply to pending evidence. A preview never produces `"saved"`. */
export type ConsentPreviewSettleResult = "simulated-saved" | "conflict" | "unavailable";

export interface ConsentPreviewOptions {
  state: ConsentPreviewState;
  /** A fixed ISO instant. The preview never reads a clock. */
  now: string;
  /** `"production"` is refused. */
  environment: "development" | "preview" | "production";
}

export interface ConsentPreview {
  lifecycle: ConsentLifecyclePort;
  /** `false` only for `"not-required"`. */
  required: boolean;
  settle(result: ConsentPreviewSettleResult): void;
  dispose(): void;
}

type SnapshotFields = Partial<Omit<ConsentSnapshotView, "simulated">>;

const PENDING_GRANT: SnapshotFields = { effective: "granted", allowed: true, persistence: "stored", evidence: "pending" };
const FRESH_PROMPT: SnapshotFields = { regime: "prompt", effective: "none", promptAutomatically: true };

/** Exactly the preview table: every field not listed keeps its no-decision value, and `simulated` is `true`. */
const STATE_FIELDS: Readonly<Record<ConsentPreviewState, SnapshotFields>> = {
  "fresh-prompt": FRESH_PROMPT,
  "fresh-notice": { regime: "notice", effective: "none", allowed: true },
  "remembered-granted": { effective: "granted", allowed: true, persistence: "stored" },
  "remembered-refused": { effective: "denied", persistence: "stored" },
  withdrawn: { effective: "denied", persistence: "stored", sequence: 1 },
  expired: FRESH_PROMPT,
  gpc: { effective: "denied", gpcInForce: true },
  "not-required": {},
  "pending-grant": PENDING_GRANT,
  "simulated-saved": { ...PENDING_GRANT, evidence: "simulated-saved" },
  conflict: { ...PENDING_GRANT, evidence: "conflict" },
  unavailable: { ...PENDING_GRANT, evidence: "unavailable" },
  "pending-withdrawal": { effective: "denied", persistence: "stored", evidence: "pending", sequence: 1 },
  "withdrawal-failed": { effective: "denied", persistence: "memory", withdrawal: "failed" },
  "reopen-unreadable": { effective: "unknown", storage: "unreadable" },
};

const SETTLE_RESULTS: ReadonlySet<string> = new Set(["simulated-saved", "conflict", "unavailable"]);

function snapshotFor(fields: SnapshotFields): ConsentSnapshotView {
  return Object.freeze({ ...NO_DECISION_VIEW, ...fields, simulated: true });
}

function isProductionBuild(): boolean {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.NODE_ENV === "production";
}

/**
 * A deterministic, inert lifecycle for development review of every notice
 * state. It uses no storage, no network, no timer and no clock read, and
 * every snapshot reports `simulated: true`, so no transport is bound to it
 * and analytics reads as not allowed. Asynchronous outcomes happen only on
 * an explicit `settle()`. `dispose()` releases every listener.
 *
 * Throws for `environment: "production"`, and when `process.env.NODE_ENV`
 * is `"production"` at call time.
 */
export function createConsentPreview(options: ConsentPreviewOptions): ConsentPreview {
  const { state, now, environment } = options;
  if (environment !== "development" && environment !== "preview") {
    throw new Error('createConsentPreview: the fixed-clock preview is refused outside "development" and "preview".');
  }
  if (isProductionBuild()) {
    throw new Error("createConsentPreview: the fixed-clock preview is refused in a production build.");
  }
  if (!Object.hasOwn(STATE_FIELDS, state)) {
    throw new Error("createConsentPreview: unknown preview state.");
  }
  if (typeof now !== "string" || !Number.isFinite(Date.parse(now))) {
    throw new Error("createConsentPreview: now must be a fixed ISO instant.");
  }

  let snapshot = snapshotFor(STATE_FIELDS[state]);
  let listeners = new Set<() => void>();
  let disposed = false;

  const publish = (next: ConsentSnapshotView): ConsentSnapshotView => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
    return snapshot;
  };

  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    grant() {
      // A grant under a signal that cannot be overridden is a no-op, and a
      // grant never clears a failed withdrawal, the sole failure signal.
      // grant() is a no-op while a withdrawal has failed; that differs from Butler's lifecycle by design (C-33, C-34).
      if (disposed || snapshot.gpcInForce || snapshot.withdrawal === "failed") return snapshot;
      return publish(
        Object.freeze({ ...snapshot, ...PENDING_GRANT, promptAutomatically: false, sequence: snapshot.sequence + 1 }),
      );
    },
    refuse() {
      if (disposed) return snapshot;
      if (snapshot.withdrawal === "failed") {
        return publish(Object.freeze({ ...snapshot, sequence: snapshot.sequence + 1 }));
      }
      return publish(
        Object.freeze({
          ...snapshot,
          effective: "denied",
          allowed: false,
          promptAutomatically: false,
          persistence: "stored",
          evidence: "pending",
          sequence: snapshot.sequence + 1,
        }),
      );
    },
    refresh: () => snapshot,
    dispose() {
      disposed = true;
      listeners = new Set();
    },
  };

  return {
    lifecycle,
    required: state !== "not-required",
    settle(result) {
      if (!SETTLE_RESULTS.has(result)) {
        throw new Error('createConsentPreview: settle() takes "simulated-saved", "conflict" or "unavailable".');
      }
      if (disposed || snapshot.evidence !== "pending") return;
      publish(Object.freeze({ ...snapshot, evidence: result }));
    },
    dispose: () => lifecycle.dispose(),
  };
}
