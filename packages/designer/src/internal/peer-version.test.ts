import { describe, expect, it, vi } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies an unbounded >= range (prerequisite present)", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.8" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "react-dom", declaredRange: ">=18", foundVersion: "18.0.0" })).not.toThrow();
  });

  it("stays silent when the installed version satisfies a caret range", () => {
    expect(() =>
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "1.20.0" }),
    ).not.toThrow();
    expect(() => assertPeerVersion({ peer: "tailwind-merge", declaredRange: "^3.0.0", foundVersion: "3.4.1" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "tailwindcss", declaredRange: "^4.0.0", foundVersion: "4.3.3" })).not.toThrow();
    expect(() =>
      assertPeerVersion({ peer: "@internationalized/date", declaredRange: "^3.12.2", foundVersion: "3.12.3" }),
    ).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: undefined })).toThrow(
      /react is required for this import but is not installed/,
    );
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() =>
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "0.9.0" }),
    ).toThrow(/react-aria-components@0\.9\.0 is installed, but this package requires react-aria-components@"\^1\.19\.0"/);
    expect(() => assertPeerVersion({ peer: "tailwindcss", declaredRange: "^4.0.0", foundVersion: "3.4.0" })).toThrow(
      /incompatible/,
    );
  });

  it("the missing-peer and out-of-range messages are genuinely distinct", () => {
    let missingMessage = "";
    let outOfRangeMessage = "";
    try {
      assertPeerVersion({ peer: "tailwind-merge", declaredRange: "^3.0.0", foundVersion: undefined });
    } catch (error) {
      missingMessage = (error as Error).message;
    }
    try {
      assertPeerVersion({ peer: "tailwind-merge", declaredRange: "^3.0.0", foundVersion: "1.0.0" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: "18.x || 19.x", foundVersion: "19.2.8" })).toThrow(
      /not a range form this guard parses/,
    );
  });

  it("warns and proceeds — never throws — for an unparseable installed version (indeterminate, not violated)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.8-canary.5" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/prerelease identifier/);
    } finally {
      warn.mockRestore();
    }
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.8" })).toBeUndefined();
  });

  // Regression test for #389: `assertPeerVersion` used to throw
  // unconditionally on a peer version it could not parse. Under Next.js +
  // Turbopack, a `"use client"` module's bundled `react` import can
  // resolve during SSR to Next's own internally-vendored canary build
  // (e.g. `19.3.0-canary-3f0b9e61-20260317`), not the consumer's real
  // installed `react`. That prerelease string is not a value that FAILED
  // the range check — it is a value this guard cannot parse at all, so it
  // must be reported as indeterminate (warn once, proceed), never thrown
  // as a hard build-time crash. This package's own `react` guard sits at
  // every component subpath's barrel — atoms, blocks, shell, charts, and
  // theme — so a crash here took down every one of them.
  it("does not throw on a prerelease react version — reports indeterminate via a single console.warn instead (#389)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({
          peer: "react",
          declaredRange: ">=18",
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
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "1.20.0-rc.1" });
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "1.20.0-rc.1" });
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "1.20.0-rc.1" });
      expect(warn).toHaveBeenCalledTimes(1);

      // A different unparseable version of the SAME peer is a different
      // finding — the guard against log spam must not swallow this one too.
      assertPeerVersion({ peer: "react-aria-components", declaredRange: "^1.19.0", foundVersion: "1.20.0-rc.2" });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
