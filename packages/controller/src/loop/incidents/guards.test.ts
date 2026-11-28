import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLES_DIR } from "./cli.js";
import { classifyRed, foldPlanFindings, packetExpectations, packetFindings, redFindings } from "./guards.js";

describe("packet lint", () => {
  it("refuses one command with two expectations", () => {
    const packet = "## Validation\n- `npm run test -w @clossys/designer`, exit 0.\n- `npm run test -w @clossys/designer`: same exit as base.\n## Forbidden\n- `npm run test -w @clossys/designer` exit 3 (outside Validation)\n";
    expect(packetExpectations(packet).get("npm run test -w @clossys/designer")).toEqual([{ kind: "exit", code: 0 }, { kind: "base" }]);
    expect(packetFindings(packet).map(finding => finding.guard)).toEqual(["R-PACKET-ONE-EXPECTATION"]);
    // Both on one line is the same contradiction.
    expect(packetFindings("## Validation\n- `npm run check`, exit 0, or the same exit as base\n").map(finding => finding.guard)).toEqual(["R-PACKET-ONE-EXPECTATION", "R-ROOT-CHECK-BASE-RELATIVE"]);
  });

  it("holds the root check to the base, never to a fixed exit", () => {
    expect(packetFindings("## Validation\n- `npm run check`, exit 0.\n")[0]?.message).toMatch(/^root check `npm run check` is held to a fixed exit/);
    expect(packetFindings("## Validation\n- `npm run check`: same exit as base.\n")).toEqual([]);
    // A command's own flags are never read as an expectation.
    expect(packetFindings("## Validation\n- `node x.mjs --exit 0`: same exit as base.\n")).toEqual([]);
    expect(packetFindings(readFileSync(join(SAMPLES_DIR, "packet.md"), "utf8"))).toEqual([]);
  });
});

describe("new-red classification", () => {
  it("calls a red new only after it failed alone and passed on the base", () => {
    expect(classifyRed({ head: "timeout" })).toBe("unconfirmed");
    expect(classifyRed({ head: "timeout", alone: "pass" })).toBe("noise");
    expect(classifyRed({ head: "fail", alone: "fail" })).toBe("unconfirmed");
    expect(classifyRed({ head: "fail", alone: "fail", base: "fail" })).toBe("pre-existing");
    expect(classifyRed({ head: "fail", alone: "fail", base: "pass" })).toBe("new");
    expect(redFindings({ reds: [{ test: "t", head: "timeout", verdict: "new" }] })[0]?.message).toBe("new red t (timeout) is reported without a re-run alone");
    expect(redFindings({ reds: [{ test: "t", head: "fail", alone: "fail", verdict: "new" }] })[0]?.message).toBe("new red t (fail) is reported without a base run");
    expect(redFindings(JSON.parse(readFileSync(join(SAMPLES_DIR, "reds.json"), "utf8")))).toEqual([]);
  });
});

describe("fold plan lint", () => {
  it("refuses a compare of a branch the fold has not fetched", () => {
    const findings = foldPlanFindings({ steps: ["git fetch origin claude/r2f-int2", "git merge-tree --write-tree origin/claude/r2f-int2 claude/unit-x"] });
    expect(findings.map(finding => finding.message)).toEqual(["step 2 `git merge-tree --write-tree origin/claude/r2f-int2 claude/unit-x`: claude/unit-x is compared before it was fetched (git fetch origin claude/unit-x first; a local ref may be stale)"]);
    expect(foldPlanFindings({ steps: ["git merge-base claude/a origin/claude/b", "git fetch origin claude/a claude/b"] })).toHaveLength(2);
    expect(foldPlanFindings(JSON.parse(readFileSync(join(SAMPLES_DIR, "fold.json"), "utf8")))).toEqual([]);
  });
});
