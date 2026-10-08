import { describe, expect, it, vi } from "vitest";
import { createMissingSettingsReporter, missingProviderSettings } from "./missing-settings.js";

describe("missingProviderSettings", () => {
  it("names both settings when neither is set", () => {
    expect(missingProviderSettings({ environment: {} })).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]);
  });

  it("treats an empty or whitespace value as missing", () => {
    expect(missingProviderSettings({ environment: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "  ", CLERK_SECRET_KEY: "" } })).toEqual([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
    ]);
  });

  it("reports nothing when both are set", () => {
    expect(missingProviderSettings({ environment: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk", CLERK_SECRET_KEY: "sk" } })).toEqual([]);
  });

  it("counts a publishable key given as an option", () => {
    expect(missingProviderSettings({ publishableKey: "pk", environment: { CLERK_SECRET_KEY: "sk" } })).toEqual([]);
  });
});

describe("createMissingSettingsReporter", () => {
  it("logs one line naming the missing settings and no values, then stays quiet", () => {
    const log = vi.fn();
    const report = createMissingSettingsReporter(log);
    const environment = { CLERK_SECRET_KEY: "sk_secret_value" };

    expect(report({ environment })).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);
    expect(report({ environment })).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(line).not.toContain("CLERK_SECRET_KEY");
    expect(line).not.toContain("sk_secret_value");
    expect(line).not.toContain("\n");
  });

  it("logs nothing, and does not use up the report, while every setting is present", () => {
    const log = vi.fn();
    const report = createMissingSettingsReporter(log);

    expect(report({ environment: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk", CLERK_SECRET_KEY: "sk" } })).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    report({ environment: {} });
    expect(log).toHaveBeenCalledOnce();
  });

  it("does not let a throwing log sink break the caller", () => {
    const report = createMissingSettingsReporter(() => {
      throw new Error("sink down");
    });
    expect(() => report({ environment: {} })).not.toThrow();
  });
});
