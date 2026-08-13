import { afterEach, describe, expect, it, vi } from "vitest";
import { getThemeInitScript } from "./initScript.js";
import { DEFAULT_STORAGE_KEY, applyThemeDom, readStoredPreference } from "./internal/theme-core.js";

/**
 * `getThemeInitScript()`'s whole reason to exist is running the SAME
 * theming rule the provider uses, before React has mounted (see
 * `initScript.ts`'s own doc comment). This file is what actually enforces
 * that the two never drift apart: for every input below, it (a) evaluates
 * the STRINGIFIED script exactly the way a browser executing an injected
 * `<head>` script would, and (b) calls `readStoredPreference`/
 * `applyThemeDom` directly, the way `ThemeProvider` does — then asserts
 * both leave `<html>` in the identical state.
 */

function resetDocument() {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
}

afterEach(() => {
  resetDocument();
  vi.restoreAllMocks();
});

function runInitScript(storageKey: string): void {
  // `new Function` rather than `eval` — same "run this source with no
  // enclosing closure" property the browser's own head-script execution
  // has, without an ESLint/bundler warning about direct eval.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(getThemeInitScript({ storageKey }))();
}

function runProviderLogic(storageKey: string): void {
  applyThemeDom(document.documentElement, readStoredPreference(storageKey));
}

const CASES: Array<{ name: string; storageKey: string; setup?: () => void }> = [
  { name: "nothing stored", storageKey: DEFAULT_STORAGE_KEY },
  { name: '"light" stored', storageKey: DEFAULT_STORAGE_KEY, setup: () => window.localStorage.setItem(DEFAULT_STORAGE_KEY, "light") },
  { name: '"dark" stored', storageKey: DEFAULT_STORAGE_KEY, setup: () => window.localStorage.setItem(DEFAULT_STORAGE_KEY, "dark") },
  { name: '"system" stored', storageKey: DEFAULT_STORAGE_KEY, setup: () => window.localStorage.setItem(DEFAULT_STORAGE_KEY, "system") },
  { name: "malformed stored value", storageKey: DEFAULT_STORAGE_KEY, setup: () => window.localStorage.setItem(DEFAULT_STORAGE_KEY, "midnight") },
  { name: "a non-default storage key", storageKey: "consumer-theme", setup: () => window.localStorage.setItem("consumer-theme", "dark") },
];

describe("theme init script and ThemeProvider's own logic agree", () => {
  for (const { name, storageKey, setup } of CASES) {
    it(`resolve identically for: ${name}`, () => {
      setup?.();
      runInitScript(storageKey);
      const scripted = {
        attribute: document.documentElement.getAttribute("data-theme"),
        colorScheme: document.documentElement.style.colorScheme,
      };

      resetDocument();
      setup?.();
      runProviderLogic(storageKey);
      const direct = {
        attribute: document.documentElement.getAttribute("data-theme"),
        colorScheme: document.documentElement.style.colorScheme,
      };

      expect(scripted).toEqual(direct);
    });
  }

  it("both fall back to \"system\" and never throw when storage itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => runInitScript(DEFAULT_STORAGE_KEY)).not.toThrow();
    const scripted = {
      attribute: document.documentElement.getAttribute("data-theme"),
      colorScheme: document.documentElement.style.colorScheme,
    };
    expect(scripted).toEqual({ attribute: null, colorScheme: "light dark" });

    resetDocument();
    expect(() => runProviderLogic(DEFAULT_STORAGE_KEY)).not.toThrow();
    const direct = {
      attribute: document.documentElement.getAttribute("data-theme"),
      colorScheme: document.documentElement.style.colorScheme,
    };
    expect(direct).toEqual(scripted);
  });

  it("both read the SAME configured storage key, not always the default", () => {
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, "dark");
    window.localStorage.setItem("consumer-key", "light");

    runInitScript("consumer-key");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("the generated script contains no reference to a module system or import", () => {
    const script = getThemeInitScript();
    expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  });
});
