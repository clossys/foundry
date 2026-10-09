/**
 * The browser consent lifecycle: one visitor's choice for one document
 * load, held against a synchronous storage port and, optionally, an
 * asynchronous evidence port for a durable acknowledgement.
 *
 * Gating follows the local record and never waits for evidence. A choice
 * whose write failed holds in memory for the visit and never reaches the
 * evidence port. A withdrawal publishes `allowed: false` before anything
 * else and counts as done only when a read-back of storage says not
 * allowed. Re-reads never replace a choice made this visit with a record
 * that is not live or not newer.
 *
 * Nothing here runs at import. Every port is called only from a function
 * the host calls.
 */

import {
  effectiveChoice,
  isAllowed,
  isLiveChoice,
  liveChoice,
  shouldPromptAutomatically,
} from "./decision.js";
import {
  assertConsentPolicy,
  decideChoice,
  gpcInForce,
  normalizeRegime,
  parseStoredChoice,
  type ConsentPolicy,
  type ConsentRegime,
  type ConsentSignals,
  type EffectiveChoice,
  type StoredChoice,
  type StoredInput,
} from "./record.js";

export type StorageRead = { kind: "value"; value: unknown } | { kind: "empty" } | { kind: "unavailable" };
export type StorageWrite = { kind: "ok" } | { kind: "unavailable" };

/** Synchronous on purpose: pre-hydration callers and external-store hooks need a synchronous read. */
export interface ConsentStoragePort {
  /** The raw stored value, with no migration. */
  read(): StorageRead;
  write(choice: StoredChoice): StorageWrite;
  remove(): StorageWrite;
  /** Another tab wrote; returns an unsubscribe function. */
  subscribe?(onExternalChange: () => void): () => void;
}

export type EvidenceResult = { kind: "saved" } | { kind: "conflict" } | { kind: "unavailable" };

/** Optional durable acknowledgement of a choice the browser already stored. */
export interface ConsentEvidencePort {
  save(choice: StoredChoice, context: { signal: AbortSignal; sequence: number }): Promise<EvidenceResult>;
}

export type EvidenceStatus = "none" | "pending" | "saved" | "conflict" | "unavailable";

export interface ConsentSnapshot {
  regime: ConsentRegime;
  effective: EffectiveChoice;
  allowed: boolean;
  promptAutomatically: boolean;
  persistence: "stored" | "memory" | "none";
  storage: "readable" | "unreadable";
  evidence: EvidenceStatus;
  withdrawal: "idle" | "failed";
  gpcInForce: boolean;
  simulated: boolean;
  sequence: number;
}

export interface ConsentLifecycle {
  /** Stable identity until a change. */
  getSnapshot(): ConsentSnapshot;
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshot;
  /** A withdrawal when the prior snapshot or a read-back at the call allows. */
  refuse(): ConsentSnapshot;
  /** A re-read that never replaces a choice made this visit with an older or non-live record. */
  refresh(): ConsentSnapshot;
  dispose(): void;
}

export interface ConsentLifecycleOptions {
  storage: ConsentStoragePort;
  /** `false` or absent: no evidence port. */
  evidence?: ConsentEvidencePort | false | undefined;
  policy: ConsentPolicy;
  regime: unknown;
  signals: ConsentSignals;
  clock: () => Date;
  /** Review seam only: the snapshot never allows and no evidence port is called. */
  simulated?: boolean | undefined;
}

