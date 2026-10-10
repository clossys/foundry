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
      const storage = resolve();
      if (event.key === null) {
        // A whole-area clear() names no key: a re-read trigger only when it cleared this port's storage area.
        if (storage !== undefined && event.storageArea === storage) onExternalChange();
        return;
      }
      // Otherwise only an event for the configured key, in this port's storage area when the event names one.
      if (event.key !== key) return;
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
