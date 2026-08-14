import { describe, expect, it } from "vitest";
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

  it("throws a loud error for an unparseable installed version, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1+build.5" }),
    ).toThrow(/not a plain x\.y\.z semver/);
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1" })).toBeUndefined();
  });
});
