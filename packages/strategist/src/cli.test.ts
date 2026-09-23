import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main, parseArgs } from "./cli.js";

// Hermetic: every test operates on its own pair of `mkdtemp` directories
// (strategy + scan), removed afterward, and calls the exported `main(argv)`
// directly rather than spawning the real CLI process.

let strategyDir: string;
let scanDir: string;
let factsDir: string;

const validFact = {
  key: "active-customers",
  label: "Active customers",
  value: 4200,
  source: "billing-export-2026-06",
  lastUpdatedAt: "2026-06-30",
  aliases: ["4,200"],
};

beforeEach(() => {
  strategyDir = mkdtempSync(join(tmpdir(), "strategy-cli-strategy-"));
  scanDir = mkdtempSync(join(tmpdir(), "strategy-cli-scan-"));
  factsDir = mkdtempSync(join(tmpdir(), "strategy-cli-factsdir-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(strategyDir, { recursive: true, force: true });
  rmSync(scanDir, { recursive: true, force: true });
  rmSync(factsDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("collects repeatable --extensions values", () => {
    expect(parseArgs(["./clossys/strategist", "./docs", "--extensions", ".md", "--extensions", ".txt"]).extensions).toEqual([
      ".md",
      ".txt",
    ]);
  });

  it("collects repeatable --skip-dirs values", () => {
    expect(parseArgs(["./clossys/strategist", "--skip-dirs", "vendor", "--skip-dirs", ".cache"]).skipDirs).toEqual([
      "vendor",
      ".cache",
    ]);
  });

  it("collects repeatable --exclude globs", () => {
    expect(parseArgs(["./clossys/strategist", "--exclude", "**/*.test.ts", "--exclude", "**/fixtures/**"]).excludeGlobs).toEqual(
      ["**/*.test.ts", "**/fixtures/**"],
    );
  });

  it("throws CliInputError when --extensions is given without a value", () => {
    expect(() => parseArgs([strategyDir, "--extensions"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --extensions omits the leading dot", () => {
    expect(() => parseArgs([strategyDir, "--extensions", "md"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --skip-dirs is given without a value", () => {
    expect(() => parseArgs([strategyDir, "--skip-dirs"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => parseArgs([strategyDir, "--bogus"])).toThrow(CliInputError);
  });
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching either directory", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when strategy-dir is omitted and neither the default clossys/strategist nor the retired strategy directory exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "strategy-cli-cwd-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      expect(() => main([])).toThrow(CliInputError);
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => main([strategyDir, scanDir, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when strategy-dir does not exist", () => {
    expect(() => main([join(strategyDir, "does-not-exist"), scanDir])).toThrow(CliInputError);
  });
});

describe("main — default strategy-dir resolution (legacy fallback, #1171)", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "strategy-cli-default-cwd-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    // A benign scan target so the default scan-dir (also `cwd`) matches at
    // least one file — nothing here exercises the facts gate itself.
    writeFileSync(join(cwd, "notes.md"), "Nothing claim-shaped here.");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads clossys/strategist silently when only it exists (no legacy notice)", () => {
    mkdirSync(join(cwd, "clossys", "strategist"), { recursive: true });
    writeFileSync(join(cwd, "clossys", "strategist", "facts.json"), JSON.stringify([validFact]));

    expect(main([])).toBe(0);
    const logs = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(logs.some((line) => line.includes("retired"))).toBe(false);
  });

  it("falls back to the retired strategy/ directory, with a notice, when clossys/strategist does not exist", () => {
    mkdirSync(join(cwd, "strategy"), { recursive: true });
    writeFileSync(join(cwd, "strategy", "facts.json"), JSON.stringify([validFact]));

    expect(main([])).toBe(0);
    const logs = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(logs.some((line) => line.includes("retired") && line.includes("strategy") && line.includes("clossys/strategist"))).toBe(
      true,
    );
  });

  it("is indeterminate (exit 2), never a silent pick, when both clossys/strategist and strategy exist", () => {
    mkdirSync(join(cwd, "clossys", "strategist"), { recursive: true });
    writeFileSync(join(cwd, "clossys", "strategist", "facts.json"), JSON.stringify([validFact]));
    mkdirSync(join(cwd, "strategy"), { recursive: true });
    writeFileSync(join(cwd, "strategy", "facts.json"), JSON.stringify([validFact]));

    expect(main([])).toBe(2);
    const errors = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(errors.some((line) => line.includes("Both") && line.includes("strategy") && line.includes("clossys/strategist"))).toBe(
      true,
    );
  });

  it("an explicit strategy-dir argument skips resolution entirely, even when both directories exist", () => {
    mkdirSync(join(cwd, "clossys", "strategist"), { recursive: true });
    writeFileSync(join(cwd, "clossys", "strategist", "facts.json"), JSON.stringify([validFact]));
    mkdirSync(join(cwd, "strategy"), { recursive: true });
    writeFileSync(join(cwd, "strategy", "facts.json"), JSON.stringify([validFact]));

    expect(main([join(cwd, "clossys", "strategist"), cwd])).toBe(0);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when facts.json is missing (fail closed, never a silent pass)", () => {
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(main([strategyDir, scanDir])).toBe(2);
  });

  it("returns 2 when facts.json is invalid", () => {
    writeFileSync(join(strategyDir, "facts.json"), "{ not json");
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(main([strategyDir, scanDir])).toBe(2);
  });

  it("returns 2 when zero files match the scan (never reported as a clean pass)", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "data.json"), "{}"); // .json is not a scanned extension
    expect(main([strategyDir, scanDir])).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 0 on a clean pass", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir])).toBe(0);
  });

  it("returns 1 when a finding is present", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir])).toBe(1);
  });

  it("an issue on an OPTIONAL strategy file does not block the facts gate", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(strategyDir, "roadmap.json"), JSON.stringify([{ id: "x" }])); // invalid, but not facts.json
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir])).toBe(0);
  });

  it("honors --extensions to limit scanned file types", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--extensions", ".txt"])).toBe(2);
  });

  it("still skips node_modules when --skip-dirs adds extra names", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    const nested = join(scanDir, "node_modules", "pkg");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "readme.md"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir, "--skip-dirs", "vendor"])).toBe(0);
  });

  it("honors --exclude to omit test paths from the scan", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    mkdirSync(join(scanDir, "src"), { recursive: true });
    writeFileSync(join(scanDir, "src", "widget.test.ts"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir, "--exclude", "**/*.test.ts"])).toBe(0);
    expect(main([strategyDir, scanDir])).toBe(1);
  });
});

