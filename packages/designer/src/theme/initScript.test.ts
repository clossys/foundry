import { describe, expect, it } from "vitest";
import { getAuthoredThemeInitScript, getStoredThemeInitScript, getThemeInitScript } from "./initScript.js";
import { DEFAULT_STORAGE_KEY } from "./internal/theme-core.js";

describe("getAuthoredThemeInitScript", () => {
  it("stamps data-theme light without storage", () => {
    const script = getAuthoredThemeInitScript();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(script)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("getStoredThemeInitScript / getThemeInitScript", () => {
  it("embeds the default storage key when none is given", () => {
    expect(getStoredThemeInitScript()).toContain(JSON.stringify(DEFAULT_STORAGE_KEY));
  });

  it("embeds a consumer-supplied storage key instead", () => {
    expect(getStoredThemeInitScript({ storageKey: "acme-theme" })).toContain(JSON.stringify("acme-theme"));
    expect(getStoredThemeInitScript({ storageKey: "acme-theme" })).not.toContain(JSON.stringify(DEFAULT_STORAGE_KEY));
  });

  it("returns a self-invoking, self-contained expression", () => {
    const script = getStoredThemeInitScript();
    expect(script.trimStart()).toMatch(/^\(function\s*\(\)\s*\{/);
    expect(script.trimEnd()).toMatch(/\}\)\(\);$/);
  });
});
