import { describe, expect, it } from "vitest";
import { getThemeInitScript } from "./initScript.js";
import { DEFAULT_STORAGE_KEY } from "./internal/theme-core.js";

describe("getThemeInitScript", () => {
  it("embeds the default storage key when none is given", () => {
    expect(getThemeInitScript()).toContain(JSON.stringify(DEFAULT_STORAGE_KEY));
  });

  it("embeds a consumer-supplied storage key instead", () => {
    expect(getThemeInitScript({ storageKey: "acme-theme" })).toContain(JSON.stringify("acme-theme"));
    expect(getThemeInitScript({ storageKey: "acme-theme" })).not.toContain(JSON.stringify(DEFAULT_STORAGE_KEY));
  });

  it("returns a self-invoking, self-contained expression", () => {
    const script = getThemeInitScript();
    expect(script.trimStart()).toMatch(/^\(function\s*\(\)\s*\{/);
    expect(script.trimEnd()).toMatch(/\}\)\(\);$/);
  });
});
