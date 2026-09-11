import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflightPackage: vi.fn(),
  runGovernanceCheck: vi.fn(),
}));

vi.mock("./release/index.js", () => ({ preflightPackage: mocks.preflightPackage }));
vi.mock("./governance.js", () => ({ runGovernanceCheck: mocks.runGovernanceCheck }));

import { preflightGovernedPackage } from "./preflight.js";

describe("preflightGovernedPackage", () => {
  // Explicit rather than inherited from the runner's default: the
  // "rejects contradictory scopes" case below asserts that NEITHER collaborator
  // was called, which is only meaningful if this test's counts start at zero.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the authoritative scope to release and governance", async () => {
    mocks.preflightPackage.mockResolvedValue({ ok: true });
    mocks.runGovernanceCheck.mockReturnValue({ ok: true });

    await expect(preflightGovernedPackage("/workspace", "packages/core", {}, {
      scope: "@example",
      release: { roundTrip: { timeoutsMs: { pack: 1 } } },
    })).resolves.toMatchObject({ ok: true });

    expect(mocks.preflightPackage).toHaveBeenCalledWith("/workspace", "packages/core", {
      scope: "@example",
      roundTrip: { timeoutsMs: { pack: 1 } },
    });
    expect(mocks.runGovernanceCheck).toHaveBeenCalledWith("/workspace", {}, { scope: "@example" });
  });

  it("rejects contradictory scopes before performing either check", async () => {
    await expect(preflightGovernedPackage("/workspace", "packages/core", {}, {
      scope: "@example",
      release: { scope: "@other" },
    })).rejects.toThrow("scope and release.scope must match");
    // "before performing either check" is the claim in this test's own name, so
    // both collaborators must be untouched. This previously asserted exactly one
    // call to preflightPackage, which passed only because the count leaked from
    // the preceding test -- preflight.ts throws before either call, so the true
    // count has always been zero.
    expect(mocks.preflightPackage).not.toHaveBeenCalled();
    expect(mocks.runGovernanceCheck).not.toHaveBeenCalled();
  });

  it("uses release.scope for both checks when it is the only scope supplied", async () => {
    mocks.preflightPackage.mockResolvedValue({ ok: true });
    mocks.runGovernanceCheck.mockReturnValue({ ok: true });

    await preflightGovernedPackage("/workspace", "packages/core", {}, { release: { scope: "@example" } });

    expect(mocks.preflightPackage).toHaveBeenLastCalledWith("/workspace", "packages/core", { scope: "@example" });
    expect(mocks.runGovernanceCheck).toHaveBeenLastCalledWith("/workspace", {}, { scope: "@example" });
  });
});
