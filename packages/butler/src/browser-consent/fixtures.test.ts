/**
 * Shared fixtures for the browser consent tests: a fixed clock, an
 * in-memory storage port with switchable failure modes, a deferred
 * evidence port that records each `sequence`, a legacy record and a
 * future-dated record.
 *
 * This file carries the `.test.ts` suffix so that it never builds into the
 * package output or ships in it. Other test files import it, so its own
 * self-checks register only when the runner collects this file itself.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createConsentLifecycle,
  type ConsentEvidencePort,
  type ConsentLifecycle,
  type ConsentSnapshot,
  type ConsentStoragePort,
  type EvidenceResult,
  type StorageRead,
  type StorageWrite,
} from "./lifecycle.js";
import { decideChoice, type ConsentPolicy, type ConsentSignals, type StoredChoice } from "./record.js";

export const T0 = "2026-03-10T12:00:00.000Z";

export const POLICY: ConsentPolicy = Object.freeze({
  version: "policy-2",
  expiryMonths: 6,
  invalidateDenialOnPolicyBump: true,
});

export const GPC_OFF: ConsentSignals = Object.freeze({ gpc: false });
export const GPC_ON: ConsentSignals = Object.freeze({ gpc: true });

export function at(iso: string): Date {
  return new Date(iso);
}

export function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** A clock that moves only when a test moves it, forwards or back. */
export interface FixedClock {
  readonly clock: () => Date;
  set(iso: string): void;
  advance(ms: number): void;
  now(): string;
}

export function fixedClock(iso: string = T0): FixedClock {
  let current = Date.parse(iso);
  return {
    clock: () => new Date(current),
    set(next) {
      current = Date.parse(next);
    },
    advance(ms) {
      current += ms;
    },
    now: () => new Date(current).toISOString(),
  };
}

/** A record decided at `iso` through the real rule, so its expiry is the policy's. */
export function decidedAt(
  status: "granted" | "denied",
  iso: string,
  policy: ConsentPolicy = POLICY,
  signals: ConsentSignals = GPC_OFF,
): StoredChoice {
  return decideChoice(status, at(iso), policy, signals);
}

/** The older `{ status, decidedAt }` shape. */
export function legacyRecord(status: "granted" | "denied", iso: string): { status: string; decidedAt: string } {
  return { status, decidedAt: iso };
}

/** A record dated `ms` after `iso`, as another tab with a clock ahead (or this tab before a rollback) would write it. */
export function futureDated(
  status: "granted" | "denied",
  iso: string,
  ms: number,
  policy: ConsentPolicy = POLICY,
): StoredChoice {
  return decidedAt(status, plusMs(iso, ms), policy);
}

export interface StorageModes {
  /** `read()` reports `unavailable`. */
  readUnavailable: boolean;
  /** `read()` throws. */
  readThrows: boolean;
  /** `write()` reports `unavailable` and keeps nothing. */
  writeFails: boolean;
  /** `write()` reports `ok` and keeps nothing. */
  writeLost: boolean;
  /** `remove()` reports `unavailable` and keeps the value. */
  removeFails: boolean;
  /** When set, `read()` returns this value whatever was written or removed. */
  staleRead: unknown;
}

export interface MemoryStorage {
  readonly port: ConsentStoragePort;
  readonly modes: StorageModes;
  /** The raw value held, or `undefined` for empty. */
  value: unknown;
  readonly reads: StorageRead[];
  readonly writes: StoredChoice[];
  readonly removes: StorageWrite[];
  /** One-shot results the next `read()` calls return, in order, before any mode applies. */
  readonly scriptedReads: StorageRead[];
  /** Writes a value as another tab would, without notifying. */
  setExternally(value: unknown): void;
  /** Delivers a cross-tab change notification to every subscriber. */
  emitExternalChange(): void;
  readonly subscriberCount: () => number;
}

export function memoryStorage(initial?: unknown): MemoryStorage {
  const listeners = new Set<() => void>();
  const modes: StorageModes = {
    readUnavailable: false,
    readThrows: false,
    writeFails: false,
    writeLost: false,
    removeFails: false,
    staleRead: undefined,
  };
  const fixture: MemoryStorage = {
    modes,
    value: initial === undefined ? undefined : structuredClone(initial),
    reads: [],
    writes: [],
    removes: [],
    scriptedReads: [],
    setExternally(value) {
      fixture.value = value === undefined ? undefined : structuredClone(value);
    },
    emitExternalChange() {
      for (const listener of [...listeners]) listener();
    },
    subscriberCount: () => listeners.size,
    port: {
      read(): StorageRead {
        const scripted = fixture.scriptedReads.shift();
        if (scripted !== undefined) {
          fixture.reads.push(scripted);
          return structuredClone(scripted);
        }
        if (modes.readThrows) throw new Error("storage read blocked");
        let result: StorageRead;
        if (modes.readUnavailable) {
          result = { kind: "unavailable" };
        } else {
          const held = modes.staleRead !== undefined ? modes.staleRead : fixture.value;
          result = held === undefined ? { kind: "empty" } : { kind: "value", value: structuredClone(held) };
        }
        fixture.reads.push(result);
        return result;
      },
      write(choice: StoredChoice): StorageWrite {
        fixture.writes.push(structuredClone(choice));
        if (modes.writeFails) return { kind: "unavailable" };
        if (modes.writeLost) return { kind: "ok" };
        fixture.value = structuredClone(choice);
        return { kind: "ok" };
      },
      remove(): StorageWrite {
        const result: StorageWrite = modes.removeFails ? { kind: "unavailable" } : { kind: "ok" };
        fixture.removes.push(result);
        if (!modes.removeFails) fixture.value = undefined;
        return result;
      },
      subscribe(onExternalChange: () => void): () => void {
        listeners.add(onExternalChange);
        return () => {
          listeners.delete(onExternalChange);
        };
      },
    },
  };
  return fixture;
}

