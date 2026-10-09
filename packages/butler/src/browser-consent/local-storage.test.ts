// @vitest-environment jsdom
/**
 * P-26: blocked or throwing storage reads `unavailable` without throwing;
 * only a `storage` event for the configured key reaches the listener; raw
 * values come back unmigrated; nothing else is written. Covers C-16.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageConsentPort } from "./adapters/local-storage.js";
import { DAY, GPC_ON, POLICY, T0, decidedAt, legacyRecord, plusMs } from "./fixtures.test.js";

const KEY = "site-consent";

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

function storageEvent(key: string | null, storageArea: Storage | null = window.localStorage): StorageEvent {
  return new StorageEvent("storage", { key, storageArea, newValue: "x" });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("blocked or throwing storage reads unavailable without throwing (C-16)", () => {
  it("a throwing getItem, setItem or removeItem reports unavailable", () => {
    const port = createLocalStorageConsentPort({ key: KEY, storage: throwingStorage });
    expect(() => port.read()).not.toThrow();
    expect(port.read()).toEqual({ kind: "unavailable" });
    expect(port.write(decidedAt("granted", T0))).toEqual({ kind: "unavailable" });
    expect(port.remove()).toEqual({ kind: "unavailable" });
  });

  it("a storage accessor that throws, or returns nothing, reports unavailable", () => {
    for (const storage of [
      () => {
        throw new DOMException("denied", "SecurityError");
      },
      () => undefined,
    ]) {
      const port = createLocalStorageConsentPort({ key: KEY, storage });
      expect(port.read()).toEqual({ kind: "unavailable" });
      expect(port.write(decidedAt("denied", T0))).toEqual({ kind: "unavailable" });
      expect(port.remove()).toEqual({ kind: "unavailable" });
    }
  });

  it("a default global localStorage whose getter throws reports unavailable", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(() => port.read()).not.toThrow();
    expect(port.read()).toEqual({ kind: "unavailable" });
  });

  it("the default storage is resolved at each call, not at construction", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    window.localStorage.setItem(KEY, "first");
    expect(port.read()).toEqual({ kind: "value", value: "first" });
    vi.stubGlobal("localStorage", throwingStorage());
    expect(() => port.read()).not.toThrow();
    expect(port.read()).toEqual({ kind: "unavailable" });
  });
});

describe("raw values, unmigrated, and nothing else written (C-16, C-10)", () => {
  it("an empty key reads empty", () => {
    expect(createLocalStorageConsentPort({ key: KEY }).read()).toEqual({ kind: "empty" });
  });

  it("returns the stored text exactly, legacy and corrupt values included", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    for (const raw of [JSON.stringify(legacyRecord("granted", T0)), "not json", JSON.stringify(decidedAt("denied", T0))]) {
      window.localStorage.setItem(KEY, raw);
      expect(port.read()).toEqual({ kind: "value", value: raw });
      expect(window.localStorage.getItem(KEY)).toBe(raw);
    }
  });

  it("a write stores only the current record shape under the configured key", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    window.localStorage.setItem("other", "kept");
    const extra = { ...decidedAt("granted", T0), visitor: "abc", gpcOverride: undefined } as unknown as Parameters<
      typeof port.write
    >[0];
    expect(port.write(extra)).toEqual({ kind: "ok" });
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual(decidedAt("granted", T0));
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem("other")).toBe("kept");
  });

  it("keeps gpcOverride on a grant that carries it", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    const grant = decidedAt("granted", T0, { ...POLICY, gpcOverridable: true }, GPC_ON);
    port.write(grant);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual(grant);
  });

  it("remove deletes only the configured key", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    window.localStorage.setItem(KEY, JSON.stringify(decidedAt("granted", plusMs(T0, -DAY))));
    window.localStorage.setItem("other", "kept");
    expect(port.remove()).toEqual({ kind: "ok" });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem("other")).toBe("kept");
  });

  it("reading writes nothing", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    const raw = JSON.stringify(legacyRecord("granted", T0));
    window.localStorage.setItem(KEY, raw);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    port.read();
    port.read();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});

describe("only a storage event for the configured key reaches the listener (C-16)", () => {
  it("filters by key and by storage area, and stops after unsubscribe", () => {
    const port = createLocalStorageConsentPort({ key: KEY });
    const listener = vi.fn();
    const unsubscribe = port.subscribe?.(listener);
    expect(unsubscribe).toBeTypeOf("function");

    window.dispatchEvent(storageEvent("another-key"));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(storageEvent(null));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(storageEvent(KEY, window.sessionStorage));
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(storageEvent(KEY));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe?.();
    window.dispatchEvent(storageEvent(KEY));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribing adds no listener until called and reads nothing", () => {
    const add = vi.spyOn(window, "addEventListener");
    const port = createLocalStorageConsentPort({ key: KEY });
    expect(add).not.toHaveBeenCalled();
    const unsubscribe = port.subscribe?.(() => {});
    expect(add).toHaveBeenCalledWith("storage", expect.any(Function));
    unsubscribe?.();
    add.mockRestore();
  });
});
