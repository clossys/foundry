import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The package ships `dist`, and a published install must not depend on a test fixture folder. No
 * shipped Studio file may name `__fixtures__`; only tests may read the catalog fixtures.
 */
const here = dirname(fileURLToPath(import.meta.url));
const shipped = readdirSync(here).filter((name) => /\.(?:ts|tsx)$/.test(name) && !name.includes(".test."));

describe("Studio source never reaches into a fixtures folder", () => {
  it("scans every non-test file in this folder", () => {
    expect(shipped).toContain("demo-data.ts");
    expect(shipped).toContain("demo-engine.ts");
    expect(shipped).toContain("model.ts");
  });
  it.each(shipped)("%s does not mention __fixtures__", (name) => {
    expect(readFileSync(join(here, name), "utf8")).not.toContain("__fixtures__");
  });
});