// -----------------------------------------------------------------------
// brand-coverage — the second subcommand. Same hermetic-mkdtemp discipline
// as the tests above: real files on disk, `main(argv)` called directly,
// nothing spawned. `strategyDir` is reused purely as a scratch directory
// for these two JSON input files — it has no facts-gate meaning here.
// -----------------------------------------------------------------------

const RATIONALE = "Precision means the accent color must read as decisive, not soft, and copy states facts without hedging.";

function derivation(attributeId: string, tokenSlots: string[], voiceRuleIds: string[] = []) {
  return { attributeId, tokenSlots, voiceRuleIds, rationale: RATIONALE };
}

function writeDerivations(dir: string, value: unknown): string {
  const path = join(dir, "brand-derivations.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function writeBrandableSlots(dir: string, value: unknown): string {
  const path = join(dir, "brandable-slots.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("main — brand-coverage — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["brand-coverage", "--help"])).toBe(0);
  });

  it("throws CliInputError when derivations-file is missing", () => {
    expect(() => main(["brand-coverage"])).toThrow(CliInputError);
  });

  it("throws CliInputError when brandable-slots-file is missing", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    expect(() => main(["brand-coverage", derivationsFile])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(() => main(["brand-coverage", derivationsFile, slotsFile, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when derivations-file does not exist", () => {
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(() => main(["brand-coverage", join(strategyDir, "nope.json"), slotsFile])).toThrow(CliInputError);
  });

  it("throws CliInputError when brandable-slots-file does not exist", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    expect(() => main(["brand-coverage", derivationsFile, join(strategyDir, "nope.json")])).toThrow(CliInputError);
  });
});

