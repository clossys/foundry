import { describe, expect, it } from "vitest";
import { resolveDefaultStrategyDirectory } from "./strategy-dir-default.js";

// Hermetic and fully synchronous: `resolveDefaultStrategyDirectory` is
// pure — it takes booleans for whether each candidate directory exists, so
// every test here passes a literal and never touches a filesystem. The
// CLI-side tests that DO use real `mkdtemp` directories live in
// `cli.test.ts`.

const currentDir = "/repo/clossys/strategist";
const legacyDir = "/repo/strategy";

describe("resolveDefaultStrategyDirectory", () => {
  it("resolves to the current convention when only it exists", () => {
    const result = resolveDefaultStrategyDirectory(currentDir, legacyDir, true, false);
    expect(result).toEqual({ reason: "current", dir: currentDir });
  });

  it("resolves to the current convention when neither directory exists (caller reports the missing-directory error one step later)", () => {
    const result = resolveDefaultStrategyDirectory(currentDir, legacyDir, false, false);
    expect(result).toEqual({ reason: "current", dir: currentDir });
  });

  it("falls back to the retired directory, with a notice, when only it exists", () => {
    const result = resolveDefaultStrategyDirectory(currentDir, legacyDir, false, true);
    expect(result.reason).toBe("legacy");
    if (result.reason !== "legacy") throw new Error("unreachable");
    expect(result.dir).toBe(legacyDir);
    expect(result.notice).toContain(legacyDir);
    expect(result.notice).toContain(currentDir);
  });

  it("is indeterminate, never a silent pick, when both directories exist", () => {
    const result = resolveDefaultStrategyDirectory(currentDir, legacyDir, true, true);
    expect(result.reason).toBe("indeterminate");
    if (result.reason !== "indeterminate") throw new Error("unreachable");
    expect(result.notice).toContain(legacyDir);
    expect(result.notice).toContain(currentDir);
    expect("dir" in result).toBe(false);
  });
});
