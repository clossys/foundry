/**
 * CP1-DIRECT (foundry-build-0048): `clossys direct --check` skips the Director's own `loop.*` slots (JSON loop versions
 * that `clossys init` adopts and `loop.agent-standard` validates), as the record suites do (CONSISTENCY C3), and still
 * reports a real Director cell it cannot read as `unreadable-candidate`.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPinned, flatConsumer, repinSha, runVerb, withBriefContracts } from "./__fixtures__/flat-consumer.js";

const LOOPS = ["loop.scope", "loop.slot", "loop.create", "loop.choose", "loop.cascade"];
let root: string;
beforeEach(() => { root = withBriefContracts(flatConsumer(["director", "writer"])); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys direct --check over the Director loop slots (CP1-DIRECT)", () => {
  it("(a) does not read the pinned loop-version JSON under loop.* as cells", () => {
    // Precondition: the consumer pins a JSON loop version in each Director loop slot, as `clossys init` seats it.
    for (const id of LOOPS) {
      const pinned = firstPinned(root, "director", slot => slot === id);
      expect(pinned.candidate.endsWith(".json")).toBe(true);
      expect(existsSync(pinned.candidate)).toBe(true);
    }
    const result = runVerb(["direct", "--check"], root);
    expect(result.value).toMatchObject({ verb: "direct", check: true });
    const loopFindings = (result.value.findings as { code: string; slot: string; path?: string }[])
      .filter(finding => LOOPS.includes(finding.slot) || /\/loop\.[a-z]+\//.test(finding.path ?? ""));
    expect(loopFindings).toEqual([]);
    expect(result.stdout).not.toMatch(/unreadable-candidate[^\n]*loop\./);
  }, 60_000);

  it("(b) still reports a malformed real Director cell as unreadable-candidate", () => {
    const pinned = firstPinned(root, "director", id => !id.startsWith("loop."));
    // A cell whose Direction section holds no bullet, its pin re-recorded so the bytes agree with the pin: the set
    // reader accepts the candidate and the Director's own cell parser refuses it.
    const original = readFileSync(pinned.candidate, "utf8");
    const bytes = original.replace(/^(## Direction\n)(?:- .*\n)+/m, "$1");
    expect(bytes).not.toBe(original);
    writeFileSync(pinned.candidate, bytes);
    repinSha(pinned, bytes);
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).not.toBe(0);
    expect(result.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unreadable-candidate", slot: pinned.id })]));
  }, 60_000);

  it("still reports a real Director cell with broken frontmatter (the set reader's invalid-candidate)", () => {
    const pinned = firstPinned(root, "director", id => !id.startsWith("loop."));
    const original = readFileSync(pinned.candidate, "utf8");
    const bytes = original.replace(`slot: "${pinned.id}"`, 'slot: "context.customer.elsewhere"');
    expect(bytes).not.toBe(original);
    writeFileSync(pinned.candidate, bytes);
    repinSha(pinned, bytes);
    const result = runVerb(["direct", "--check"], root);
    expect(result.status).not.toBe(0);
    expect(result.value.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-candidate", slot: pinned.id })]));
  }, 60_000);
});
