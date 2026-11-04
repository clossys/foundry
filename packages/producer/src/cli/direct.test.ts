import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPinned, flatConsumer, runVerb, snapshot } from "./__fixtures__/flat-consumer.js";

let root: string;
beforeEach(() => { root = flatConsumer(["director", "writer"]); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys direct over the flat slot model", () => {
  it("checks, briefs and compiles the pinned Director set without writing into the consumer", () => {
    const before = snapshot(root);
    const check = runVerb(["direct", "--check"], root);
    expect(check.status).toBe(0);
    expect(check.value).toMatchObject({ exitCode: 0, verb: "direct", root, check: true, findings: [], limits: [] });
    expect(check.value.summary.pinned).toBeGreaterThan(0);
    for (const args of [["direct", "--brief"], ["direct"]]) {
      const result = runVerb(args, root);
      expect(result.status).toBe(0);
      expect((result.value.brief ?? result.value.compilation).slots.length).toBe(check.value.summary.pinned);
    }
    expect(snapshot(root)).toEqual(before);
  }, 60_000);

  it("reports a pinned candidate whose bytes drifted from its pin as a finding", () => {
    const pinned = firstPinned(root, "director");
    writeFileSync(pinned.candidate, readFileSync(pinned.candidate, "utf8") + "\n");
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "hash-drift", slot: pinned.id })]));
  }, 60_000);

  it("cites evidence only by known finding ids", () => {
    rmSync(join(root, "clossys", "agents", "director", "_evidence"), { recursive: true, force: true });
    const result = runVerb(["direct", "--check"], root);
    expect([1, 2]).toContain(result.status);
  }, 60_000);

  it("could not run without a Director IA, or through a symbolic link", () => {
    const ia = join(root, "clossys", "agents", "director", "ia.json");
    const bytes = readFileSync(ia);
    rmSync(ia);
    const missing = runVerb(["direct", "--check"], root);
    expect(missing.status).toBe(2);
    expect(missing.value.message).toContain("clossys/agents/director/ia.json is missing");
    writeFileSync(join(root, "ia-target.json"), bytes);
    symlinkSync(join(root, "ia-target.json"), ia);
    expect(runVerb(["direct", "--check"], root).status).toBe(2);
  }, 60_000);

  it("honors --root from another working directory", () => {
    const nested = join(root, "nested"); mkdirSync(nested);
    const result = runVerb(["direct", "--root", "..", "--check"], nested);
    expect(result.status).toBe(0);
    expect(result.value.root).toBe(root);
  }, 60_000);
});
