import { describe, expect, it } from "vitest";

import { humaniseClerkError } from "./client.js";

describe("humaniseClerkError", () => {
  it("prefers provider detail without leaking the whole object", () => {
    expect(humaniseClerkError({
      errors: [{ longMessage: "The supplied code has expired." }],
      privateValue: "must not appear",
    })).toBe("The supplied code has expired.");
  });

  it("turns a provider code into readable fallback text", () => {
    expect(humaniseClerkError({ errors: [{ code: "form_code_incorrect" }] }))
      .toBe("Form code incorrect.");
  });

  it("uses a stable generic message for unknown values", () => {
    expect(humaniseClerkError(null)).toBe("Authentication failed.");
  });
});
