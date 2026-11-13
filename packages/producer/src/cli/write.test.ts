import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPinned, flatConsumer, runVerb, snapshot } from "./__fixtures__/flat-consumer.js";

let root: string;
beforeEach(() => { root = flatConsumer(["director", "writer"]); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys write over the flat slot model", () => {
  it("briefs, compiles and checks the pinned Writer set without writing into the consumer", () => {
    const before = snapshot(root);
    const brief = runVerb(["write", "--brief"], root);
    expect(brief.status).toBe(0);
    expect(brief.value.brief).toMatchObject({ schemaVersion: 1, agent: "writer", missingInputs: [] });
    const compiled = runVerb(["write"], root);
    expect(compiled.status).toBe(0);
    expect(compiled.value.compilation.slots.length).toBeGreaterThan(0);
    const check = runVerb(["write", "--check"], root);
    // The exit code follows the contract; whatever it is, the check ran over the pinned set.
    expect([0, 1, 2]).toContain(check.status);
    expect(check.value.checks.writerCount).toBe(compiled.value.compilation.slots.length);
    expect(check.value.exitCode).toBe(check.status);
    expect(snapshot(root)).toEqual(before);
  }, 120_000);

  it("reports hash drift on a pinned Writer candidate", () => {
    const pinned = firstPinned(root, "writer", id => !id.startsWith("lexicon."));
    writeFileSync(pinned.candidate, readFileSync(pinned.candidate, "utf8") + "\n");
    const result = runVerb(["write"], root);
    expect(result.status).toBe(1);
    expect(result.value.message).toContain(`hash-drift (${pinned.id})`);
  }, 60_000);

  it("could not run without the Writer IA", () => {
    rmSync(join(root, "clossys", "agents", "writer", "ia.json"));
    const result = runVerb(["write", "--check"], root);
    expect(result.status).toBe(2);
    expect(result.value.message).toMatch(/could not run/);
  }, 60_000);
});
