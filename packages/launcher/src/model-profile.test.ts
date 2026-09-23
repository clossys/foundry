import { describe, expect, it } from "vitest";
import { parsePreferences, readHostModelProfile, resolveModelForTier, type HostModelProfile } from "./model-profile.js";

const CLAUDE_CODE_PROFILE: HostModelProfile = {
  schemaVersion: 1,
  host: "claude-code",
  verifiedAt: "2026-09-22",
  tiers: {
    light: { balanced: "claude-haiku-4-5" },
    standard: { balanced: "claude-sonnet-5", costConscious: "claude-haiku-4-5" },
    deep: { balanced: "claude-opus-5", costConscious: "claude-sonnet-5" },
  },
};

describe("parsePreferences", () => {
  it("defaults to balanced when the file does not exist", () => {
    expect(parsePreferences(null).budget).toBe("balanced");
  });

  it("defaults to balanced on malformed JSON, never throws", () => {
    expect(parsePreferences("{not json").budget).toBe("balanced");
  });

  it("defaults to balanced on an unknown budget value rather than trusting it", () => {
    expect(parsePreferences('{"schemaVersion":1,"budget":"unlimited"}').budget).toBe("balanced");
  });

  it("reads a valid preference exactly", () => {
    expect(parsePreferences('{"schemaVersion":1,"budget":"cost-conscious"}').budget).toBe("cost-conscious");
  });
});

describe("resolveModelForTier", () => {
  it("balanced preference resolves to the tier's balanced model", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "standard", "balanced");
    expect(resolution.model).toBe("claude-sonnet-5");
    expect(resolution.belowFloor).toBe(false);
  });

  it("cost-conscious substitutes the cheaper model when one is declared", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "standard", "cost-conscious");
    expect(resolution.model).toBe("claude-haiku-4-5");
  });

  it("cost-conscious falls back to balanced when no cheaper substitute exists for this tier (light has none)", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "light", "cost-conscious");
    expect(resolution.model).toBe("claude-haiku-4-5");
  });

  it("max-quality falls back to balanced when no stronger substitute is declared for this tier", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "standard", "max-quality");
    expect(resolution.model).toBe("claude-sonnet-5");
  });

  it("max-quality substitutes the stronger model when one is declared", () => {
    const profileWithMaxQuality: HostModelProfile = {
      ...CLAUDE_CODE_PROFILE,
      tiers: { ...CLAUDE_CODE_PROFILE.tiers, standard: { balanced: "claude-sonnet-5", maxQuality: "claude-opus-5" } },
    };
    const resolution = resolveModelForTier(profileWithMaxQuality, "standard", "max-quality");
    expect(resolution.model).toBe("claude-opus-5");
  });

  it("reports belowFloor rather than silently downgrading when the demanded tier misses a hard floor", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "light", "cost-conscious", "deep");
    expect(resolution.belowFloor).toBe(true);
    expect(resolution.model).toBe("claude-haiku-4-5");
  });

  it("meeting or exceeding the floor never reports belowFloor", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "deep", "balanced", "deep");
    expect(resolution.belowFloor).toBe(false);
  });
});

describe("readHostModelProfile", () => {
  const REAL_PROFILE = JSON.stringify({
    schemaVersion: 1,
    host: "claude-code",
    verifiedAt: "2026-09-22",
    tiers: {
      light: { balanced: "claude-haiku-4-5" },
      standard: { balanced: "claude-sonnet-5", costConscious: "claude-haiku-4-5" },
      deep: { balanced: "claude-opus-5", costConscious: "claude-sonnet-5" },
    },
  });

  it("reads a valid packed profile from model-profiles/<host>.json", () => {
    const profile = readHostModelProfile((path) => (path === "/pkg/model-profiles/claude-code.json" ? REAL_PROFILE : null), "/pkg", "claude-code");
    expect(profile?.host).toBe("claude-code");
    expect(profile?.tiers.standard.balanced).toBe("claude-sonnet-5");
  });

  it("returns undefined, never throws, when the file does not exist", () => {
    expect(readHostModelProfile(() => null, "/pkg", "codex")).toBeUndefined();
  });

  it("returns undefined on malformed JSON", () => {
    expect(readHostModelProfile(() => "{not json", "/pkg", "codex")).toBeUndefined();
  });

  it("returns undefined when the file's own host field does not match what was asked for", () => {
    expect(readHostModelProfile(() => REAL_PROFILE, "/pkg", "codex")).toBeUndefined();
  });

  it("returns undefined when a tier is missing its required balanced field", () => {
    const broken = JSON.stringify({
      schemaVersion: 1,
      host: "claude-code",
      verifiedAt: "2026-09-22",
      tiers: { light: {}, standard: { balanced: "x" }, deep: { balanced: "y" } },
    });
    expect(readHostModelProfile(() => broken, "/pkg", "claude-code")).toBeUndefined();
  });
});
