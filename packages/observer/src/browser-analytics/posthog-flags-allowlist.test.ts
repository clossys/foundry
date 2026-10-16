import { describe, expect, it } from "vitest";
import { createPostHogProvider } from "./providers/posthog.js";
import { configFor, createFake } from "./posthog-fake.test.js";
import { FLAGS_BLOCK, exposures, flagsEligible, flagsEvaluated } from "./posthog-flags-host.test.js";

describe("P-48 posthog-flags-allowlist: only declared keys and variants resolve (C-74)", () => {
  it("valid declared key/variant pairs resolve, for a string variant and a boolean flag", () => {
    const { provider } = flagsEvaluated({ "hero-copy": "short", "new-nav": true });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
    expect(provider.flags.lookup("new-nav", false)).toBe(true);
  });

  it("an unknown key returns the supplied control with no request and no event", () => {
    const { fake, provider } = flagsEvaluated({ "hero-copy": "short", unlisted: "on" });
    const requests = fake.flagState.requests.length;
    const calls = fake.calls.length;
    expect(provider.flags.lookup("unlisted", "fallback")).toBe("fallback");
    expect(provider.flags.lookup("unlisted", true)).toBe(true);
    expect(provider.flags.lookup(42 as unknown as string, "fallback")).toBe("fallback");
    expect(fake.flagState.requests).toHaveLength(requests);
    expect(fake.calls).toHaveLength(calls);
    expect(exposures(fake)).toEqual([]);
  });

  it("an unlisted variant from the provider returns the declared control and is not exposed", () => {
    for (const value of ["other", "", "v".repeat(201), 1, null, { variant: "short" }, ["short"], "true"]) {
      const { fake, provider } = flagsEvaluated({ "hero-copy": value, "new-nav": "true" });
      expect(provider.flags.lookup("hero-copy", "control"), String(value)).toBe("control");
      expect(provider.flags.lookup("new-nav", false), String(value)).toBe(false);
      expect(exposures(fake), String(value)).toEqual([]);
    }
  });

  it("a provider value behind an accessor or on the prototype is never read", () => {
    let reads = 0;
    const variants = Object.create({ "new-nav": true }) as Record<string, unknown>;
    Object.defineProperty(variants, "hero-copy", {
      enumerable: true,
      get() {
        reads += 1;
        return "short";
      },
    });
    const { provider } = flagsEvaluated(variants);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(provider.flags.lookup("new-nav", false)).toBe(false);
    expect(reads).toBe(0);
  });

  it("a lookup whose control is not the declared one returns the declared control and sends nothing", () => {
    const { fake, provider } = flagsEvaluated();
    expect(provider.flags.lookup("hero-copy", "short")).toBe("control");
    expect(provider.flags.lookup("new-nav", true)).toBe(false);
    expect(exposures(fake)).toEqual([]);
  });

  it("refuses malformed keys and duplicate variants, and never invokes a definition getter", () => {
    let reads = 0;
    const definition = { variants: ["x", "y"] };
    Object.defineProperty(definition, "control", {
      enumerable: true,
      get() {
        reads += 1;
        return "x";
      },
    });
    const variants = ["x"];
    Object.defineProperty(variants, "1", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return "y";
      },
    });
    const entries = {};
    Object.defineProperty(entries, "a", {
      enumerable: true,
      get() {
        reads += 1;
        return { control: "x", variants: ["x", "y"] };
      },
    });
    for (const definitions of [
      { a: definition },
      { a: { control: "x", variants } },
      entries,
      { "a/b": { control: "x", variants: ["x", "y"] } },
      { a: { control: "x", variants: ["x", "x"] } },
      { a: { control: false, variants: [true, false, true] } },
    ]) {
      expect(() => createPostHogProvider(createFake().sdk, configFor({ flags: { ...FLAGS_BLOCK, definitions } }))).toThrow(TypeError);
    }
    expect(reads).toBe(0);
  });

  it("the definitions are copied at construction, so a later change to the host's object cannot widen them", () => {
    const definitions: Record<string, { control: string; variants: string[] }> = { "hero-copy": { control: "control", variants: ["control"] } };
    const block = { ...FLAGS_BLOCK, definitions };
    const { fake, provider } = flagsEligible({ flags: block });
    definitions["hero-copy"]!.variants.push("short");
    definitions.extra = { control: "a", variants: ["a", "b"] };
    fake.flagReply({ "hero-copy": "short", extra: "b" });
    expect(provider.flags.lookup("extra", "a")).toBe("a");
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });
});
