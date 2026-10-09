/**
 * Structural ports for the browser consent assembly.
 *
 * Publisher reaches the consent lifecycle and the analytics transport only
 * through these shapes. They mirror the lifecycle package's own types field
 * for field, and they are declared here rather than imported, so this
 * package depends on no consent or analytics implementation. The host
 * composes the real implementations and passes them in.
 */

/** The consent regime the lifecycle reports. The snapshot is the single regime source. */
export type ConsentRegimeView = "prompt" | "notice";

/** The effective choice the lifecycle reports. */
export type EffectiveChoiceView = "granted" | "denied" | "none" | "unknown";

/**
 * Evidence status. `"simulated-saved"` is produced only by the fixed-clock
 * preview, so a simulated acknowledgement never reads as durable.
 */
export type EvidenceStatusView = "none" | "pending" | "saved" | "conflict" | "unavailable" | "simulated-saved";

/** A structural mirror of the lifecycle's snapshot. */
export interface ConsentSnapshotView {
  regime: ConsentRegimeView;
  effective: EffectiveChoiceView;
  allowed: boolean;
  promptAutomatically: boolean;
  persistence: "stored" | "memory" | "none";
  storage: "readable" | "unreadable";
  evidence: EvidenceStatusView;
  withdrawal: "idle" | "failed";
  gpcInForce: boolean;
  simulated: boolean;
  sequence: number;
}

/** A structural mirror of the lifecycle's synchronous storage port. */
export interface ConsentStoragePortView {
  read(): { kind: "value"; value: unknown } | { kind: "empty" } | { kind: "unavailable" };
  write(choice: unknown): { kind: "ok" } | { kind: "unavailable" };
  remove(): { kind: "ok" } | { kind: "unavailable" };
  subscribe?(onExternalChange: () => void): () => void;
}

/**
 * What the assembly passes to the host's lifecycle factory. `storage`,
 * `evidence` and `simulated` are present only under the review seam, and
 * the factory honours each one when present.
 */
export interface ConsentLifecycleInput {
  signals: { gpc: boolean };
  storage?: ConsentStoragePortView;
  evidence?: false;
  simulated?: true;
}

/** A structural mirror of the lifecycle. */
export interface ConsentLifecyclePort {
  getSnapshot(): ConsentSnapshotView;
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshotView;
  refuse(): ConsentSnapshotView;
  refresh(): ConsentSnapshotView;
  dispose(): void;
}

/** A structural mirror of the analytics transport's permission input. */
export interface AnalyticsPermissionPort {
  setPermission(allowed: boolean): void;
}

/** A review-seam value other than `live`. */
export type ConsentReviewValue = "fresh" | "granted" | "refused" | "gpc";

/**
 * The status a host may read. `simulated` is `false` for a live lifecycle,
 * the active review-seam value under the seam, and `"preview"` for any other
 * lifecycle whose snapshot reports `simulated: true`.
 */
export interface ConsentStatusView {
  persistence: ConsentSnapshotView["persistence"];
  storage: ConsentSnapshotView["storage"];
  evidence: ConsentSnapshotView["evidence"];
  withdrawal: ConsentSnapshotView["withdrawal"];
  gpcInForce: boolean;
  simulated: false | ConsentReviewValue | "preview";
}

/** The server and pre-mount snapshot. Internal: the lifecycle package owns the public constant. */
export const NO_DECISION_VIEW: ConsentSnapshotView = Object.freeze({
  regime: "prompt",
  effective: "none",
  allowed: false,
  promptAutomatically: false,
  persistence: "none",
  storage: "readable",
  evidence: "none",
  withdrawal: "idle",
  gpcInForce: false,
  simulated: false,
  sequence: 0,
});

/** The status that matches `NO_DECISION_VIEW`. */
export const NO_DECISION_STATUS: ConsentStatusView = Object.freeze({
  persistence: "none",
  storage: "readable",
  evidence: "none",
  withdrawal: "idle",
  gpcInForce: false,
  simulated: false,
});
