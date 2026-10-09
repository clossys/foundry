/**
 * Browser storage adapter for the consent lifecycle. Isolated: no core
 * module imports it, and nothing constructs it except a host's explicit
 * call. It touches browser globals only inside the functions it returns.
 *
 * It returns the raw stored value and performs no migration; parsing and
 * legacy handling belong to `parseStoredChoice`. It writes nothing except
 * the current record shape under the configured key. A blocked storage, or
 * an access that throws, reads as `unavailable` and never throws.
 */

import type { ConsentStoragePort, StorageRead, StorageWrite } from "../lifecycle.js";
import type { StoredChoice } from "../record.js";

export interface LocalStorageConsentPortOptions {
  key: string;
  /** Default: reads `globalThis.localStorage` lazily, at each call. */
  storage?: () => Storage | undefined;
}

const UNAVAILABLE = { kind: "unavailable" } as const;

function currentShape(choice: StoredChoice): StoredChoice {
  const record: StoredChoice = {
    status: choice.status,
    decidedAt: choice.decidedAt,
    expiresAt: choice.expiresAt,
    policyVersion: choice.policyVersion,
  };
  if (choice.status === "granted" && choice.gpcOverride === true) {
    record.gpcOverride = true;
  }
  return record;
}

interface StorageEventLike {
  key: string | null;
  storageArea: Storage | null;
}

interface EventTargetLike {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
}

export function createLocalStorageConsentPort(options: LocalStorageConsentPortOptions): ConsentStoragePort {
  const { key } = options;

  function resolve(): Storage | undefined {
    try {
      const storage = options.storage ? options.storage() : globalThis.localStorage;
      return storage ?? undefined;
    } catch {
      return undefined;
    }
  }

  function read(): StorageRead {
    const storage = resolve();
    if (storage === undefined) return UNAVAILABLE;
    try {
      const value = storage.getItem(key);
      return value === null ? { kind: "empty" } : { kind: "value", value };
    } catch {
      return UNAVAILABLE;
    }
  }

  function write(choice: StoredChoice): StorageWrite {
    const storage = resolve();
    if (storage === undefined) return UNAVAILABLE;
    try {
      storage.setItem(key, JSON.stringify(currentShape(choice)));
      return { kind: "ok" };
    } catch {
      return UNAVAILABLE;
    }
  }

  function remove(): StorageWrite {
    const storage = resolve();
    if (storage === undefined) return UNAVAILABLE;
    try {
      storage.removeItem(key);
      return { kind: "ok" };
    } catch {
      return UNAVAILABLE;
    }
  }

  function subscribe(onExternalChange: () => void): () => void {
    const target = globalThis as unknown as Partial<EventTargetLike>;
    if (typeof target.addEventListener !== "function" || typeof target.removeEventListener !== "function") {
      return () => {};
    }
    const listener = (event: StorageEventLike): void => {
      // Only an event for the configured key; a whole-area clear() (`key: null`) is picked up by the next re-read.
      if (event.key !== key) return;
      const storage = resolve();
      if (event.storageArea !== null && storage !== undefined && event.storageArea !== storage) return;
      onExternalChange();
    };
    target.addEventListener("storage", listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      target.removeEventListener?.("storage", listener);
    };
  }

  return { read, write, remove, subscribe };
}
