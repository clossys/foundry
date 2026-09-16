import { describe, expect, it, vi } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies this package's own caret range (prerequisite present)", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.30.2" })).not.toThrow();
  });

  it("stays silent when the installed version satisfies a bounded >= < range", () => {
    // Not a shape this package's own wiring uses (its one peer range is a
    // caret) — asserted anyway because this file is a verified copy of the
    // canonical body and `parseGteForm` is part of what it must still do.
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: ">=6 <7", foundVersion: "6.19.0" })).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: undefined })).toThrow(
      /resend is required for this import but is not installed/,
    );
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "7.0.0" })).toThrow(
      /resend@7\.0\.0 is installed, but this package requires resend@"\^6\.19\.0"/,
    );
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.18.9" })).toThrow(
      /incompatible/,
    );
  });

  it("the missing-peer and out-of-range messages are genuinely distinct", () => {
    let missingMessage = "";
    let outOfRangeMessage = "";
    try {
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: undefined });
    } catch (error) {
      missingMessage = (error as Error).message;
    }
    try {
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "0.1.0" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "6.x || 7.x", foundVersion: "6.19.0" })).toThrow(
      /not a range form this guard parses/,
    );
  });

  it("warns and proceeds — never throws — for an unparseable installed version (indeterminate, not violated)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0+build.5" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/not a plain x\.y\.z semver/);
      expect(warn.mock.calls[0]?.[0]).toContain("[@clossys/messenger]");
    } finally {
      warn.mockRestore();
    }
  });

  // Regression test for #389, carried with the canonical body this file is
  // a copy of: `assertPeerVersion` used to throw unconditionally on a peer
  // version it could not parse. A prerelease string is not a value that
  // FAILED the range check — it is a value this guard cannot parse at all,
  // so it must be reported as indeterminate (warn once, proceed), never
  // thrown as a hard build-time crash.
  it("does not throw on a prerelease peer version — reports indeterminate via a single console.warn instead (#389)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.20.0-canary.3" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toContain("resend");
      expect(message).toContain("6.20.0-canary.3");
      expect(message).toMatch(/prerelease identifier/);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns only once per distinct (peer, foundVersion) pair, but warns again for a different version of the same peer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.21.0-rc.1" });
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.21.0-rc.1" });
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.21.0-rc.1" });
      expect(warn).toHaveBeenCalledTimes(1);

      // A different unparseable version of the SAME peer is a different
      // finding — the guard against log spam must not swallow this one too.
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.21.0-rc.2" });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0" })).toBeUndefined();
  });
});