describe("main — brand-coverage — the third state: could not run (exit 2)", () => {
  it("returns 2 when derivations-file does not parse as JSON", () => {
    const derivationsFile = join(strategyDir, "brand-derivations.json");
    writeFileSync(derivationsFile, "{ not json");
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  it("returns 2 when derivations-file fails schema validation", () => {
    const derivationsFile = writeDerivations(strategyDir, [{ attribute: "Precise" }]); // missing tokenSlots/voiceRules/rationale
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  it("returns 2 when brandable-slots-file does not parse as JSON", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = join(strategyDir, "brandable-slots.json");
    writeFileSync(slotsFile, "{ not json");
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  it("returns 2 when brandable-slots-file is not an array of strings", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, { not: "an array" });
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  // Required test 3: an empty brandable-slot list is indeterminate, never
  // 0 and never 1 — checkBrandCoverage's own "no-slots-provided" reason.
  it("returns 2 for an empty brandable-slots list, even against real derivations", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, []);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  // Required test 4: empty derivations is indeterminate, never 0 and never
  // 1 — checkBrandCoverage's own "no-derivations-provided" reason.
  it("returns 2 for empty derivations, even against real brandable slots", () => {
    const derivationsFile = writeDerivations(strategyDir, []);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(2);
  });

  // Required test 5, part 1: a missing file is `CliInputError` from
  // `main()` directly — the same "bad arguments" shape every other
  // missing-path case in this file uses. See the "direct-path
  // reachability" section below for the actual process exit code (2) that
  // `run()` maps this to when this same condition is hit through the real
  // compiled CLI, not the exported function.
  it("throws CliInputError when derivations-file is missing at the resolved path (unreadable)", () => {
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(() => main(["brand-coverage", join(strategyDir, "does-not-exist.json"), slotsFile])).toThrow(CliInputError);
  });
});

describe("main — brand-coverage — real runs", () => {
  // Required test 6: both directions satisfied → exit 0.
  it("returns 0 when every brandable slot has a derivation and every derivation names a real slot", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary"], ["no-hedging"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(0);
  });

  // Required test 1: an obligation (derivation) names a slot absent from
  // the brandable list — direction 2, unknownSlotsInDerivations.
  it("returns 1 when a derivation names a slot absent from brandable-slots-file", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary", "--color-not-brandable"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(1);
  });

  // Required test 2: a brandable slot no derivation names — direction 1,
  // slotsMissingDerivation. This is the direction a one-directional
  // checker would pass, proving both directions are actually wired.
  it("returns 1 when a brandable slot is named by no derivation", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary", "--color-accent-secondary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile])).toBe(1);
  });

  it("returns 2 when a declared --surfaces path is missing", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    expect(main(["brand-coverage", derivationsFile, slotsFile, "--surfaces", join(strategyDir, "nope.md")])).toBe(2);
  });

  it("returns 1 when a declared surface has no do-not language", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    const surface = join(strategyDir, "direction.md");
    writeFileSync(surface, "Use accent blue for primary actions.\n");
    expect(main(["brand-coverage", derivationsFile, slotsFile, "--surfaces", surface])).toBe(1);
  });

  it("returns 0 when slot coverage holds and surfaces include do-not language", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary"], ["no-hedging"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    const surface = join(strategyDir, "direction.md");
    writeFileSync(surface, "Do not use neon accent on body copy.\n");
    expect(main(["brand-coverage", derivationsFile, slotsFile, "--surfaces", surface])).toBe(0);
  });

  it("prints Designer-readable brand law separately from slot N/N when --surfaces is set", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary"], ["no-hedging"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);
    const surface = join(strategyDir, "direction.md");
    writeFileSync(surface, "Do not use neon accent on body copy.\n");
    expect(main(["brand-coverage", derivationsFile, slotsFile, "--surfaces", surface])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toMatch(
      /Designer-readable brand law: satisfied/,
    );
  });
});

