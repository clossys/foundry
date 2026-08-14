import { describe, expect, it } from "vitest";
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

  it("throws a loud error for an unparseable installed version, never an assumed pass", () => {
    expect(() => assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.8-canary.5" })).toThrow(
      /not a plain x\.y\.z semver/,
    );
  });

  it("never returns a value — the decline path is a thrown error, not a status", () => {
    expect(assertPeerVersion({ peer: "react", declaredRange: ">=18", foundVersion: "19.2.8" })).toBeUndefined();
  });
});
