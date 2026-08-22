/**
 * The exit-code contract, exercised end to end through `main(argv)` against
 * real temp directories.
 *
 * Every gate gets all three states proven here — `0`, `1`, and `2` — and
 * `2` is proven by more than one genuinely different route per gate: an
 * unreadable record store, a store that parses but does not validate, and
 * an empty record set. A gate whose `2` has never been observed is
 * indistinguishable from a gate that cannot reach it.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "butler-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return path;
}

const v3 = { policyId: "wants", version: "3" };
const v4 = { policyId: "wants", version: "4" };

const actedIntent = {
  intentId: "int_1",
  subjectId: "sub_1",
  actorId: "agent_1",
  interpretation: "reschedule",
  confidence: 0.95,
  observedAt: "2026-02-01T00:00:00.000Z",
  disposition: "acted",
};
const confirmed = { intentId: "int_1", subjectId: "sub_1", verdict: "confirmed", confirmedAt: "2026-02-01T00:01:00.000Z" };

const grantedInstruction = {
  instructionId: "ins_1",
  subjectId: "sub_1",
  topic: "contact-window",
  state: { kind: "granted", policyVersion: v3, decidedAt: "2026-01-01T00:00:00.000Z" },
  provenance: "stated",
  currency: { days: 90 },
};
const freshUsage = { instructionId: "ins_1", actorId: "agent_1", usedAt: "2026-01-02T00:00:00.000Z", currentPolicyVersion: v3 };

const easyCost = { steps: 2, requiresContact: false, requiresAccount: false };

describe("dispatch", () => {
  it("exits 2 with no gate selected — a bare invocation is a run that never happened", () => {
    // The fail-open shape this package exists to repay, guarded in its own
    // CLI: a CI step with a dropped argument, a wrapper that loses `$1`, or
    // a gate renamed out from under its caller all land here, and none of
    // them may report clean on the strength of having checked nothing.
    expect(main([])).toBe(2);
  });

  it("prints its usage to stderr when no gate was selected, never to stdout as if it were output", () => {
    main([]);
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("exits 0 for an explicitly requested --help, which is a run that did what was asked", () => {
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
  });

  it("refuses an unknown gate rather than falling through to one", () => {
    expect(() => main(["consent-check"])).toThrow(CliInputError);
  });

  it("dispatches on argv[0] exactly, so a path argument is never mistaken for a gate name", () => {
    expect(() => main(["Currency", "a", "b"])).toThrow(CliInputError);
    expect(() => main([join(dir, "currency"), "a"])).toThrow(CliInputError);
  });

  it("prints each gate's own usage and exits 0", () => {
    expect(main(["confirmation-completeness", "--help"])).toBe(0);
    expect(main(["currency", "--help"])).toBe(0);
    expect(main(["withdrawal-parity", "--help"])).toBe(0);
  });
});

describe("confirmation-completeness", () => {
  it("exits 0 when every acted-on intent is confirmed", () => {
    const intents = write("intents.json", [actedIntent]);
    const confirmations = write("confirmations.json", [confirmed]);
    expect(main(["confirmation-completeness", intents, confirmations, "--floor", "0.8"])).toBe(0);
  });

  it("exits 1 on a real finding", () => {
    const intents = write("intents.json", [actedIntent]);
    const confirmations = write("confirmations.json", []);
    expect(main(["confirmation-completeness", intents, confirmations, "--floor", "0.8"])).toBe(1);
  });

  it("exits 2 when the record store cannot be read", () => {
    const confirmations = write("confirmations.json", []);
    expect(main(["confirmation-completeness", join(dir, "missing.json"), confirmations, "--floor", "0.8"])).toBe(2);
  });

  it("exits 2 when the record store is a directory rather than a file", () => {
    const asDirectory = join(dir, "intents-dir");
    mkdirSync(asDirectory);
    const confirmations = write("confirmations.json", []);
    expect(main(["confirmation-completeness", asDirectory, confirmations, "--floor", "0.8"])).toBe(2);
  });

  it("exits 2 on unparseable JSON and on JSON that does not validate", () => {
    const confirmations = write("confirmations.json", []);
    const broken = write("broken.json", "{ not json");
    expect(main(["confirmation-completeness", broken, confirmations, "--floor", "0.8"])).toBe(2);
    const invalid = write("invalid.json", [{ ...actedIntent, confidence: "high" }]);
    expect(main(["confirmation-completeness", invalid, confirmations, "--floor", "0.8"])).toBe(2);
  });

  it("exits 2 when there is nothing to scan, rather than reporting a pass for a run that checked nothing", () => {
    const intents = write("intents.json", []);
    const confirmations = write("confirmations.json", []);
    expect(main(["confirmation-completeness", intents, confirmations, "--floor", "0.8"])).toBe(2);
  });

  it("refuses to run without a declared floor, and refuses to invent one", () => {
    const intents = write("intents.json", [actedIntent]);
    const confirmations = write("confirmations.json", []);
    expect(() => main(["confirmation-completeness", intents, confirmations])).toThrow(/--floor is required/);
    expect(() => main(["confirmation-completeness", intents, confirmations, "--floor", "high"])).toThrow(CliInputError);
    expect(() => main(["confirmation-completeness", intents, confirmations, "--floor", "1.5"])).toThrow(CliInputError);
  });

  it("accepts --floor=value as well as --floor value", () => {
    const intents = write("intents.json", [actedIntent]);
    const confirmations = write("confirmations.json", [confirmed]);
    expect(main(["confirmation-completeness", intents, confirmations, "--floor=0.8"])).toBe(0);
  });
});

describe("currency", () => {
  it("exits 0 when every usage relied on a current answer", () => {
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [freshUsage]);
    expect(main(["currency", instructions, usages, "--invalidate-denial-on-policy-bump", "true"])).toBe(0);
  });

  it("exits 1 for a usage past the declared window, on a row a presence check would pass", () => {
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [{ ...freshUsage, usedAt: "2026-06-01T00:00:00.000Z" }]);
    expect(main(["currency", instructions, usages, "--invalidate-denial-on-policy-bump", "true"])).toBe(1);
  });

  it("exits 1 for a usage after the answered policy version was superseded", () => {
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [{ ...freshUsage, currentPolicyVersion: v4 }]);
    expect(main(["currency", instructions, usages, "--invalidate-denial-on-policy-bump", "true"])).toBe(1);
  });

  it("exits 2 when the record store cannot be read", () => {
    const usages = write("usages.json", [freshUsage]);
    expect(main(["currency", join(dir, "missing.json"), usages, "--invalidate-denial-on-policy-bump", "false"])).toBe(2);
  });

  it("exits 2 when the usages file parses but does not validate", () => {
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [{ ...freshUsage, usedAt: "whenever" }]);
    expect(main(["currency", instructions, usages, "--invalidate-denial-on-policy-bump", "false"])).toBe(2);
  });

  it("exits 2 when either side is empty — nothing to scan is not a clean run", () => {
    const noInstructions = write("no-instructions.json", []);
    const noUsages = write("no-usages.json", []);
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [freshUsage]);
    expect(main(["currency", noInstructions, usages, "--invalidate-denial-on-policy-bump", "false"])).toBe(2);
    expect(main(["currency", instructions, noUsages, "--invalidate-denial-on-policy-bump", "false"])).toBe(2);
  });

  it("refuses to run without the denial-invalidation decision, and accepts no truthy stand-in for it", () => {
    const instructions = write("instructions.json", [grantedInstruction]);
    const usages = write("usages.json", [freshUsage]);
    expect(() => main(["currency", instructions, usages])).toThrow(/required; this gate has no default/);
    expect(() => main(["currency", instructions, usages, "--invalidate-denial-on-policy-bump", "yes"])).toThrow(CliInputError);
  });
});

describe("withdrawal-parity", () => {
  it("exits 0 when withdrawing is no harder than granting", () => {
    const paths = write("paths.json", [{ surfaceId: "prefs", topic: "email", grant: easyCost, withdraw: easyCost }]);
    expect(main(["withdrawal-parity", paths])).toBe(0);
  });

  it("exits 1 when withdrawing costs more", () => {
    const paths = write("paths.json", [
      { surfaceId: "prefs", topic: "email", grant: easyCost, withdraw: { steps: 9, requiresContact: true, requiresAccount: false } },
    ]);
    expect(main(["withdrawal-parity", paths])).toBe(1);
  });

  it("exits 1 when there is no way out at all", () => {
    const paths = write("paths.json", [{ surfaceId: "prefs", topic: "email", grant: easyCost }]);
    expect(main(["withdrawal-parity", paths])).toBe(1);
  });

  it("exits 2 when the record store cannot be read", () => {
    expect(main(["withdrawal-parity", join(dir, "missing.json")])).toBe(2);
  });

  it("exits 2 when the file parses but does not validate", () => {
    const paths = write("paths.json", [{ surfaceId: "prefs", topic: "email", grant: { steps: "two", requiresContact: false, requiresAccount: false } }]);
    expect(main(["withdrawal-parity", paths])).toBe(2);
  });

  it("exits 2 when no paths were declared", () => {
    const paths = write("paths.json", []);
    expect(main(["withdrawal-parity", paths])).toBe(2);
  });

  it("refuses unknown flags and extra positional arguments rather than ignoring them", () => {
    const paths = write("paths.json", []);
    expect(() => main(["withdrawal-parity", paths, "--strict"])).toThrow(CliInputError);
    expect(() => main(["withdrawal-parity", paths, paths])).toThrow(CliInputError);
  });
});