// -----------------------------------------------------------------------
// `direction` — the third subcommand. Same shape the `brand-coverage`
// suite above uses: `main(argv)` called directly, a `direction-entities`
// JSON file, and a `reviewed-against` JSON file (a flat array of strings,
// one entry per derived artifact's `reviewedAgainst` value).
// -----------------------------------------------------------------------

const DIRECTION_RATIONALE =
  "Customers now cite audit requirements as their top blocker, not speed — the vision has to say so.";

function directionEntity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    subject: { file: "mission.json", id: "mission" },
    decidedOn: "2026-01-05",
    derivesFrom: [],
    ...overrides,
  };
}

function writeDirectionEntities(dir: string, value: unknown): string {
  const path = join(dir, "direction-entities.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function writeReviewedAgainst(dir: string, value: unknown): string {
  const path = join(dir, "reviewed-against.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("main — direction — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["direction", "--help"])).toBe(0);
  });

  it("throws CliInputError when direction-entities-file is missing", () => {
    expect(() => main(["direction"])).toThrow(CliInputError);
  });

  it("throws CliInputError when reviewed-against-file is missing", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    expect(() => main(["direction", entitiesFile])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(() => main(["direction", entitiesFile, reviewsFile, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when direction-entities-file does not exist", () => {
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(() => main(["direction", join(strategyDir, "nope.json"), reviewsFile])).toThrow(CliInputError);
  });

  it("throws CliInputError when reviewed-against-file does not exist", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    expect(() => main(["direction", entitiesFile, join(strategyDir, "nope.json")])).toThrow(CliInputError);
  });
});

describe("main — direction — the third state: could not run (exit 2)", () => {
  it("returns 2 when direction-entities-file does not parse as JSON", () => {
    const entitiesFile = join(strategyDir, "direction-entities.json");
    writeFileSync(entitiesFile, "{ not json");
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  it("returns 2 when direction-entities-file fails schema validation", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [{ id: "vision-v1" }]); // missing kind/statement/rationale/decidedOn/derivesFrom
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  it("returns 2 when reviewed-against-file does not parse as JSON", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = join(strategyDir, "reviewed-against.json");
    writeFileSync(reviewsFile, "{ not json");
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  it("returns 2 when reviewed-against-file is not an array of strings", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, { not: "an array" });
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  // Empty direction-entities is indeterminate — checkDirectionCoverage's
  // and checkDirectionCurrency's shared "no-entities-provided" reason.
  it("returns 2 for empty direction-entities, even against real reviewedAgainst references", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, []);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  // Empty reviewed-against is indeterminate — "no-reviews-provided".
  it("returns 2 for an empty reviewed-against list, even against real direction entities", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, []);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(2);
  });

  it("throws CliInputError when direction-entities-file is missing at the resolved path (unreadable)", () => {
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(() => main(["direction", join(strategyDir, "does-not-exist.json"), reviewsFile])).toThrow(CliInputError);
  });
});

describe("main — direction — real runs", () => {
  it("returns 0 when every direction entity has a derived artifact and every reviewedAgainst is current", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(0);
  });

  // Coverage direction 1: a direction entity named by no reviewedAgainst.
  it("returns 1 when a direction entity has no derived artifact", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [
      directionEntity("vision-v1"),
      directionEntity("positioning-v1", { subject: { file: "positioning.json", id: "positioning" } }),
    ]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(1);
  });

  // Coverage direction 2: a reviewedAgainst naming no known entity.
  it("returns 1 when a reviewedAgainst reference names no known direction entity", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1", "typo-d-id"]);
    expect(main(["direction", entitiesFile, reviewsFile])).toBe(1);
  });

  // THE SEPARATING CASE, exercised through the real CLI subcommand: a
  // reviewedAgainst names a REAL, EXISTING but SUPERSEDED version.
  // Coverage alone (presence/traceability) is satisfied by this input —
  // the reference resolves — but the combined `direction` subcommand must
  // still exit 1, because checkDirectionCurrency flags it stale.
  it("returns 1 when a reviewedAgainst names a real but superseded version (stale, not dangling)", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [
      directionEntity("vision-v1"),
      directionEntity("vision-v2", { supersedes: "vision-v1", decidedOn: "2026-07-01" }),
    ]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1", "vision-v2"]);

    const coverage = checkDirectionCoverageDirect(entitiesFile, reviewsFile);
    expect(coverage).toBe(true); // presence-only: both ids resolve, coverage alone would pass

    expect(main(["direction", entitiesFile, reviewsFile])).toBe(1);
  });
});

