import { describe, expect, it, vi } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies a bounded >= < range (prerequisite present)", () => {
    expect(() =>
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.13" }),
    ).not.toThrow();
    expect(() => assertPeerVersion({ peer: "next", declaredRange: ">=16 <17", foundVersion: "16.3.0" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=19 <20", foundVersion: "19.2.8" })).not.toThrow();
  });

  it("stays silent when the installed version satisfies a caret range", () => {
    expect(() => assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1" })).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() =>
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: undefined }),
    ).toThrow(/@clerk\/nextjs is required for this import but is not installed/);
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() =>
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "8.0.0" }),
    ).toThrow(/@clerk\/nextjs@8\.0\.0 is installed, but this package requires @clerk\/nextjs@">=7 <8"/);
    expect(() =>
      assertPeerVersion({ peer: "next", declaredRange: ">=16 <17", foundVersion: "15.9.9" }),
    ).toThrow(/incompatible/);
  });

  it("the missing-peer and out-of-range messages are genuinely distinct", () => {
    let missingMessage = "";
    let outOfRangeMessage = "";
    try {
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: undefined });
    } catch (error) {
      missingMessage = (error as Error).message;
    }
    try {
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "0.1.0" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "1.x || 2.x", foundVersion: "1.99.1" }),
    ).toThrow(/not a range form this guard parses/);
  });

  it("warns and proceeds — never throws — for an unparseable installed version (indeterminate, not violated)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1+build.5" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/not a plain x\.y\.z semver/);
    } finally {
      warn.mockRestore();
    }
  });

  // Regression test for #389: `assertPeerVersion` used to throw
  // unconditionally on a peer version it could not parse. Under Next.js +
  // Turbopack, a `"use client"` module's bundled `react` import can
  // resolve during SSR to Next's own internally-vendored canary build
  // (e.g. `19.3.0-canary-3f0b9e61-20260317`), not the consumer's real
  // installed `react`. That prerelease string is not a value that FAILED
  // the range check — it is a value this guard cannot parse at all, so it
  // must be reported as indeterminate (warn once, proceed), never thrown
  // as a hard build-time crash.
  it("does not throw on a prerelease peer version — reports indeterminate via a single console.warn instead (#389)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({
          peer: "react",
          declaredRange: ">=19 <20",
          foundVersion: "19.3.0-canary-3f0b9e61-20260317",
        }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toContain("react");
      expect(message).toContain("19.3.0-canary-3f0b9e61-20260317");
      expect(message).toMatch(/prerelease identifier/);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns only once per distinct (peer, foundVersion) pair, but warns again for a different version of the same peer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.0-rc.1" });
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.0-rc.1" });
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.0-rc.1" });
      expect(warn).toHaveBeenCalledTimes(1);

      // A different unparseable version of the SAME peer is a different
      // finding — the guard against log spam must not swallow this one too.
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.0-rc.2" });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1" })).toBeUndefined();
  });
});
