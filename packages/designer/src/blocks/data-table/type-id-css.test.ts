import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themeKeys = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "styles", "theme-keys.css"), "utf8");

describe("type-id binding", () => {
  it("binds identifier text to the mono family token with tabular figures", () => {
    const line = themeKeys.split("\n").find(text => text.startsWith("@utility type-id {"));
    expect(line).toBeDefined();
    expect(line).toContain("font-family: var(--font-mono");
    expect(line).toContain("font-variant-numeric: tabular-nums");
  });
});