// Small helper used only by the "separating case" test above: replays
// exactly what `checkDirectionCoverage` (the presence/traceability half)
// would see for the same two files, so the test can assert presence
// resolves cleanly before also asserting the combined subcommand still
// fails — proving the failure comes from currency, not from coverage.
function checkDirectionCoverageDirect(entitiesFile: string, reviewsFile: string): boolean {
  const entities = JSON.parse(readFileSync(entitiesFile, "utf8")) as Array<{ id: string }>;
  const reviews = JSON.parse(readFileSync(reviewsFile, "utf8")) as string[];
  const ids = new Set(entities.map((e) => e.id));
  return reviews.every((ref) => ids.has(ref));
}

// -----------------------------------------------------------------------
// Direct-path reachability (required test 7). Everything above calls the
// exported `main(argv)` directly, which proves the argv-to-exit-code
// contract but NEVER proves the CLI is reachable the only way it actually
// ships: as `node dist/cli.js ...`, invoked by a consumer's CI or by the
// `strategist-check`/future `node_modules/.bin` symlink. This is the
// exact gap an earlier sibling task's defect exploited: dispatching on
// `basename(process.argv[1])` instead of `argv[0]` made a real subcommand
// unreachable through every actual invocation shape while every OTHER test
// in that PR called the exported function directly and could not see it.
// See this package's `cli.ts` top-of-file doc comment and the task brief
// this file was written against.
//
// Spawns the REAL compiled `dist/cli.js` with `execFileSync` and asserts
// actual exit codes — never "did not throw" (Node's uncaught-exception
// default also exits 1, indistinguishable from a real finding).
// -----------------------------------------------------------------------

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("direct-path reachability — the real compiled dist/cli.js", () => {
  it("node dist/cli.js brand-coverage <derivations-file> <brandable-slots-file> exits 0 when both directions hold", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary"], ["no-hedging"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);

    const result = runCli(["brand-coverage", derivationsFile, slotsFile]);

    expect(result.stdout).toContain("Brand coverage: satisfied");
    expect(result.status).toBe(0);
  });

  it("node dist/cli.js brand-coverage ... exits 1 on a real coverage gap", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary", "--color-accent-secondary"]);

    const result = runCli(["brand-coverage", derivationsFile, slotsFile]);

    expect(result.stdout).toContain("--color-accent-secondary");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js brand-coverage ... exits 2 on an empty brandable-slots list", () => {
    const derivationsFile = writeDerivations(strategyDir, [derivation("Precise", ["--color-accent-primary"])]);
    const slotsFile = writeBrandableSlots(strategyDir, []);

    const result = runCli(["brand-coverage", derivationsFile, slotsFile]);

    expect(result.status).toBe(2);
  });

  it("node dist/cli.js brand-coverage ... exits 2 on a missing/unreadable derivations-file (CliInputError caught by run())", () => {
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);

    const result = runCli(["brand-coverage", join(strategyDir, "does-not-exist.json"), slotsFile]);

    expect(result.status).toBe(2);
  });

  // The reachability regression itself: with NO subcommand argument, the
  // existing facts-check behavior must run completely unchanged through
  // the real compiled entrypoint — proving `argv[0] === "brand-coverage"`
  // dispatch (not a basename check) is what gates the new subcommand.
  it("node dist/cli.js <strategy-dir> [scan-dir] with NO subcommand still runs the existing facts check unchanged", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");

    const clean = runCli([strategyDir, scanDir]);
    expect(clean.stdout).toContain("No findings.");
    expect(clean.status).toBe(0);

    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    const finding = runCli([strategyDir, scanDir]);
    expect(finding.stdout).toContain("finding(s)");
    expect(finding.status).toBe(1);
  });

  // Reachability for the THIRD subcommand — the same regression class the
  // test above guards against, but for `direction` this time: proves
  // `argv[0] === "direction"` dispatch (not a basename check) is what
  // gates this subcommand too, through the real compiled entrypoint, and
  // that adding it did not disturb `brand-coverage`'s own reachability
  // (exercised again here, alongside `direction`, in the same process).
  it("node dist/cli.js direction <direction-entities-file> <reviewed-against-file> exits 0 when both coverage and currency hold", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [directionEntity("vision-v1")]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);

    const result = runCli(["direction", entitiesFile, reviewsFile]);

    expect(result.stdout).toContain("Direction coverage: satisfied.");
    expect(result.stdout).toContain("Direction currency: satisfied.");
    expect(result.status).toBe(0);
  });

  // The separating case again, through the real compiled entrypoint: a
  // reviewedAgainst names a real but superseded version. Presence
  // resolves; the combined subcommand must still exit 1 with the
  // stale-review finding kind visible in the report.
  it("node dist/cli.js direction ... exits 1 and reports [stale-review] when a reviewedAgainst names a superseded version", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, [
      directionEntity("vision-v1"),
      directionEntity("vision-v2", { supersedes: "vision-v1", decidedOn: "2026-07-01" }),
    ]);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1", "vision-v2"]);

    const result = runCli(["direction", entitiesFile, reviewsFile]);

    expect(result.stdout).toContain("Direction coverage: satisfied.");
    expect(result.stdout).toContain("[stale-review] vision-v1");
    expect(result.stdout).toContain("Direction currency: violated.");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js direction ... exits 2 on empty direction-entities", () => {
    const entitiesFile = writeDirectionEntities(strategyDir, []);
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);

    const result = runCli(["direction", entitiesFile, reviewsFile]);

    expect(result.status).toBe(2);
  });

  it("node dist/cli.js direction ... exits 2 on a missing/unreadable direction-entities-file (CliInputError caught by run())", () => {
    const reviewsFile = writeReviewedAgainst(strategyDir, ["vision-v1"]);

    const result = runCli(["direction", join(strategyDir, "does-not-exist.json"), reviewsFile]);

    expect(result.status).toBe(2);
  });

  // Re-confirms brand-coverage reachability is unchanged now that a THIRD
  // subcommand dispatches off the same argv[0] check.
  it("node dist/cli.js brand-coverage ... is still reachable and unchanged alongside the new direction subcommand", () => {
    const derivationsFile = writeDerivations(strategyDir, [
      derivation("Precise", ["--color-accent-primary"], ["no-hedging"]),
    ]);
    const slotsFile = writeBrandableSlots(strategyDir, ["--color-accent-primary"]);

    const result = runCli(["brand-coverage", derivationsFile, slotsFile]);

    expect(result.stdout).toContain("Brand coverage: satisfied");
    expect(result.status).toBe(0);
  });
});

