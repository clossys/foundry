import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkStrategyHandoff } from "./handoff.js";
import { readStrategy } from "./reader.js";

const fact = {
  key: "active-customers",
  label: "Active customers",
  value: 4200,
  unit: "customers",
  source: "billing-export-2026-06",
  lastUpdatedAt: "2026-06-30",
};

function writeHandoffReady(dir: string): void {
  writeFileSync(join(dir, "facts.json"), JSON.stringify([fact]));
  writeFileSync(
    join(dir, "audiences.json"),
    JSON.stringify([{ id: "ops-lead", name: "Operations lead", situation: "Runs operations.", pains: ["spreadsheet chaos"] }]),
  );
  writeFileSync(
    join(dir, "positioning.json"),
    JSON.stringify({
      productName: "Widgetronic",
      category: "internal tooling platform",
      audienceIds: ["ops-lead"],
      weAre: "the fastest way to turn a spreadsheet into a real tool",
      unlike: "general-purpose no-code builders",
      claimIds: ["prototype-same-meeting"],
    }),
  );
  writeFileSync(
    join(dir, "claims.json"),
    JSON.stringify([
      {
        id: "prototype-same-meeting",
        status: "approved",
        assertion: "We ship a working prototype in the same meeting the request is made.",
        basis: "Observed in three consecutive pilot sessions with operations teams.",
      },
    ]),
  );
  writeFileSync(join(dir, "constraints.json"), JSON.stringify([]));
  writeFileSync(
    join(dir, "brand.json"),
    JSON.stringify({
      essence: { statement: "Precision engineering for teams who cannot afford to guess." },
      attributes: [
        {
          id: "precise",
          statement: "Every public claim we make is checkable.",
          basis: "Every number in our marketing traces to a facts.json entry, enforced in CI.",
        },
      ],
      derivations: [{ attributeId: "precise", tokenSlots: ["--color-accent-primary"], voiceRuleIds: [] }],
    }),
  );
  writeFileSync(
    join(dir, "direction.json"),
    JSON.stringify([
      {
        id: "direction-2026-h1",
        subject: { file: "positioning.json", id: "positioning" },
        decidedOn: "2026-01-05",
        derivesFrom: [],
      },
    ]),
  );
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strategy-handoff-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkStrategyHandoff", () => {
  it("passes a handoff-ready directory including empty constraints.json", () => {
    writeHandoffReady(dir);
    const bundle = readStrategy(dir);
    expect(bundle.complete).toBe(true);
    expect(checkStrategyHandoff(bundle).ok).toBe(true);
  });

  it("passes readStrategy but fails handoff for a facts-only directory", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([fact]));
    const bundle = readStrategy(dir);
    expect(bundle.complete).toBe(true);
    expect(checkStrategyHandoff(bundle).ok).toBe(false);
  });

  it("resolves a direction subject pointing at a brand attribute", () => {
    writeHandoffReady(dir);
    writeFileSync(
      join(dir, "direction.json"),
      JSON.stringify([
        {
          id: "direction-2026-h1",
          subject: { file: "brand.json", id: "precise" },
          decidedOn: "2026-01-05",
          derivesFrom: [],
        },
      ]),
    );
    const bundle = readStrategy(dir);
    expect(checkStrategyHandoff(bundle).ok).toBe(true);
  });

  it("resolves a direction subject pointing at a constraint", () => {
    writeHandoffReady(dir);
    writeFileSync(
      join(dir, "constraints.json"),
      JSON.stringify([
        {
          id: "no-hype",
          target: "copy",
          instruction: "Do not use superlatives without a cited fact or approved claim.",
        },
      ]),
    );
    writeFileSync(
      join(dir, "direction.json"),
      JSON.stringify([
        {
          id: "direction-2026-h1",
          subject: { file: "constraints.json", id: "no-hype" },
          decidedOn: "2026-01-05",
          derivesFrom: [],
        },
      ]),
    );
    const bundle = readStrategy(dir);
    expect(checkStrategyHandoff(bundle).ok).toBe(true);
  });

  it("resolves a direction subject pointing at a roadmap item", () => {
    writeHandoffReady(dir);
    writeFileSync(
      join(dir, "roadmap.json"),
      JSON.stringify([{ id: "self-serve-onboarding", title: "Self-serve onboarding", status: "now" }]),
    );
    writeFileSync(
      join(dir, "direction.json"),
      JSON.stringify([
        {
          id: "direction-2026-h1",
          subject: { file: "roadmap.json", id: "self-serve-onboarding" },
          decidedOn: "2026-01-05",
          derivesFrom: [],
        },
      ]),
    );
    const bundle = readStrategy(dir);
    expect(checkStrategyHandoff(bundle).ok).toBe(true);
  });

  it("fails handoff on dangling positioning audience ids", () => {
    writeHandoffReady(dir);
    writeFileSync(
      join(dir, "positioning.json"),
      JSON.stringify({
        productName: "Widgetronic",
        category: "internal tooling platform",
        audienceIds: ["missing-audience"],
        weAre: "the fastest way to turn a spreadsheet into a real tool",
        unlike: "general-purpose no-code builders",
        claimIds: ["prototype-same-meeting"],
      }),
    );
    const bundle = readStrategy(dir);
    expect(checkStrategyHandoff(bundle).ok).toBe(false);
  });
});
