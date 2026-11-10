import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPinned, flatConsumer, runVerb, snapshot } from "./__fixtures__/flat-consumer.js";

let root: string;
beforeEach(() => { root = flatConsumer(["director", "designer"]); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys design over the flat slot model", () => {
  it("checks the pinned Designer set and its theme without writing into the consumer", () => {
    const before = snapshot(root);
    const check = runVerb(["design", "--check"], root);
    // The pinned set and theme are clean: the only findings are the Designer's share of the strict checks
    // (`slots/...`, `suites/...`), and the exit code is exactly that share's verdict.
    const own = check.value.checks.findings.filter((finding: { code: string }) => !/^(slots|suites)\//.test(finding.code));
    expect(own).toEqual([]);
    expect(check.value.checks.strict.limits).toEqual([]);
    expect(check.status).toBe(check.value.checks.strict.findings.length ? 1 : 0);
    expect(check.value.checks).toMatchObject({ theme: { hash: expect.any(String) } });
    expect(check.value.checks.pinned).toBeGreaterThan(0);
    const brief = runVerb(["design", "--brief"], root);
    expect(brief.status).toBe(0);
    expect(brief.value.brief).toMatchObject({ schemaVersion: 1, agent: "designer" });
    expect(brief.value.brief.inputs.filter((input: { ref: string | null }) => input.ref).length).toBeGreaterThan(0);
    expect(snapshot(root)).toEqual(before);
  }, 240_000);

  it("compiles the pinned set only to --out", () => {
    const out = join(mkdtempSync(join(tmpdir(), "producer-design-out-")), "designer.json");
    const before = snapshot(root);
    const result = runVerb(["design", "--out", out], root);
    expect(result.status).toBe(0);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written).toMatchObject({ schemaVersion: 1, agent: "designer" });
    expect(written.slots.length).toBe(result.value.compilation.slots.length);
    expect(snapshot(root)).toEqual(before);
    rmSync(join(out, ".."), { recursive: true, force: true });
  }, 240_000);

  it("reports hash drift on a pinned Designer candidate as a finding", () => {
    const pinned = firstPinned(root, "designer");
    writeFileSync(pinned.candidate, readFileSync(pinned.candidate, "utf8") + "\n");
    const result = runVerb(["design", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.checks.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "hash-drift", subject: `designer:${pinned.id}` })]));
  }, 240_000);

  it("reports a missing theme when no themes.* pin survives", () => {
    for (let pinned; (pinned = (() => { try { return firstPinned(root, "designer", id => id.startsWith("themes.")); } catch { return undefined; } })()); ) rmSync(join(pinned.dir, "pin.json"));
    const result = runVerb(["design", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.value.checks.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "theme-not-compiled" })]));
  }, 240_000);

  it("could not run without the Designer IA", () => {
    rmSync(join(root, "clossys", "agents", "designer", "ia.json"));
    const result = runVerb(["design", "--check"], root);
    expect(result.status).toBe(2);
    expect(result.value.message).toContain("clossys/agents/designer/ia.json is missing");
  }, 240_000);
});
