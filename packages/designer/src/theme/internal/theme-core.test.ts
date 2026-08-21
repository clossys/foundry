import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STORAGE_KEY,
  applyThemeDom,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from "./theme-core.js";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("isThemePreference", () => {
  it("accepts exactly the three valid states", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
  });

  it("rejects anything else, including plausible near-misses", () => {
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});

describe("readStoredPreference", () => {
  it("returns the stored value when it's one of the three valid states", () => {
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "dark");
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("dark");
  });

  it("falls back to \"system\" when nothing is stored", () => {
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("system");
  });

  it("falls back to \"system\" for a malformed stored value, rather than trusting it as a fourth state", () => {
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "midnight");
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("system");
  });

  it("falls back to \"system\" and never throws when localStorage itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => readStoredPreference(DEFAULT_STORAGE_KEY)).not.toThrow();
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("system");
  });

  it("reads the configured key, not always the default", () => {
    window.localStorage.setItem("custom-key", "light");
    expect(readStoredPreference("custom-key")).toBe("light");
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("system");
  });
});

describe("writeStoredPreference", () => {
  it("persists a value readStoredPreference then reads back", () => {
    writeStoredPreference(DEFAULT_STORAGE_KEY, "dark");
    expect(readStoredPreference(DEFAULT_STORAGE_KEY)).toBe("dark");
  });

  it("never throws even when the underlying storage write fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeStoredPreference(DEFAULT_STORAGE_KEY, "dark")).not.toThrow();
  });
});

describe("applyThemeDom", () => {
  it("removes data-theme and sets color-scheme to \"light dark\" for \"system\"", () => {
    const root = document.createElement("html");
    root.setAttribute("data-theme", "dark");
    applyThemeDom(root, "system");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.colorScheme).toBe("light dark");
  });

  it("stamps data-theme=\"dark\" and color-scheme: dark for \"dark\"", () => {
    const root = document.createElement("html");
    applyThemeDom(root, "dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("stamps data-theme=\"light\" and color-scheme: light for \"light\"", () => {
    const root = document.createElement("html");
    applyThemeDom(root, "light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("returns the explicit preference unchanged for \"light\"/\"dark\"", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS signal for \"system\"", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
