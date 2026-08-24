import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
};

describe("public role boundary", () => {
  it("ships one gate, zero runtime dependencies, and no provider adapter surface", () => {
    expect(manifest.bin).toEqual({ "influencer-check": "./dist/cli.js" });
    expect(manifest.dependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {})).toEqual(["."]);
    expect(existsSync(`${packageRoot}/src/providers`)).toBe(false);
  });
});