// -----------------------------------------------------------------------
// --facts-dir — the directory facts source, as an alternative to the flat
// facts.json. Same hermetic-mkdtemp discipline as everything above: real
// files on disk, `main(argv)` called directly. The mode is mutually
// exclusive with the flat file by contract, so each suite below also
// proves the OTHER source is absent (or refuses) — a run must never be
// able to pass while silently preferring one of two supplied registries.
// -----------------------------------------------------------------------

function writeFactsLeaf(name: string, value: unknown): void {
  const full = join(factsDir, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(value));
}

describe("main — --facts-dir — argument handling", () => {
  it("throws CliInputError when --facts-dir is given without a value", () => {
    expect(() => main([strategyDir, scanDir, "--facts-dir"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --facts-dir names a directory that does not exist", () => {
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(() => main([strategyDir, scanDir, "--facts-dir", join(factsDir, "nope")])).toThrow(CliInputError);
  });

  it("refuses --facts-dir and the flat facts.json together, naming the conflict", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact])); // flat facts.json present
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(() => main([strategyDir, scanDir, "--facts-dir", factsDir])).toThrow(
      /mutually exclusive facts sources/,
    );
  });

  it("refuses --facts-dir when facts.json exists in strategy-dir, even with the facts directory elsewhere", () => {
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(() => main([strategyDir, scanDir, "--facts-dir", factsDir])).toThrow(/mutually exclusive/);
  });
});

