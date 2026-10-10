/**
 * The redirect allowlist: a closed set of destinations a consumer declares,
 * with every rejection returning `undefined` rather than falling back to a
 * caller-controlled value. Ported unchanged from the donor's own suite.
 */
import { describe, expect, it } from "vitest";
import { createAllowedOriginPolicy, isAllowedOrigin, resolveSafeRedirect } from "./index.js";
import { resolveHardenedRedirect } from "./redirect.js";

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

  it("rejects targets whose normalised path is protocol-relative", () => {
    for (const target of [
      "/.//x",
      "/%2e//x",
      "/%2e%2e//x",
      "/..//x",
      "/a/..//x",
      "https://app.example.test/.//x",
    ]) {
      expect(resolveSafeRedirect(target, policy, "https://app.example.test")).toBeUndefined();
    }
    // A percent-encoded dot that is itself escaped stays a literal segment, so
    // the path keeps a single leading slash and remains on origin.
    expect(resolveSafeRedirect("/%252e//x", policy, "https://app.example.test")).toBe("https://app.example.test/%252e//x");
  });

  it("rejects targets carrying control characters", () => {
    for (const target of ["/acc\tount", "/account\nnext", "/.\t//x", "/x\u0000", "/x\u007f"]) {
      expect(resolveSafeRedirect(target, policy, "https://app.example.test")).toBeUndefined();
    }
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

describe("hardened redirects (opt-in; the functions above are unchanged)", () => {
  const policy = createAllowedOriginPolicy(["https://app.example.test", "https://accounts.example.test"]);
  const base = "https://app.example.test";
  const resolve = (target: string, excludedPaths: readonly string[] = ["/sign-in", "/sign-out"]) =>
    resolveHardenedRedirect(target, policy, base, { excludedPaths });

  it("keeps a plain same-host path and a legitimate allowlisted sibling exactly as written", () => {
    expect(resolve("/account?tab=security#keys")).toBe("https://app.example.test/account?tab=security#keys");
    expect(resolve("https://accounts.example.test/complete?step=2")).toBe("https://accounts.example.test/complete?step=2");
    expect(resolve("https://APP.example.test:443/account")).toBe("https://app.example.test/account");
    expect(resolve("/caf%C3%A9")).toBe("https://app.example.test/caf%C3%A9");
    // An excluded path is a same-host rule; a sibling's own route of the same name stays reachable.
    expect(resolve("https://accounts.example.test/sign-in")).toBe("https://accounts.example.test/sign-in");
  });

  it("refuses an excluded path at every inspected representation: as written, normalised, decoded and case-folded", () => {
    for (const target of [
      "/sign-in",
      "/sign-in/",
      "/sign-in/factor-two",
      "/sign-in?redirect_url=%2F",
      "/sign-in;jsessionid=1",
      "/SIGN-IN",
      "/Sign-Out",
      "/sign%2Din",
      "/%73ign-in",
      "/SIGN%2dOUT",
      "https://app.example.test/sign-out",
      "https://APP.EXAMPLE.TEST/Sign-In",
    ]) {
      expect(resolve(target), target).toBeUndefined();
    }
  });

  it("refuses encoded separators, double encoding and anything the URL parser would rewrite", () => {
    for (const target of [
      "/a/../sign-in",
      "/a/%2e%2e/sign-in",
      "/%2e/account",
      "/a%2fb",
      "/a%5Cb",
      "/%252e%252e/sign-in",
      "/%25",
      "/bad%zz",
      "/bad%4",
      "/a b",
      "/a\"b",
      "/a<b>",
      "/a`b",
      "/a{b}",
      "/x?a b",
      "/x?a\"b",
      "/x#a b",
      "/x?",
      "/x#",
      "/ação",
    ]) {
      expect(resolve(target), target).toBeUndefined();
    }
  });

  it("refuses malformed authority, any userinfo, controls and protocol-relative forms", () => {
    for (const target of [
      `https://${"@"}app.example.test/account`,
      "https://user@app.example.test/account",
      `https://:${"@"}app.example.test/account`,
      "https://app.example.test:99999/account",
      "https://app.example.test:/account",
      "https://app.example.test./account",
      "https://app.example.test%2F@outside.example.test/",
      "https:/app.example.test/account",
      "https:app.example.test/account",
      "https://app.example.test\\@outside.example.test/",
      "//app.example.test/account",
      "/\t/outside.example.test",
      "/account\u0000",
      "/account\u007f",
      "/account\u0085",
      "",
    ]) {
      expect(resolve(target), JSON.stringify(target)).toBeUndefined();
    }
  });

  it("refuses a result longer than 2048 characters and keeps one at the limit", () => {
    const prefix = "https://app.example.test/";
    const atLimit = `/${"a".repeat(2048 - prefix.length)}`;
    expect(resolve(atLimit)).toBe(`${prefix}${"a".repeat(2048 - prefix.length)}`);
    expect(resolve(`${atLimit}a`)).toBeUndefined();
  });

  it("refuses a non-string target and an unallowlisted base without throwing", () => {
    expect(resolveHardenedRedirect(undefined, policy, base)).toBeUndefined();
    expect(resolveHardenedRedirect(null, policy, base)).toBeUndefined();
    expect(resolveHardenedRedirect("/account", policy, "https://outside.example.test")).toBeUndefined();
    expect(resolveHardenedRedirect("https://outside.example.test/", policy, base)).toBeUndefined();
  });

  it("validates its exclusion list rather than reading it loosely", () => {
    expect(() => resolveHardenedRedirect("/x", policy, base, { excludedPaths: ["sign-in"] })).toThrow(TypeError);
    expect(() => resolveHardenedRedirect("/x", policy, base, { excludedPaths: "/sign-in" as unknown as string[] })).toThrow(TypeError);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => resolveHardenedRedirect("/x", policy, base, { excludedPaths: [, "/sign-in"] as unknown as string[] })).toThrow(TypeError);
    expect(() => resolveHardenedRedirect("/x", policy, base, Object.create({ excludedPaths: ["/x"] }))).toThrow(TypeError);
    expect(() => resolveHardenedRedirect("/x", policy, base, { get excludedPaths() { return ["/x"]; } })).toThrow(TypeError);
    // A polluted prototype carries no authority: only own data properties are read.
    Object.defineProperty(Object.prototype, "excludedPaths", { value: ["/x"], configurable: true });
    try {
      expect(resolveHardenedRedirect("/x", policy, base, {})).toBe("https://app.example.test/x");
    } finally {
      delete (Object.prototype as { excludedPaths?: unknown }).excludedPaths;
    }
  });
});
