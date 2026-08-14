import { describe, expect, it } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies a caret range (prerequisite present)", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.99.0" })).not.toThrow();
  });

  it("stays silent when the installed version satisfies a bounded >= < range", () => {
    expect(() =>
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.13" }),
    ).not.toThrow();
  });

  it("stays silent when the installed version satisfies an unbounded >= range", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.0" })).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() => assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: undefined })).toThrow(
      /resend is required for this import but is not installed/,
    );
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() =>
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "5.0.0" }),
    ).toThrow(/resend@5\.0\.0 is installed, but this package requires resend@"\^6\.19\.0"/);
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
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "5.0.0" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "resend", declaredRange: "6.x", foundVersion: "6.19.0" }),
    ).toThrow(/not a range form this guard parses/);
  });

  it("throws a loud error for an unparseable installed version, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0-rc.1" }),
    ).toThrow(/not a plain x\.y\.z semver/);
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "resend", declaredRange: "^6.19.0", foundVersion: "6.19.0" })).toBeUndefined();
  });
});
