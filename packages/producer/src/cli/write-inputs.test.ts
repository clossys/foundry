import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";

// CP1-COPYKEY (cold3 item 15): `write --check` reads a Writer copy slot's declared inputs by agent. A `writer/<slot>`
// input (a lexicon rule) resolves through the Writer pins; a Director input still has to be a pinned Director cell.
// Kept apart from write.test.ts, whose shared seed-pin setup is refused on this base and skips its suite.
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A mktemp copy of the fixture consumer, without the given `clossys/agents/...` files; its root. */
function world(...without: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "write-inputs-"))); roots.push(root);
  const skip = new Set(without.map(path => join(FIXTURE, "clossys/agents", path)));
  cpSync(FIXTURE, root, { recursive: true, filter: source => !skip.has(source) });
  return root;
}

type Finding = { rule: string; slot?: string; message: string };
async function inputFindings(root: string): Promise<Finding[]> {
  const result = await runCli(["write", "--check", "--root", root], root);
  const findings = (result as unknown as { checks?: { findings: Finding[] } }).checks?.findings;
  if (!findings) throw new Error(`write --check did not run: ${result.message}`);
  return findings.filter(finding => finding.rule.endsWith("-input-unpinned"));
}

describe("write --check declared inputs (CP1-COPYKEY)", () => {
  it("a writer lexicon input resolves through the Writer pins", async () => {
    const findings = await inputFindings(world());
    expect(findings.filter(finding => finding.message.includes("lexicon."))).toEqual([]);
    expect(findings.filter(finding => finding.slot === "frames.site-header.copy")).toEqual([]);
    // An unpinned Writer input is named as a Writer input, never as a Director one.
    const unpinned = await inputFindings(world("writer/lexicon.formality/pin.json"));
    expect(unpinned).toContainEqual({ rule: "writer-input-unpinned", slot: "frames.site-header.copy", message: "Declared input writer:lexicon.formality has no pinned candidate" });
    expect(unpinned.filter(finding => finding.rule === "director-input-unpinned")).toEqual([]);
  }, 60_000);

  it("an unpinned director input is still reported", async () => {
    const findings = await inputFindings(world("director/identity.naming.name/pin.json"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings).toContainEqual(expect.objectContaining({ rule: "director-input-unpinned", message: "Declared input director:identity.naming.name has no pinned candidate" }));
  }, 60_000);
});