export interface EvidenceCall {
  readonly choice: StoredChoice;
  readonly sequence: number;
  readonly signal: AbortSignal;
  resolve(result: EvidenceResult): void;
  reject(error: unknown): void;
}

export interface DeferredEvidence {
  readonly port: ConsentEvidencePort;
  readonly calls: EvidenceCall[];
  readonly sequences: () => number[];
}

/** An evidence port whose calls resolve only when a test settles them. */
export function deferredEvidence(): DeferredEvidence {
  const calls: EvidenceCall[] = [];
  return {
    calls,
    sequences: () => calls.map((call) => call.sequence),
    port: {
      save(choice, context) {
        return new Promise<EvidenceResult>((resolve, reject) => {
          calls.push({ choice: structuredClone(choice), sequence: context.sequence, signal: context.signal, resolve, reject });
        });
      },
    },
  };
}

export interface HarnessOptions {
  initial?: unknown;
  regime?: unknown;
  signals?: ConsentSignals;
  policy?: ConsentPolicy;
  /** `false`: no evidence port at all. Default: the deferred port. */
  evidence?: boolean;
  simulated?: boolean;
  now?: string;
  beforeMount?: (storage: MemoryStorage) => void;
}

export interface Harness {
  readonly time: FixedClock;
  readonly storage: MemoryStorage;
  readonly evidence: DeferredEvidence;
  readonly lifecycle: ConsentLifecycle;
  snap(): ConsentSnapshot;
}

/** A lifecycle over the in-memory storage, the deferred evidence port and a fixed clock. */
export function harness(options: HarnessOptions = {}): Harness {
  const time = fixedClock(options.now ?? T0);
  const storage = memoryStorage(options.initial);
  options.beforeMount?.(storage);
  const evidence = deferredEvidence();
  const lifecycle = createConsentLifecycle({
    storage: storage.port,
    evidence: options.evidence === false ? false : evidence.port,
    policy: options.policy ?? POLICY,
    regime: options.regime,
    signals: options.signals ?? GPC_OFF,
    clock: time.clock,
    simulated: options.simulated,
  });
  return { time, storage, evidence, lifecycle, snap: () => lifecycle.getSnapshot() };
}

/** Lets settled promises deliver their results. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const collectingThisFile = expect.getState().testPath === fileURLToPath(import.meta.url);

if (collectingThisFile) {
  describe("browser consent test fixtures", () => {
    it("the fixed clock moves only when told, in either direction", () => {
      const time = fixedClock(T0);
      expect(time.clock().toISOString()).toBe(T0);
      time.advance(-DAY);
      expect(time.now()).toBe(plusMs(T0, -DAY));
    });

    it("the in-memory storage switches each failure mode independently", () => {
      const storage = memoryStorage();
      const choice = decidedAt("granted", T0);
      expect(storage.port.write(choice)).toEqual({ kind: "ok" });
      storage.modes.writeFails = true;
      expect(storage.port.write(decidedAt("denied", T0))).toEqual({ kind: "unavailable" });
      expect(storage.port.read()).toEqual({ kind: "value", value: choice });
      storage.modes.removeFails = true;
      expect(storage.port.remove()).toEqual({ kind: "unavailable" });
      storage.modes.removeFails = false;
      storage.modes.staleRead = choice;
      expect(storage.port.remove()).toEqual({ kind: "ok" });
      expect(storage.port.read()).toEqual({ kind: "value", value: choice });
      storage.modes.readUnavailable = true;
      expect(storage.port.read()).toEqual({ kind: "unavailable" });
      storage.modes.readThrows = true;
      expect(() => storage.port.read()).toThrow();
    });

    it("scripted reads come first, once each, and a lost write reports ok but keeps nothing", () => {
      const storage = memoryStorage();
      storage.scriptedReads.push({ kind: "unavailable" });
      expect(storage.port.read()).toEqual({ kind: "unavailable" });
      expect(storage.port.read()).toEqual({ kind: "empty" });
      storage.modes.writeLost = true;
      expect(storage.port.write(decidedAt("denied", T0))).toEqual({ kind: "ok" });
      expect(storage.port.read()).toEqual({ kind: "empty" });
    });

    it("the deferred evidence port records each sequence and resolves on demand", async () => {
      const evidence = deferredEvidence();
      const pending = evidence.port.save(decidedAt("granted", T0), { signal: new AbortController().signal, sequence: 7 });
      expect(evidence.sequences()).toEqual([7]);
      evidence.calls[0]?.resolve({ kind: "saved" });
      await expect(pending).resolves.toEqual({ kind: "saved" });
    });

    it("legacy and future-dated records have the shapes the tests rely on", () => {
      expect(Object.keys(legacyRecord("granted", T0)).sort()).toEqual(["decidedAt", "status"]);
      expect(Date.parse(futureDated("granted", T0, DAY).decidedAt)).toBeGreaterThan(Date.parse(T0));
    });
  });
}
