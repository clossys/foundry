import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_PLACEHOLDER, parsePreferences, readHostModelProfile, resolveModelForTier, type HostModelProfile, type SupportedHost } from "./model-profile.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readReal = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const CLAUDE_CODE_PROFILE: HostModelProfile = {
  schemaVersion: 1,
  host: "claude-code",
  verifiedAt: "2026-09-22",
  tiers: {
    light: { balanced: "fixture-small" },
    standard: { balanced: "fixture-mid", costConscious: "fixture-small" },
    deep: { balanced: "fixture-large", costConscious: "fixture-mid" },
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
    expect(resolution.model).toBe("fixture-mid");
    expect(resolution.belowFloor).toBe(false);
    expect(resolution.unresolved).toBe(false);
  });

  it("cost-conscious substitutes the cheaper model when one is declared", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "standard", "cost-conscious");
    expect(resolution.model).toBe("fixture-small");
  });

  it("cost-conscious falls back to balanced when no cheaper substitute exists for this tier (light has none)", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "light", "cost-conscious");
    expect(resolution.model).toBe("fixture-small");
  });

  it("max-quality falls back to balanced when no stronger substitute is declared for this tier", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "standard", "max-quality");
    expect(resolution.model).toBe("fixture-mid");
  });

  it("max-quality substitutes the stronger model when one is declared", () => {
    const profileWithMaxQuality: HostModelProfile = {
      ...CLAUDE_CODE_PROFILE,
      tiers: { ...CLAUDE_CODE_PROFILE.tiers, standard: { balanced: "fixture-mid", maxQuality: "fixture-large" } },
    };
    const resolution = resolveModelForTier(profileWithMaxQuality, "standard", "max-quality");
    expect(resolution.model).toBe("fixture-large");
  });

  it("reports belowFloor rather than silently downgrading when the demanded tier misses a hard floor", () => {
    const resolution = resolveModelForTier(CLAUDE_CODE_PROFILE, "light", "cost-conscious", "deep");
    expect(resolution.belowFloor).toBe(true);
    expect(resolution.model).toBe("fixture-small");
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
      light: { balanced: "fixture-small" },
      standard: { balanced: "fixture-mid", costConscious: "fixture-small" },
      deep: { balanced: "fixture-large", costConscious: "fixture-mid" },
    },
  });

  it("reads a valid packed profile from model-profiles/<host>.json", () => {
    const profile = readHostModelProfile((path) => (path === "/pkg/model-profiles/claude-code.json" ? REAL_PROFILE : null), "/pkg", "claude-code");
    expect(profile?.host).toBe("claude-code");
    expect(profile?.tiers.standard.balanced).toBe("fixture-mid");
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

describe("packed profiles name no vendor model; the consumer's policy does", () => {
  const HOSTS: readonly SupportedHost[] = ["claude-code", "codex", "cursor"];

  it.each(HOSTS)("the packed %s profile parses and every model is a <model:tier> placeholder", (host) => {
    const profile = readHostModelProfile(readReal, PACKAGE_ROOT, host);
    expect(profile?.host).toBe(host);
    const models = Object.values(profile!.tiers).flatMap((mapping) => [mapping.balanced, mapping.costConscious, mapping.maxQuality]).filter((model) => model !== undefined);
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) expect(model).toMatch(MODEL_PLACEHOLDER);
  });

  it("a packed placeholder resolves, but reports unresolved rather than guessing a model", () => {
    const resolution = resolveModelForTier(readHostModelProfile(readReal, PACKAGE_ROOT, "codex")!, "deep", "balanced");
    expect(resolution).toMatchObject({ model: "<model:deep>", unresolved: true });
  });

  it("a valid consumer policy wins over the packed profile", () => {
    const policy = JSON.stringify({ ...CLAUDE_CODE_PROFILE });
    const files: Record<string, string> = { "/consumer/clossys/model-profiles/claude-code.json": policy };
    const read = (path: string) => files[path] ?? readReal(path);
    const profile = readHostModelProfile(read, PACKAGE_ROOT, "claude-code", "/consumer");
    expect(resolveModelForTier(profile!, "deep", "balanced")).toMatchObject({ model: "fixture-large", unresolved: false });
  });

  it("an absent or malformed consumer policy falls back to the packed profile, never to a guess", () => {
    expect(readHostModelProfile(readReal, PACKAGE_ROOT, "cursor", "/no-such-consumer")?.tiers.deep.balanced).toBe("<model:deep>");
    const read = (path: string) => (path === "/consumer/clossys/model-profiles/cursor.json" ? "{not json" : readReal(path));
    expect(readHostModelProfile(read, PACKAGE_ROOT, "cursor", "/consumer")?.tiers.deep.balanced).toBe("<model:deep>");
  });
});
