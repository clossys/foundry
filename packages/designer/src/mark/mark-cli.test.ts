import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliInputError, main } from "./mark-cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const completeFixture = join(packageRoot, "templates", "fixtures", "brand-mark-complete.tsx");
const missingInverseFixture = join(packageRoot, "templates", "fixtures", "brand-mark-missing-inverse.tsx");

describe("designer-mark-check CLI", () => {
  it("returns 0 for the complete fixture", () => {
    expect(main([completeFixture])).toBe(0);
  });

  it("returns 1 when inverse variant is missing", () => {
    expect(main([missingInverseFixture])).toBe(1);
  });

  it("returns 2 for a missing file", () => {
    expect(() => main(["/no/such/mark.tsx"])).toThrow(CliInputError);
  });
});
