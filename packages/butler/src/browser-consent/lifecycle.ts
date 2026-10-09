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
 * that is not live or not newer, and a refusal made this visit is a floor:
 * only a live, newer grant lifts it.
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
  gpcOn,
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

function decidedMs(choice: StoredChoice): number {
  return Date.parse(choice.decidedAt);
}

function sameRecord(a: StoredChoice, b: StoredChoice): boolean {
  return a.status === b.status && a.decidedAt === b.decidedAt && a.policyVersion === b.policyVersion;
}

function asRecord(read: StoredInput): StoredChoice | null {
  return read === null || read === "unreadable" ? null : read;
}

function validInstant(value: unknown): Date | null {
  if (typeof value !== "object" || value === null || typeof (value as Date).getTime !== "function") return null;
  const time = (value as Date).getTime();
  return Number.isFinite(time) ? new Date(time) : null;
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
  const signals: ConsentSignals = { gpc: gpcOn(options.signals) };
  const simulated = options.simulated === true;
  const evidencePort = simulated || !options.evidence ? undefined : options.evidence;
  const signalInForce = gpcInForce(signals, policy);

  let seq = 0;
  /** Moves on with every choice and every record switch; a late evidence result for an older token is ignored. */
  let token = 0;
  let memory: MemoryChoice | null = null;
  /** A refusal made while the clock gave no valid instant: no date and no record; only the visitor's next choice replaces it. */
  let undatedDenial = false;
  /** The latest refusal made this visit: a floor that only a live, newer grant lifts on a re-read. */
  let floor: MemoryChoice | null = null;
  /** No record decided at or before this instant replaces a refusal: a failed withdrawal's read-back still saw it. */
  let watermark = Number.NEGATIVE_INFINITY;
  let stored: StoredInput = null;
  let storageReadable = true;
  let evidence: EvidenceStatus = "none";
  /** The record the current evidence status describes. */
  let evidenceFor: StoredChoice | null = null;
  let withdrawal: "idle" | "failed" = "idle";
  let lastValidNow = new Date(0);
  let disposed = false;
  const inflight = new Set<AbortController>();
  const listeners = new Set<() => void>();

  /** The clock's reading, or `null` when it throws or is not a valid instant. */
  function readClock(): Date | null {
    let value: unknown;
    try {
      value = clock();
    } catch {
      return null;
    }
    const now = validInstant(value);
    if (now !== null) lastValidNow = now;
    return now;
  }

  /** The instant a re-read evaluates against: the clock, or its last valid reading. */
  function evaluationInstant(): Date {
    return readClock() ?? lastValidNow;
  }

  let evalNow = evaluationInstant();

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

  /** Whether a record allows as of its own `decidedAt`: what a grant dated after now allows once the clock reaches it. */
  function allowsWhenLive(record: StoredChoice): boolean {
    return isAllowed(record, signals, regime, policy, new Date(record.decidedAt));
  }

  /**
   * A read-back (C-57). A grant that is not live only because it is dated
   * after `now` counts as allowed when it would allow once the clock reaches
   * it. With no valid instant liveness cannot be judged (C-61): any grant,
   * or no record under `notice`, is allowed.
   */
  function classify(read: StoredInput, now: Date | null): ReadBack {
    if (read === "unreadable") return "unreadable";
    if (now === null) return (read === null ? regime === "notice" : read.status === "granted") ? "allowed" : "not allowed";
    if (read !== null && read.status === "granted" && decidedMs(read) > now.getTime() && allowsWhenLive(read)) return "allowed";
    return isAllowed(read, signals, regime, policy, now) ? "allowed" : "not allowed";
  }

  function compute(now: Date): ConsentSnapshot {
    let effective: EffectiveChoice;
    let allowed: boolean;
    let promptAutomatically: boolean;
    let persistence: ConsentSnapshot["persistence"];
    if (undatedDenial) {
      effective = "denied";
      allowed = false;
      promptAutomatically = false;
      // Stored only while storage holds a denial; no liveness check, which would need a clock.
      persistence = asRecord(stored)?.status === "denied" ? "stored" : "memory";
    } else if (memory !== null) {
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

  /** The record that governs the snapshot now, if any. */
  function governingRecord(now: Date): StoredChoice | null {
    if (undatedDenial) return null;
    return memory !== null ? memory.choice : liveChoice(stored, policy, now);
  }

  /** Once another record governs, the evidence status no longer describes it. */
  function dropEvidenceIfSwitched(now: Date): boolean {
    if (evidence === "none") return false;
    const governing = governingRecord(now);
    if (governing !== null && evidenceFor !== null && sameRecord(governing, evidenceFor)) return false;
    evidence = "none";
    evidenceFor = null;
    token += 1;
    return true;
  }

  /**
   * Returns the evidence call to make once the choice is published. The
   * choice is published with evidence `none`; it shows `pending` only once
   * its call is actually sent.
   */
  function prepareEvidence(choice: StoredChoice): (() => void) | null {
    evidence = "none";
    evidenceFor = null;
    if (evidencePort === undefined) return null;
    const sequence = seq;
    const owner = token;
    const port = evidencePort;
    return () => {
      // Sent only while this choice is still the latest: a choice made meanwhile (a subscriber may call refuse() inside publish()) supersedes it unsent.
      if (disposed || owner !== token) return;
      evidence = "pending";
      evidenceFor = choice;
      const controller = new AbortController();
      inflight.add(controller);
      let pending: Promise<EvidenceResult>;
      try {
        pending = Promise.resolve(port.save(choice, { signal: controller.signal, sequence }));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (result) => settleEvidence(owner, controller, result),
        () => settleEvidence(owner, controller, { kind: "unavailable" }),
      );
      publish();
    };
  }

  function settleEvidence(owner: number, controller: AbortController, result: EvidenceResult): void {
    inflight.delete(controller);
    // Only the current choice's acknowledgement may settle; an aborted call always belongs to an older one.
    if (disposed || owner !== token || evidence !== "pending") return;
    const kind = typeof result === "object" && result !== null ? result.kind : undefined;
    if (kind === "saved") {
      evidence = "saved";
    } else if (kind === "conflict") {
      // A re-read that switches to another record wins over the conflict.
      if (!rereadAfterConflict()) evidence = "conflict";
    } else {
      evidence = "unavailable";
    }
    publish();
  }

  /**
   * A conflict re-reads the local record, and never upgrades the choice to
   * allowed or granted. Returns whether the re-read switched to another record.
   */
  function rereadAfterConflict(): boolean {
    if (memory !== null || undatedDenial) return false;
    const clockNow = readClock();
    const now = clockNow ?? lastValidNow;
    const saved = { stored, storageReadable, memory, withdrawal, evalNow };
    reconcile(readStorage(), now, clockNow);
    evalNow = now;
    const next = compute(now);
    const upgrades =
      (next.effective === "granted" && snapshot.effective !== "granted") || (next.allowed && !snapshot.allowed);
    if (upgrades) {
      ({ stored, storageReadable, memory, withdrawal, evalNow } = saved);
      return false;
    }
    return dropEvidenceIfSwitched(now);
  }

  /**
   * A live record decided after `held` and not after `now`. Over a refusal it
   * must also be decided after the watermark, whatever the clock says later.
   */
  function newerLive(record: StoredChoice | null, held: StoredChoice, now: Date): record is StoredChoice {
    if (record === null || !isLiveChoice(record, policy, now)) return false;
    const decided = decidedMs(record);
    if (!(decided > decidedMs(held) && decided <= now.getTime())) return false;
    return held.status === "granted" || decided > watermark;
  }

  /** A failed withdrawal's read-back raises the watermark to the record it still saw; it only moves forward. */
  function raiseWatermark(read: StoredInput): void {
    const record = asRecord(read);
    if (record === null) return;
    const decided = decidedMs(record);
    if (decided > watermark) watermark = decided;
  }

  /**
   * Applies a re-read (C-54) to the choice made this visit. `now` is the
   * instant liveness is judged at; `clockNow` is the clock's own reading, or
   * `null` when it gave no valid instant, for re-checking a failed withdrawal.
   */
  function reconcile(read: StoredInput, now: Date, clockNow: Date | null): void {
    if (undatedDenial) {
      // No re-read lifts an undated refusal (C-61); its failed withdrawal ends once a read-back is not allowed.
      if (withdrawal === "failed" && classify(read, clockNow) === "not allowed") withdrawal = "idle";
      return;
    }
    const record = asRecord(read);
    if (memory !== null) {
      const ours = record !== null && sameRecord(record, memory.choice) && isLiveChoice(record, policy, now);
      if (ours || newerLive(record, memory.choice, now)) {
        memory = null;
        withdrawal = "idle";
      } else if (withdrawal === "failed" && classify(read, clockNow) === "not allowed") {
        withdrawal = "idle";
      }
    }
    if (memory !== null || floor === null) return;
    // The refusal floor: storage must still refuse, or hold a live grant made after the refusal.
    const live = record !== null && isLiveChoice(record, policy, now) ? record : null;
    const holds = live !== null && (live.status === "denied" || newerLive(live, floor.choice, now));
    if (!holds) memory = floor;
  }

  function abortInflight(): void {
    for (const controller of inflight) controller.abort();
    inflight.clear();
  }

  function grant(): ConsentSnapshot {
    if (disposed) return snapshot;
    if (signalInForce) return snapshot;
    // A grant needs a valid instant; with none it is not recorded.
    const now = readClock();
    if (now === null) return snapshot;
    const choice = decideChoice("granted", now, policy, signals);
    seq += 1;
    token += 1;
    evalNow = now;
    withdrawal = "idle";
    undatedDenial = false;
    floor = null;
    // The visitor's own grant ends what a failed withdrawal remembered (C-57).
    watermark = Number.NEGATIVE_INFINITY;
    let sendEvidence: (() => void) | null = null;
    if (writeOk(choice)) {
      memory = null;
      stored = choice;
      sendEvidence = prepareEvidence(choice);
    } else {
      memory = { choice, at: now };
      evidence = "none";
      evidenceFor = null;
    }
    publish();
    sendEvidence?.();
    return snapshot;
  }

  /**
   * A refusal while the clock gives no valid instant. It cannot be dated, so
   * nothing is written; it is held in memory, and as a withdrawal it removes
   * the record and reads back.
   */
  function refuseUndated(priorAllowed: boolean): ConsentSnapshot {
    const atCall = classify(readStorage(), null);
    const isWithdrawal = priorAllowed || atCall === "allowed" || withdrawal === "failed";
    seq += 1;
    token += 1;
    undatedDenial = true;
    memory = null;
    floor = null;
    evidence = "none";
    evidenceFor = null;
    publish();
    if (isWithdrawal) {
      abortInflight();
      removeOk();
      if (classify(readStorage(), null) !== "not allowed") withdrawal = "failed";
    }
    publish();
    return snapshot;
  }

  function refuse(): ConsentSnapshot {
    if (disposed) return snapshot;
    const priorAllowed = snapshot.allowed;
    if (priorAllowed) {
      // allowed: false reaches subscribers before the clock is read, held undated until the refusal is dated (C-61).
      token += 1;
      undatedDenial = true;
      publish();
    }
    const now = readClock();
    if (now === null) return refuseUndated(priorAllowed);
    const atCallRead = readStorage();
    const atCall = classify(atCallRead, now);
    const choice = decideChoice("denied", now, policy, signals);
    evalNow = now;
    undatedDenial = false;
    floor = { choice, at: now };
    const isWithdrawal = priorAllowed || atCall === "allowed" || withdrawal === "failed";

    if (!isWithdrawal) {
      seq += 1;
      token += 1;
      let sendEvidence: (() => void) | null = null;
      if (writeOk(choice)) {
        memory = null;
        stored = choice;
        sendEvidence = prepareEvidence(choice);
      } else {
        memory = { choice, at: now };
        evidence = "none";
        evidenceFor = null;
      }
      publish();
      sendEvidence?.();
      return snapshot;
    }

    // A withdrawal: the dated denial is held in memory until the read-back confirms it.
    token += 1;
    memory = { choice, at: now };
    publish();
    // A choice a subscriber made during that publish never shares this denial's evidence token.
    token += 1;
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
        evidenceFor = null;
      }
    } else {
      withdrawal = "failed";
      evidence = "none";
      evidenceFor = null;
      // Both reads count: the record seen at the call may be the one the read-back could not see (fail-closed).
      raiseWatermark(atCallRead);
      raiseWatermark(after);
    }
    publish();
    sendEvidence?.();
    return snapshot;
  }

  function refresh(): ConsentSnapshot {
    if (disposed) return snapshot;
    const clockNow = readClock();
    const now = clockNow ?? lastValidNow;
    evalNow = now;
    reconcile(readStorage(), now, clockNow);
    dropEvidenceIfSwitched(now);
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
