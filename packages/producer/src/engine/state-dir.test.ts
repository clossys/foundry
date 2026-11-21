import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEGACY_STATE_DIR, STATE_DIR, STATE_SEGMENTS, isStateRel, statePath, stateRel } from "./state-dir.js";

const CONTRACT = fileURLToPath(new URL("../../../../docs/contracts/consumer-layout.json", import.meta.url));

describe("engine state folder (consumer-layout contract)", () => {
  it("is the contract's stateDir, and the legacy folder is its legacyStateDir", () => {
    const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as { stateDir: string; legacyStateDir: string };
    expect(STATE_DIR).toBe(contract.stateDir);
    expect(LEGACY_STATE_DIR).toBe(contract.legacyStateDir);
    expect(STATE_SEGMENTS).toEqual(contract.stateDir.split("/"));
  });

  it("builds workspace-relative and absolute paths under the state folder only", () => {
    expect(stateRel("runs", "loops")).toBe("clossys/.state/runs/loops");
    expect(statePath("/w", "events.jsonl")).toBe(join("/w", "clossys", ".state", "events.jsonl"));
    expect(isStateRel("clossys/.state")).toBe(true);
    expect(isStateRel("clossys/.state/checks/a")).toBe(true);
    expect(isStateRel("clossys/.stateful")).toBe(false);
    expect(isStateRel(".clossys/checks")).toBe(false);
  });
});