/** The server and pre-mount snapshot. */
export const NO_DECISION_SNAPSHOT: ConsentSnapshot = Object.freeze({
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

type ReadBack = "allowed" | "not allowed" | "unreadable";

interface MemoryChoice {
  choice: StoredChoice;
  /** The instant the choice was decided, so it governs for the rest of the visit. */
  at: Date;
}

const SNAPSHOT_KEYS: readonly (keyof ConsentSnapshot)[] = [
  "regime",
  "effective",
  "allowed",
  "promptAutomatically",
  "persistence",
  "storage",
  "evidence",
  "withdrawal",
  "gpcInForce",
  "simulated",
  "sequence",
];

function sameSnapshot(a: ConsentSnapshot, b: ConsentSnapshot): boolean {
  return SNAPSHOT_KEYS.every((key) => a[key] === b[key]);
}

function reportAsync(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

export function createConsentLifecycle(options: ConsentLifecycleOptions): ConsentLifecycle {
  const { storage, policy, clock } = options;
  assertConsentPolicy(policy);
  const regime = normalizeRegime(options.regime);
  const signals: ConsentSignals = { gpc: options.signals.gpc === true };
  const simulated = options.simulated === true;
  const evidencePort = simulated || !options.evidence ? undefined : options.evidence;
  const signalInForce = gpcInForce(signals, policy);

  let seq = 0;
  let memory: MemoryChoice | null = null;
  let stored: StoredInput = null;
  let storageReadable = true;
  let evidence: EvidenceStatus = "none";
  let withdrawal: "idle" | "failed" = "idle";
  let evalNow = clock();
  let disposed = false;
  const inflight = new Set<AbortController>();
  const listeners = new Set<() => void>();

  function safeRead(): StoredInput {
    let result: StorageRead;
    try {
      result = storage.read();
    } catch {
      return "unreadable";
    }
    if (typeof result !== "object" || result === null) return "unreadable";
    if (result.kind === "empty") return null;
    if (result.kind !== "value") return "unreadable";
    try {
      return parseStoredChoice(result.value, policy);
    } catch {
      return null;
    }
  }

  function writeOk(choice: StoredChoice): boolean {
    try {
      return storage.write(choice).kind === "ok";
    } catch {
      return false;
    }
  }

  function removeOk(): boolean {
    try {
      return storage.remove().kind === "ok";
    } catch {
      return false;
    }
  }

  /** Reads storage and records what it holds; the in-memory choice is ignored and untouched. */
  function readStorage(): StoredInput {
    const read = safeRead();
    stored = read;
    storageReadable = read !== "unreadable";
    return read;
  }

  function classify(read: StoredInput, now: Date): ReadBack {
    if (read === "unreadable") return "unreadable";
    return isAllowed(read, signals, regime, policy, now) ? "allowed" : "not allowed";
  }

  function compute(now: Date): ConsentSnapshot {
    let effective: EffectiveChoice;
    let allowed: boolean;
    let promptAutomatically: boolean;
    let persistence: ConsentSnapshot["persistence"];
    if (memory !== null) {
      effective = effectiveChoice(memory.choice, signals, policy, memory.at);
      allowed = isAllowed(memory.choice, signals, regime, policy, memory.at);
      promptAutomatically = shouldPromptAutomatically(memory.choice, signals, regime, policy, memory.at);
      persistence = "memory";
    } else {
      effective = effectiveChoice(stored, signals, policy, now);
      allowed = isAllowed(stored, signals, regime, policy, now);
      promptAutomatically = shouldPromptAutomatically(stored, signals, regime, policy, now);
      persistence = liveChoice(stored, policy, now) === null ? "none" : "stored";
    }
    return Object.freeze({
      regime,
      effective,
      allowed: simulated ? false : allowed,
      promptAutomatically,
      persistence,
      storage: storageReadable ? "readable" : "unreadable",
      evidence,
      withdrawal,
      gpcInForce: signalInForce,
      simulated,
      sequence: seq,
    });
  }

  let snapshot = NO_DECISION_SNAPSHOT;

  function publish(): void {
    const next = compute(evalNow);
    if (sameSnapshot(next, snapshot)) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        reportAsync(error);
      }
    }
  }

  /** Marks evidence pending and returns the call to make once the snapshot is published. */
  function prepareEvidence(choice: StoredChoice): (() => void) | null {
    if (evidencePort === undefined) {
      evidence = "none";
      return null;
    }
    evidence = "pending";
    const sequence = seq;
    const port = evidencePort;
    return () => {
      const controller = new AbortController();
      inflight.add(controller);
      let pending: Promise<EvidenceResult>;
      try {
        pending = Promise.resolve(port.save(choice, { signal: controller.signal, sequence }));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (result) => settleEvidence(sequence, controller, result),
        () => settleEvidence(sequence, controller, { kind: "unavailable" }),
      );
    };
  }

  function settleEvidence(sequence: number, controller: AbortController, result: EvidenceResult): void {
    inflight.delete(controller);
    // Only the latest choice's acknowledgement may settle; an aborted call always belongs to an older one.
    if (disposed || sequence !== seq || evidence !== "pending") return;
    const kind = typeof result === "object" && result !== null ? result.kind : undefined;
    if (kind === "saved") {
      evidence = "saved";
    } else if (kind === "conflict") {
      rereadAfterConflict();
      evidence = "conflict";
    } else {
      evidence = "unavailable";
    }
    publish();
  }

  /** A conflict re-reads the local record, and never upgrades the choice to allowed or granted. */
  function rereadAfterConflict(): void {
    if (memory !== null) return;
    const now = clock();
    const read = safeRead();
    const upgrades =
      (effectiveChoice(read, signals, policy, now) === "granted" && snapshot.effective !== "granted") ||
      (isAllowed(read, signals, regime, policy, now) && !snapshot.allowed);
    if (upgrades) return;
    stored = read;
    storageReadable = read !== "unreadable";
    evalNow = now;
  }

  function abortInflight(): void {
    for (const controller of inflight) controller.abort();
    inflight.clear();
  }

  function grant(): ConsentSnapshot {
    if (disposed) return snapshot;
    if (signalInForce) return snapshot;
    const now = clock();
    const choice = decideChoice("granted", now, policy, signals);
    seq += 1;
    evalNow = now;
    withdrawal = "idle";
    let sendEvidence: (() => void) | null = null;
    if (writeOk(choice)) {
      memory = null;
      stored = choice;
      sendEvidence = prepareEvidence(choice);
    } else {
      memory = { choice, at: now };
      evidence = "none";
    }
    publish();
    sendEvidence?.();
    return snapshot;
  }

  function refuse(): ConsentSnapshot {
    if (disposed) return snapshot;
    const now = clock();
    const priorAllowed = snapshot.allowed;
    const atCall = classify(readStorage(), now);
    const choice = decideChoice("denied", now, policy, signals);
    evalNow = now;
    const isWithdrawal = priorAllowed || atCall === "allowed" || withdrawal === "failed";

    if (!isWithdrawal) {
      seq += 1;
      let sendEvidence: (() => void) | null = null;
      if (writeOk(choice)) {
        memory = null;
        stored = choice;
        sendEvidence = prepareEvidence(choice);
      } else {
        memory = { choice, at: now };
        evidence = "none";
      }
      publish();
      sendEvidence?.();
      return snapshot;
    }

    // A withdrawal: allowed: false reaches subscribers before anything else.
    memory = { choice, at: now };
    publish();
    seq += 1;
    abortInflight();
    const wrote = writeOk(choice);
    if (!wrote) removeOk();
    const after = readStorage();
    let sendEvidence: (() => void) | null = null;
    if (classify(after, now) === "not allowed") {
      withdrawal = "idle";
      const held = liveChoice(after, policy, now);
      if (wrote && held !== null && held.status === "denied") {
        memory = null;
        sendEvidence = prepareEvidence(choice);
      } else {
        evidence = "none";
      }
    } else {
      withdrawal = "failed";
      evidence = "none";
    }
    publish();
    sendEvidence?.();
    return snapshot;
  }

  function refresh(): ConsentSnapshot {
    if (disposed) return snapshot;
    const now = clock();
    evalNow = now;
    const read = readStorage();
    if (memory !== null) {
      const record = read === null || read === "unreadable" ? null : read;
      const decided = record === null ? Number.NaN : Date.parse(record.decidedAt);
      const replaces =
        record !== null &&
        isLiveChoice(record, policy, now) &&
        decided > Date.parse(memory.choice.decidedAt) &&
        decided <= now.getTime();
      if (replaces) {
        memory = null;
        withdrawal = "idle";
      } else if (withdrawal === "failed" && classify(read, now) === "not allowed") {
        withdrawal = "idle";
      }
    }
    publish();
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  let unsubscribeStorage: (() => void) | undefined;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    abortInflight();
    listeners.clear();
    const stop = unsubscribeStorage;
    unsubscribeStorage = undefined;
    stop?.();
  }

  // Mount: one read, nothing written.
  readStorage();
  snapshot = compute(evalNow);
  if (typeof storage.subscribe === "function") {
    unsubscribeStorage = storage.subscribe(() => {
      if (!disposed) refresh();
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe,
    grant,
    refuse,
    refresh,
    dispose,
  };
}
