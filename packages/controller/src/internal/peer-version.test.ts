import { describe, expect, it } from "vitest";
import { assertPeerVersion } from "./peer-version.js";

describe("assertPeerVersion", () => {
  it("stays silent when the installed version satisfies a caret range (prerequisite present)", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1" }),
    ).not.toThrow();
  });

  it("stays silent when the installed version satisfies a tilde range", () => {
    expect(() =>
      assertPeerVersion({ peer: "typescript", declaredRange: "~6.0.0", foundVersion: "6.0.3" }),
    ).not.toThrow();
  });

  it("stays silent when the installed version satisfies a bounded >= < range", () => {
    expect(() =>
      assertPeerVersion({ peer: "@clerk/nextjs", declaredRange: ">=7 <8", foundVersion: "7.5.13" }),
    ).not.toThrow();
  });

  it("stays silent when the installed version satisfies an unbounded >= range", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.0" })).not.toThrow();
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "18.0.0" })).not.toThrow();
  });

  it("throws a distinct, named error when the peer is not installed (absent)", () => {
    expect(() => assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: undefined })).toThrow(
      /svix is required for this import but is not installed/,
    );
  });

  it("throws a distinct, differently-worded error when the peer is installed but out of range", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "0.9.0" }),
    ).toThrow(/svix@0\.9\.0 is installed, but this package requires svix@"\^1\.96\.0"/);
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
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "0.9.0" });
    } catch (error) {
      outOfRangeMessage = (error as Error).message;
    }
    expect(missingMessage).not.toBe("");
    expect(outOfRangeMessage).not.toBe("");
    expect(missingMessage).not.toBe(outOfRangeMessage);
    expect(missingMessage).toContain("not installed");
    expect(outOfRangeMessage).toContain("incompatible");
  });

  it("throws a loud error for an unparseable declared range, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "1.x || 2.x", foundVersion: "1.99.1" }),
    ).toThrow(/Could not verify svix@1\.99\.1.*not a range form this guard parses/s);
  });

  it("throws a loud error for an unparseable installed version, never an assumed pass", () => {
    expect(() =>
      assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1-beta.0" }),
    ).toThrow(/not a plain x\.y\.z semver/);
  });

  it("correctly enforces the 0.x both-^-and-~-are-minor-locked rule", () => {
    expect(() =>
      assertPeerVersion({ peer: "example", declaredRange: "^0.3.0", foundVersion: "0.3.9" }),
    ).not.toThrow();
    expect(() =>
      assertPeerVersion({ peer: "example", declaredRange: "^0.3.0", foundVersion: "0.4.0" }),
    ).toThrow(/incompatible/);
    expect(() =>
      assertPeerVersion({ peer: "example", declaredRange: "~0.3.0", foundVersion: "0.4.0" }),
    ).toThrow(/incompatible/);
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    const result = assertPeerVersion({ peer: "svix", declaredRange: "^1.96.0", foundVersion: "1.99.1" });
    expect(result).toBeUndefined();
  });
});
