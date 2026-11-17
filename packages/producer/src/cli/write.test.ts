import { createHash } from "node:crypto";
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

  it("briefs the Writer's live leaves: every target tree (voice, prose, copy) with non-empty ids and role", () => {
    const brief = runVerb(["write", "--brief"], root);
    const leaves = brief.value.brief.leaves as { layer: string; role: string; ids: string[] }[];
    expect(leaves.map(row => row.layer)).toEqual(["voice", "prose", "copy"]);
    for (const row of leaves) {
      expect(row.ids.length, row.layer).toBeGreaterThan(0);
      expect(row.role, row.layer).toBe(row.layer);
      expect(new Set(row.ids).size, row.layer).toBe(row.ids.length);
    }
    const ids = leaves.flatMap(row => row.ids);
    expect(ids).toEqual(expect.arrayContaining(["lexicon.formality", "narratives.legal-document", "sections.hero.copy", "page.home.meta"]));
    // The retired five-layer store is not briefed: passages.hero moved to sections.hero.copy.
    expect(ids).not.toContain("passages.hero");
  }, 60_000);

  it("reports hash drift on a pinned Writer candidate", () => {
    const pinned = firstPinned(root, "writer", id => !id.startsWith("lexicon."));
    writeFileSync(pinned.candidate, readFileSync(pinned.candidate, "utf8") + "\n");
    const result = runVerb(["write"], root);
    expect(result.status).toBe(1);
    expect(result.value.message).toContain(`hash-drift (${pinned.id})`);
  }, 60_000);

  it("reports a pinned Writer candidate without a Director trace as a finding (R20)", () => {
    const pinned = firstPinned(root, "writer", id => !id.startsWith("lexicon."));
    const director = firstPinned(root, "director", id => id === "identity.verbal.voice");
    const repin = (reason?: string) => {
      const text = readFileSync(pinned.candidate, "utf8").replace(/^reason: .*\n/m, "");
      const bytes = reason === undefined ? text : text.replace(/\n---\n/, `\nreason: ${JSON.stringify(reason)}\n---\n`);
      writeFileSync(pinned.candidate, bytes);
      const pinFile = join(pinned.dir, "pin.json");
      writeFileSync(pinFile, `${JSON.stringify({ ...JSON.parse(readFileSync(pinFile, "utf8")), sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)}\n`);
    };
    const traceRows = (result: ReturnType<typeof runVerb>) => result.value.checks.findings.filter((finding: { rule: string; slot: string }) => finding.rule === "director-trace-missing" && finding.slot === pinned.id);
    repin();
    const missing = runVerb(["write", "--check"], root);
    expect(missing.status).not.toBe(0);
    expect(traceRows(missing)).toEqual([expect.objectContaining({ message: expect.stringMatching(/frontmatter reason is missing/) })]);
    repin(`Realises director:${director.id}.`);
    expect(traceRows(runVerb(["write", "--check"], root))).toEqual([]);
  }, 240_000);

  it("could not run without the Writer IA", () => {
    rmSync(join(root, "clossys", "agents", "writer", "ia.json"));
    const result = runVerb(["write", "--check"], root);
    expect(result.status).toBe(2);
    expect(result.value.message).toMatch(/could not run/);
  }, 60_000);
});
