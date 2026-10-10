// @vitest-environment node
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { getAuthoredThemeInitScript, getStoredThemeInitScript, getThemeInitScript } from "./initScript.js";

function execute(script: string, stored: string | null, blocked = false) {
  const attributes = new Map<string, string>([["data-theme", "stale"]]);
  const root = {
    style: { colorScheme: "" },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  runInNewContext(script, {
    window: { localStorage: { getItem: () => {
      if (blocked) throw new Error("storage disabled");
      return stored;
    } } },
    document: { documentElement: root },
  });
  return { theme: attributes.get("data-theme") ?? null, colorScheme: root.style.colorScheme };
}

describe("minified theme init scripts", () => {
  it("parses and stamps the same theme as the unminified builders", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("./initScript.ts", import.meta.url))],
      bundle: true,
      minify: true,
      write: false,
      platform: "node",
      format: "cjs",
    });
    const module = { exports: {} as {
      getStoredThemeInitScript: typeof getStoredThemeInitScript;
      getThemeInitScript: typeof getThemeInitScript;
      getAuthoredThemeInitScript: typeof getAuthoredThemeInitScript;
    } };
    runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports });
    for (const defaultTheme of ["system", "light", "dark"] as const) {
      for (const stored of ["light", "dark", "system", null, "blocked"] as const) {
        for (const name of ["getStoredThemeInitScript", "getThemeInitScript"] as const) {
          const original = name === "getStoredThemeInitScript" ? getStoredThemeInitScript : getThemeInitScript;
          const options = { defaultTheme };
          expect(execute(module.exports[name](options), stored, stored === "blocked"))
            .toEqual(execute(original(options), stored, stored === "blocked"));
        }
      }
    }
    expect(execute(module.exports.getAuthoredThemeInitScript(), null, true))
      .toEqual(execute(getAuthoredThemeInitScript(), null, true));
  });
});
