import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDeclarationsForSelector } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const rootDecls = parseDeclarationsForSelector(tokensCss, ":root");

describe("--text-display-l is a length, not a font shorthand", () => {
  it("tokens.css declares a plain length", () => {
    const value = rootDecls.get("--text-display-l");
    expect(value).toBeDefined();
    expect(value).toMatch(/^\d+(\.\d+)?px$/);
    expect(value).not.toContain("/");
  });
});
