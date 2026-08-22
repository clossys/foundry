import { describe, expect, it } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies an unbounded >= range", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.7" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "18.0.0" })).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: undefined })).toThrow(/react is required for this import but is not installed/);
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "17.0.2" })).toThrow(/react@17\.0\.2 is installed, but this package requires react@">=18"/);
  });

  it("the missing-peer and out-of-range messages are genuinely distinct", () => {
    let missingMessage = "";
    let outOfRangeMessage = "";
    try {
      assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: undefined });
    } catch (error) {
      missingMessage = (error as Error).message;
    }
    try {
      assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "17.0.2" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: "18.x || 19.x", foundVersion: "19.2.7" })).toThrow(/not a range form this guard parses/);
  });

  it("throws a loud error for an unparseable installed version, never an assumed pass", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.7-canary.5" })).toThrow(/not a plain x\.y\.z semver/);
  });
});
