import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_BITS_NOT_ENFORCED_REASON, permissionBitsAreEnforced, skipUnlessPermissionBitsAreEnforced } from "./permission-enforcement.js";

// Deterministic, environment-independent proof that the probe actually
// discriminates: node:fs's readFileSync is mocked to either honor or
// bypass the chmod-000 restriction this module just applied, modeling
// exactly the two situations issue #825 is about — an ordinary process
// whose own reads are blocked by permission bits, and a root-uid process
// whose reads are not. Mocking both branches (rather than only relying on
// this machine's real, ambient uid) keeps the test's own answer from
// depending on whether it happens to run as root.
const mocks = vi.hoisted(() => ({
  permissionBitsEnforced: true,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      if (mocks.permissionBitsEnforced) {
        const error = new Error("EACCES: permission denied, open") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      // Simulate a root-uid process: chmod 0o000 does not actually block
      // this process's own read, so the read comes back clean — returned
      // directly rather than delegated to the real readFileSync, since on
      // an ordinary (non-root) machine running this very test suite, the
      // real chmod-000 file genuinely IS unreadable and would throw for
      // real, defeating the simulation.
      return Buffer.from("probe");
    }),
  };
});

afterEach(() => {
  mocks.permissionBitsEnforced = true;
  vi.clearAllMocks();
});

describe("permissionBitsAreEnforced", () => {
  it("is true when this process's own chmod-000 read is actually blocked (the ordinary, non-root case)", () => {
    mocks.permissionBitsEnforced = true;

    expect(permissionBitsAreEnforced()).toBe(true);
  });

  it("is false when this process's own chmod-000 read succeeds anyway (the root-uid bypass case)", () => {
    mocks.permissionBitsEnforced = false;

    expect(permissionBitsAreEnforced()).toBe(false);
  });
});

describe("skipUnlessPermissionBitsAreEnforced", () => {
  it("does not skip when permission bits are actually enforced — the test goes on to exercise the real condition", () => {
    mocks.permissionBitsEnforced = true;
    const skip = vi.fn(() => {
      throw new Error("skip() should not have been called");
    }) as unknown as (note?: string) => never;

    expect(() => skipUnlessPermissionBitsAreEnforced(skip)).not.toThrow();
    expect(skip).not.toHaveBeenCalled();
  });

  it("skips loudly, with the recorded reason, when permission bits are not enforced — never a silent pass and never a silent skip", () => {
    mocks.permissionBitsEnforced = false;
    const skip = vi.fn((note?: string) => {
      throw new Error(`SKIPPED: ${note ?? ""}`);
    }) as unknown as (note?: string) => never;

    expect(() => skipUnlessPermissionBitsAreEnforced(skip)).toThrow(/SKIPPED:/);
    expect(skip).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledWith(PERMISSION_BITS_NOT_ENFORCED_REASON);
    expect(PERMISSION_BITS_NOT_ENFORCED_REASON).toMatch(/#825/);
  });
});
