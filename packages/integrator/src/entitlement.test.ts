import { describe, expect, it } from "vitest";
import { loadEntitlementDeclaration } from "./entitlement.js";
import { IntegratorValidationError } from "./errors.js";

describe("loadEntitlementDeclaration", () => {
  it("normalizes a minimal declaration", () => {
    const declaration = loadEntitlementDeclaration({
      version: 1,
      entitlements: [{ name: "@example-scope/one" }, { name: "@example-scope/two" }],
    });
    expect(declaration.entitlements).toEqual([{ name: "@example-scope/one" }, { name: "@example-scope/two" }]);
    expect(declaration.optOuts).toEqual([]);
  });

  it("keeps a valid opt-out with a required reason", () => {
    const declaration = loadEntitlementDeclaration({
      version: 1,
      entitlements: [{ name: "@example-scope/one" }],
      optOuts: [{ name: "@example-scope/one", reason: "Not needed by this plane's build.", recordedOn: "2026-08-01" }],
    });
    expect(declaration.optOuts).toEqual([{ name: "@example-scope/one", reason: "Not needed by this plane's build.", recordedOn: "2026-08-01" }]);
  });

  it("rejects the wrong version", () => {
    expect(() => loadEntitlementDeclaration({ version: 2, entitlements: [] })).toThrow(IntegratorValidationError);
  });

  it("rejects a duplicate entitlement", () => {
    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }, { name: "@example-scope/one" }],
      }),
    ).toThrow(/more than once/);
  });

  it("rejects an invalid package name", () => {
    expect(() => loadEntitlementDeclaration({ version: 1, entitlements: [{ name: "Not Valid" }] })).toThrow(IntegratorValidationError);
  });

  it("rejects an opt-out for a package that is not entitled", () => {
    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }],
        optOuts: [{ name: "@example-scope/two", reason: "not entitled to this one" }],
      }),
    ).toThrow(/not in entitlements/);
  });

  it("rejects an opt-out with no reason -- the whole point of this schema", () => {
    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }],
        optOuts: [{ name: "@example-scope/one", reason: "" }],
      }),
    ).toThrow(/reason/);

    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }],
        optOuts: [{ name: "@example-scope/one" }],
      }),
    ).toThrow(/reason/);
  });

  it("rejects a duplicate opt-out", () => {
    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }],
        optOuts: [
          { name: "@example-scope/one", reason: "first" },
          { name: "@example-scope/one", reason: "second" },
        ],
      }),
    ).toThrow(/more than once/);
  });

  it("rejects a malformed recordedOn", () => {
    expect(() =>
      loadEntitlementDeclaration({
        version: 1,
        entitlements: [{ name: "@example-scope/one" }],
        optOuts: [{ name: "@example-scope/one", reason: "x", recordedOn: "not-a-date" }],
      }),
    ).toThrow(/recordedOn/);
  });
});
