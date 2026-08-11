import { describe, expect, it } from "vitest";

import { resolveRequestRedirect } from "./server-routes.js";

describe("resolveRequestRedirect", () => {
  const request = "https://app.example.test/sign-out";

  it("accepts a same-origin relative path", () => {
    expect(resolveRequestRedirect(request, ["/account"]))
      .toBe("https://app.example.test/account");
  });

  it.each([
    "//other.example.test/path",
    "https://other.example.test/path",
    "javascript:alert(1)",
    "\\other.example.test/path",
    "https://user:password@app.example.test/path",
  ])("rejects unsafe target %s", (target) => {
    expect(resolveRequestRedirect(request, [target]))
      .toBeUndefined();
  });

  it("returns no dynamic redirect when candidates are missing or rejected", () => {
    expect(resolveRequestRedirect(request, [undefined, null, "//other.example.test/path"]))
      .toBeUndefined();
  });

  it("allows an explicitly trusted second origin", () => {
    expect(resolveRequestRedirect(
      request,
      ["https://accounts.example.test/complete"],
      ["https://accounts.example.test"],
    )).toBe("https://accounts.example.test/complete");
  });
});
