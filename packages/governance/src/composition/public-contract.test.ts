import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as composition from "./index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("composition public contract", () => {
  it("exports exactly the pure runtime API", () => {
    expect(Object.keys(composition).sort()).toEqual([
      "COMPOSITION_SCHEMA_VERSION",
      "evaluateComposition",
      "validateCompositionEvaluationInput",
    ]);
  });

  it("is a focused governance subpath rather than a top-level package", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports["./composition"]).toEqual({
      types: "./dist/composition/index.d.ts",
      import: "./dist/composition/index.js",
    });
  });

  it("contains no ambient or mutation adapter imports", () => {
    for (const file of ["types.ts", "keys.ts", "validate.ts", "evaluate.ts", "index.ts"]) {
      const source = readFileSync(join(packageRoot, "src", "composition", file), "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)]
        .map((match) => match[1] ?? match[2] ?? match[3]);
      expect(specifiers.every((specifier) => specifier.startsWith("./"))).toBe(true);
      expect(source).not.toMatch(/process\.env|Date\.now|new Date\(\)|fetch\(|readFile|writeFile|execFile|spawn/);
    }
  });
});