describe("main — --facts-dir — the third state: could not run (exit 2)", () => {
  it("returns 2 when a leaf is unparseable, and the error names the leaf", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(factsDir, "broken.json"), "{ not json");
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(2);
  });

  it("returns 2 when a leaf is schema-invalid, and the error names the leaf", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(factsDir, "claims.json"), JSON.stringify([{ key: "bad key" }]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(2);
  });

  it("returns 2 when a non-JSON leaf is present — unaccounted-for leaves are refused, never ignored", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(factsDir, "notes.md"), "misplaced prose");
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(2);
  });

  it("returns 2 when the facts directory holds no JSON leaf at all", () => {
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(2);
  });
});

describe("main — --facts-dir — real runs", () => {
  it("returns 0 on a clean pass reading facts from directory leaves", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(0);
  });

  it("returns 0 when facts live in nested subdirectories and _schema.json is skipped", () => {
    writeFactsLeaf("company/customers.json", [validFact]);
    writeFileSync(join(factsDir, "_schema.json"), JSON.stringify({ version: 1 }));
    writeFileSync(join(factsDir, "company", "_schema.json"), JSON.stringify({ version: 1 }));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(0);
  });

  it("returns 2 when a nested leaf is a group-object domain file", () => {
    writeFactsLeaf("company/traction.json", { customers: { value: 1 } });
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(2);
  });

  it("returns 1 on a finding, exactly as the flat mode would", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(1);
  });

  it("combines multiple leaves into one fact set — a claim traced by a second leaf's fact is not a finding", () => {
    writeFactsLeaf("customers.json", [validFact]);
    writeFactsLeaf("uptime.json", [{ ...validFact, key: "uptime", label: "Uptime", value: 99.9, aliases: ["99.9%"] }]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers at 99.9% uptime.");
    expect(main([strategyDir, scanDir, "--facts-dir", factsDir])).toBe(0);
  });

  it("combined directory output equals the flat equivalent: same scan, same verdict either way", () => {
    // Flat mode.
    writeFileSync(join(strategyDir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    const flatClean = main([strategyDir, scanDir]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    const flatFinding = main([strategyDir, scanDir]);

    // Directory mode over the same registry, re-laid-out into one leaf.
    // The flat file must go first — the two sources are mutually
    // exclusive, which is exactly what the refusal tests above prove.
    rmSync(join(strategyDir, "facts.json"));
    writeFactsLeaf("customers.json", [validFact]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    const dirClean = main([strategyDir, scanDir, "--facts-dir", factsDir]);
    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    const dirFinding = main([strategyDir, scanDir, "--facts-dir", factsDir]);

    expect(flatClean).toBe(0);
    expect(dirClean).toBe(flatClean);
    expect(flatFinding).toBe(1);
    expect(dirFinding).toBe(flatFinding);
  });
});
