/**
 * The redirect allowlist: a closed set of destinations a consumer declares,
 * with every rejection returning `undefined` rather than falling back to a
 * caller-controlled value. Ported unchanged from the donor's own suite.
 */
import { describe, expect, it } from "vitest";
import { createAllowedOriginPolicy, isAllowedOrigin, resolveSafeRedirect } from "./index.js";

describe("safe redirects", () => {
  const policy = createAllowedOriginPolicy(["https://app.example.test", "http://localhost:3000"]);

  it("resolves same-origin paths and allowlisted absolute targets", () => {
    expect(resolveSafeRedirect("/account", policy, "https://app.example.test")).toBe("https://app.example.test/account");
    expect(resolveSafeRedirect("https://app.example.test/account?tab=security", policy)).toBe("https://app.example.test/account?tab=security");
    expect(isAllowedOrigin("http://localhost:3000/anything", policy)).toBe(true);
    expect(isAllowedOrigin("https:\\app.example.test", policy)).toBe(false);
  });

  it("rejects malformed, cross-origin, protocol-relative, backslash, non-http, and credential targets", () => {
    for (const target of [
      "https://",
      "https://outside.example.test/account",
      "//outside.example.test/account",
      "/\\outside.example.test",
      "/%5coutside.example.test",
      "javascript:alert(1)",
      "ftp://app.example.test/file",
      "https://user:password@app.example.test/account",
      "account",
      " /account",
    ]) {
      expect(resolveSafeRedirect(target, policy, "https://app.example.test")).toBeUndefined();
    }
    // baseOrigin present but not itself allowlisted: an untrusted-input-style
    // rejection, same as any other unsafe target — returns `undefined`.
    expect(resolveSafeRedirect("/account", policy, "https://outside.example.test")).toBeUndefined();
  });

  it("throws when a path-style target is given with no baseOrigin at all", () => {
    // Omitting baseOrigin entirely for a path-style target is a caller
    // programming error, not a security outcome — it must be distinguishable
    // from the `undefined` returned for a rejected (possibly hostile) target.
    expect(() => resolveSafeRedirect("/account", policy)).toThrow(TypeError);
  });

  it("rejects malformed origins while constructing the allowlist", () => {
    expect(() => createAllowedOriginPolicy(["https://app.example.test/path"])).toThrow();
    expect(() => createAllowedOriginPolicy(["javascript:alert(1)"])).toThrow();
    expect(() => createAllowedOriginPolicy(["https://user:password@app.example.test"])).toThrow();
    expect(() => createAllowedOriginPolicy([""])).toThrow();
  });

  it("dedupes duplicate origins instead of throwing, preserving first-occurrence order", () => {
    const deduped = createAllowedOriginPolicy([
      "https://app.example.test",
      "http://localhost:3000",
      "https://app.example.test",
      "http://localhost:3000",
      "https://other.example.test",
    ]);
    expect(deduped.origins).toEqual([
      "https://app.example.test",
      "http://localhost:3000",
      "https://other.example.test",
    ]);
    expect(Object.isFrozen(deduped)).toBe(true);
    expect(Object.isFrozen(deduped.origins)).toBe(true);
  });
});
