import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflightPackage: vi.fn(),
  runGovernanceCheck: vi.fn(),
}));

vi.mock("@vespeneventures/release", () => ({ preflightPackage: mocks.preflightPackage }));
vi.mock("./governance.js", () => ({ runGovernanceCheck: mocks.runGovernanceCheck }));

import { preflightGovernedPackage } from "./preflight.js";

describe("preflightGovernedPackage", () => {
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
    expect(mocks.preflightPackage).toHaveBeenCalledTimes(1);
  });

  it("uses release.scope for both checks when it is the only scope supplied", async () => {
    mocks.preflightPackage.mockResolvedValue({ ok: true });
    mocks.runGovernanceCheck.mockReturnValue({ ok: true });

    await preflightGovernedPackage("/workspace", "packages/core", {}, { release: { scope: "@example" } });

    expect(mocks.preflightPackage).toHaveBeenLastCalledWith("/workspace", "packages/core", { scope: "@example" });
    expect(mocks.runGovernanceCheck).toHaveBeenLastCalledWith("/workspace", {}, { scope: "@example" });
  });
});
